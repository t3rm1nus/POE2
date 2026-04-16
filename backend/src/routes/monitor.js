const express = require('express');
const router = express.Router();
const db = require('../db');
const { analyzePrices } = require('../poeApiClient');
const { GEMS }   = require('../tracker');  // ← añadir esta línea
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
  const realm  = req.query.realm  || 'sony';
  const league = req.query.league || 'Standard';

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  // ✅ Evita que el proxy cierre la conexión por inactividad
  res.setHeader('X-Accel-Buffering', 'no');

  let closed = false
  req.on('close', () => { 
    closed = true
    clearInterval(heartbeat)  // ← añadir esto
  })

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
   // ✅ Heartbeat cada 15s para mantener viva la conexión SSE
   const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, 15000);


  
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
      // ─── Actualizar caché Tracker ─────────────────────────────────────────────
      // ─── Actualizar caché Tracker ──────────────────────────────────────────────
      const gemInfo  = GEMS.find(g => g.type === type)
      const cached   = db.prepare('SELECT category FROM gem_market_prices WHERE gem_type = ?').get(type)
      const category = gemInfo?.cat ?? cached?.category ?? 'item'

      // El precio real mínimo del mercado: si soy el más barato, es mi precio; si no, el del competidor
      const trackerPrice    = isMinPrice ? myMinPrice : marketMin
      const trackerCurrency = isMinPrice
        ? (myListings[0]?.listing?.price?.currency ?? item.currency)
        : marketCurrency

      if (trackerPrice !== null) {
        let trackerSeller, trackerOnline, trackerIndexed

        if (isMinPrice && myListings.length > 0) {
          // Soy el más barato → usar mi propio listing
          const myListing  = myListings.find(l => l.listing.price.amount === myMinPrice) ?? myListings[0]
          trackerSeller    = myListing.listing.account.name ?? myAccount
          trackerOnline    = 1
          trackerIndexed   = myListing.listing.indexed ?? null
        } else {
          // Hay alguien más barato → usar cheapestOther
          trackerSeller    = cheapestOther?.listing?.account?.name ?? null
          trackerOnline    = cheapestOther?.listing?.account?.online ? 1 : 0
          trackerIndexed   = cheapestOther?.listing?.indexed ?? null
        }

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
        `).run(type, category, trackerPrice, trackerCurrency, trackerSeller, trackerOnline, trackerIndexed, marketTotal ?? 0)

        console.log(`[monitor/check] Tracker actualizado: ${type} → ${trackerPrice} ${trackerCurrency} (${isMinPrice ? 'soy el más barato' : 'hay más baratos'})`)
      }

    } catch (err) {
      console.error('ERROR en item', item.name, err.response?.data || err.message);
      results.push({ item: item.name, myPrice: item.my_price, error: err.message });
    }
  }

  clearInterval(heartbeat)    // ← añadir esto
  send({ status: 'done', results })
  res.end()
});

module.exports = router;