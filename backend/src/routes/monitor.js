const express = require('express');
const router = express.Router();
const db = require('../db');
const { analyzePrices } = require('../poeApiClient');

router.get('/items', (req, res) => {
  const items = db.prepare('SELECT * FROM monitor_items ORDER BY created_at DESC').all();
  res.json(items);
});

router.post('/items', (req, res) => {
  const { name, query, my_price, currency = 'chaos', category = 'item' } = req.body;
  if (!name || !query || my_price === undefined) {
    return res.status(400).json({ error: 'Faltan campos: name, query, my_price' });
  }
  const stmt = db.prepare(
    'INSERT INTO monitor_items (name, category, query, my_price, currency) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(name, category, JSON.stringify(query), my_price, currency);
  res.status(201).json({ id: result.lastInsertRowid, name, category, my_price, currency });
});

router.delete('/items/:id', (req, res) => {
  db.prepare('DELETE FROM monitor_items WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

router.get('/check', async (req, res) => {
  // ⚠️ realm y league SIEMPRE desde query params — nunca usar defaults de poeApiClient
  const realm  = req.query.realm  || 'sony';
  const league = req.query.league || 'Standard';

  console.log(`[monitor/check] realm=${realm} league=${league}`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const items = db.prepare('SELECT * FROM monitor_items ORDER BY created_at DESC').all();

  if (items.length === 0) {
    send({ status: 'done', results: [] });
    return res.end();
  }

  const myAccount = process.env.POE_ACCOUNT;
  const results = [];
  const typeCache = new Map();

  const uniqueTypes = [...new Set(items.map(item => {
    const query = typeof item.query === 'string' ? JSON.parse(item.query) : item.query;
    return query.query.type;
  }))];
  const totalTypes = uniqueTypes.length;
  let checkedTypes = 0;

  send({ status: 'checking', progress: 0, total: totalTypes, message: 'Iniciando comprobación...' });

  for (const item of items) {
    try {
      const query = typeof item.query === 'string' ? JSON.parse(item.query) : item.query;
      const type = query.query.type;

      // ─── Patch defensivo ────────────────────────────────────────────────────
      // Garantiza sale_type=priced, filtros de gema y status online
      // independientemente de cómo se guardó la query originalmente.

      if (!query.query.filters) query.query.filters = {};

      // Instant buyout: solo listings con precio fijo
      if (!query.query.filters.trade_filters) {
        query.query.filters.trade_filters = { filters: {}, disabled: false };
      }
      query.query.filters.trade_filters.filters.sale_type = { option: 'priced' };
      query.query.filters.trade_filters.disabled = false;

      // Filtros de nivel 21 + 5 sockets para gemas
      if (item.category === 'gem') {
        if (!query.query.filters.misc_filters) {
          query.query.filters.misc_filters = { filters: {}, disabled: false };
        }
        query.query.filters.misc_filters.filters.gem_level   = { min: 21 };
        query.query.filters.misc_filters.filters.gem_sockets = { min: 5  };
        query.query.filters.misc_filters.disabled = false;
      }

      // Solo vendedores online
      if (!query.query.status) query.query.status = { option: 'securable' };
      // ────────────────────────────────────────────────────────────────────────

      let priceData;
      if (typeCache.has(type)) {
        priceData = typeCache.get(type);
      } else {
        send({ status: 'checking', progress: checkedTypes, total: totalTypes, message: `Comprobando ${item.name}...` });
        priceData = await analyzePrices(query, myAccount, { league, realm });
        typeCache.set(type, priceData);
        checkedTypes++;
        send({ status: 'checking', progress: checkedTypes, total: totalTypes, message: `Comprobando ${item.name}...` });
      }

      const { cheapestOther, myListings, myMinPrice, otherMinPrice, marketTotal } = priceData;

      if (!cheapestOther && myListings.length === 0) {
        results.push({
          item: item.name,
          myPrice: item.my_price,
          myCurrency: item.currency,
          marketMin: null,
          marketTotal: 0,
          isMinPrice: true,
          tied: false,
          cheaperOwnExists: false,
          cheaper: []
        });
        continue;
      }

      const marketMin        = otherMinPrice;
      const marketCurrency   = cheapestOther?.listing?.price?.currency ?? item.currency;
      const isMinPrice       = marketMin === null || item.my_price <= marketMin;
      const cheaperOwnExists = myMinPrice !== null && item.my_price > myMinPrice;
      const tied             = isMinPrice && !cheaperOwnExists && marketMin !== null && item.my_price === marketMin;
      const cheapestSeller   = cheapestOther?.listing?.account?.name ?? null;

      results.push({
        item: item.name,
        myPrice: item.my_price,
        myCurrency: item.currency,
        marketMin,
        marketCurrency,
        marketTotal: marketTotal ?? 0,
        myActiveMin: myMinPrice,
        cheaperOwnExists,
        isMinPrice,
        tied,
        cheapestSeller,
        cheaper: isMinPrice ? [] : [{
          seller: cheapestSeller,
          price: marketMin,
          currency: marketCurrency,
          online: cheapestOther.listing.account.online,
        }]
      });

      // Si el precio de mercado es distinto al cacheado en gem_market_prices, actualizamos
      if (marketMin !== null && cheapestOther) {
        const cached = db.prepare(
          'SELECT cheapest_price FROM gem_market_prices WHERE gem_type = ?'
        ).get(type);

        if (!cached || cached.cheapest_price !== marketMin) {
          const seller        = cheapestOther.listing.account.name ?? null;
          const sellerOnline  = cheapestOther.listing.account.online ? 1 : 0;
          const currency      = marketCurrency;
          const indexed       = cheapestOther.listing.indexed ?? null;
          const totalListings = marketTotal ?? 0;

          const existingRow = db.prepare(
            'SELECT category FROM gem_market_prices WHERE gem_type = ?'
          ).get(type);
          const category = existingRow?.category ?? 'item';

          db.prepare(`
            INSERT INTO gem_market_prices
              (gem_type, category, cheapest_price, currency, seller, seller_online, indexed, total_listings, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(gem_type) DO UPDATE SET
              cheapest_price = excluded.cheapest_price,
              currency       = excluded.currency,
              seller         = excluded.seller,
              seller_online  = excluded.seller_online,
              indexed        = excluded.indexed,
              total_listings = excluded.total_listings,
              fetched_at     = excluded.fetched_at
          `).run(type, category, marketMin, currency, seller, sellerOnline, indexed, totalListings);

          console.log(`[monitor/check] Caché Tracker actualizada: ${type} → ${marketMin} ${currency}`);
        }
      }

    } catch (err) {
      console.error('ERROR en item', item.name, err.response?.data || err.message);
      results.push({ item: item.name, myPrice: item.my_price, error: err.message });
    }
  }

  send({ status: 'done', results });
  res.end();
});

module.exports = router;