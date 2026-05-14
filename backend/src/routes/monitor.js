const express = require('express');
const router = express.Router();
const db = require('../db');
const { analyzePrices } = require('../poeApiClient');
const { GEMS } = require('../tracker');

// 2 annulment = 1 divine
const ANN_TO_DIV = 0.5;

function itemNormPrice(price, currency) {
  if (currency === 'annulment') return price * ANN_TO_DIV;
  return price; // divine
}

// ─── Helper: normalizar campo online de la API de GGG ────────────────────────
function parseOnlineStatus(onlineField) {
  if (onlineField && typeof onlineField === 'object') return 'online';
  if (onlineField === null || onlineField === undefined) return 'unknown';
  if (onlineField === true)  return 'online';
  if (onlineField === false) return 'offline';
  return 'unknown';
}

// ─── GET /api/monitor/items ───────────────────────────────────────────────────
router.get('/items', (req, res) => {
  const items = db.prepare('SELECT * FROM monitor_items ORDER BY created_at DESC').all();
  res.json(items);
});

// ─── POST /api/monitor/items ──────────────────────────────────────────────────
router.post('/items', (req, res) => {
  const { name, query, my_price, currency = 'chaos', category = 'item', quantity = 1 } = req.body;
  if (!name || !query || my_price === undefined) {
    return res.status(400).json({ error: 'Faltan campos: name, query, my_price' });
  }

  const upsert = db.transaction(() => {
    db.prepare('DELETE FROM monitor_items WHERE name = ?').run(name);
    return db.prepare(
      'INSERT INTO monitor_items (name, category, query, my_price, currency, quantity) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, category, JSON.stringify(query), my_price, currency, quantity);
  });

  const result = upsert();
  res.status(201).json({ id: result.lastInsertRowid, name, category, my_price, currency, quantity });
});

// ─── DELETE /api/monitor/items/:id ───────────────────────────────────────────
router.delete('/items/:id', (req, res) => {
  db.prepare('DELETE FROM monitor_items WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ─── GET /api/monitor/check ───────────────────────────────────────────────────
router.get('/check', async (req, res) => {
  const realm  = req.query.realm  || 'sony';
  const league = req.query.league || 'Standard';

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
  });

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // ─── Leer ítems y deduplicar por type ────────────────────────────────────
  const rawItems = db.prepare('SELECT * FROM monitor_items ORDER BY my_price ASC').all();

  const seenTypes = new Map();
  const orphanIds = [];

  for (const item of rawItems) {
    let query;
    try { query = typeof item.query === 'string' ? JSON.parse(item.query) : item.query; }
    catch { orphanIds.push(item.id); continue; }

    const type = query?.query?.type;
    if (!type) { orphanIds.push(item.id); continue; }

    if (!seenTypes.has(type)) {
      seenTypes.set(type, item);
    } else {
      orphanIds.push(item.id);
    }
  }

  if (orphanIds.length > 0) {
    const del = db.prepare('DELETE FROM monitor_items WHERE id = ?');
    const deleteMany = db.transaction((ids) => { for (const id of ids) del.run(id); });
    deleteMany(orphanIds);
    console.log(`[monitor/check] Limpiados ${orphanIds.length} duplicados huérfanos`);
  }

  const items = Array.from(seenTypes.values());

  if (items.length === 0) {
    clearInterval(heartbeat);
    send({ status: 'done', results: [] });
    return res.end();
  }

  const myAccount = process.env.POE_ACCOUNT;
  const results   = [];
  const typeCache = new Map();

  const uniqueTypes  = [...new Set(items.map(item => {
    const query = typeof item.query === 'string' ? JSON.parse(item.query) : item.query;
    return query.query.type;
  }))];
  const totalTypes   = uniqueTypes.length;
  let   checkedTypes = 0;

  send({ status: 'checking', progress: 0, total: totalTypes, message: 'Iniciando comprobación...' });

  for (const item of items) {
    try {
      const query = typeof item.query === 'string' ? JSON.parse(item.query) : item.query;
      const type  = query.query.type;

      if (!query.query.filters) query.query.filters = {};
      if (!query.query.stats)   query.query.stats   = [{ type: 'and', filters: [], disabled: true }];

      if (!query.query.filters.trade_filters) {
        query.query.filters.trade_filters = { filters: {}, disabled: false };
      }
      // Solo precio fijado; la divisa (divine/annulment) se filtra en poeApiClient
      query.query.filters.trade_filters.filters.sale_type = { option: 'priced' };
      delete query.query.filters.trade_filters.filters.price; // acepta divine Y annulment
      query.query.filters.trade_filters.disabled = false;

      if (item.category === 'gem') {
        if (!query.query.filters.misc_filters) {
          query.query.filters.misc_filters = { filters: {}, disabled: false };
        }
        query.query.filters.misc_filters.filters.gem_level   = { min: 21 };
        query.query.filters.misc_filters.filters.gem_sockets = { min: 5  };
        query.query.filters.misc_filters.disabled = false;
      }

      if (!query.query.status) query.query.status = { option: 'securable' };

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

      const {
        cheapestOther,
        myListings,
        myMinPrice,    myMinCurrency,    myMinNormPrice,
        otherMinPrice, otherMinCurrency, otherMinNormPrice,
        marketTotal,
      } = priceData;

      // ── Caso: sin datos ───────────────────────────────────────────────────
      if (!cheapestOther && myListings.length === 0) {
        results.push({
          item:             item.name,
          myPrice:          item.my_price,
          myCurrency:       item.currency,
          marketMin:        null,
          marketNormMin:    null,
          marketCurrency:   null,
          marketTotal:      0,
          isMinPrice:       true,
          tied:             false,
          cheaperOwnExists: false,
          cheaper:          [],
          tiedSeller:       null,
          myListingsCount:  0,
          storedQuantity:   item.quantity ?? 1,
        });
        continue;
      }

      const marketMin      = otherMinPrice;
      const marketNormMin  = otherMinNormPrice;
      const marketCurrency = otherMinCurrency ?? cheapestOther?.listing?.price?.currency ?? item.currency;

      // ── Comparaciones siempre sobre precios normalizados a divine ─────────
      const storedNormPrice    = itemNormPrice(item.my_price, item.currency);
      const cheaperOwnExists   = myMinNormPrice !== null && storedNormPrice > myMinNormPrice;
      const effectiveNormPrice = myMinNormPrice !== null ? myMinNormPrice : storedNormPrice;

      const isMinPrice = marketNormMin === null || effectiveNormPrice <= marketNormMin;
      const tied       = isMinPrice && !cheaperOwnExists && marketNormMin !== null
                      && effectiveNormPrice === marketNormMin;

      const cheapestSeller      = cheapestOther?.listing?.account?.name ?? null;
      const cheapestOnlineStatus = parseOnlineStatus(cheapestOther?.listing?.account?.online);
      const noActiveListings    = myListings.length === 0;

      console.log(
        `[monitor/check] ${item.name} | myNorm=${effectiveNormPrice} mktNorm=${marketNormMin}`,
        `isMin=${isMinPrice} tied=${tied} | mkt: ${marketMin} ${marketCurrency}`,
        `| ${cheapestSeller} online=${cheapestOnlineStatus}`
      );

      // Auto-sincronizar DB cuando el precio activo difiere del guardado
      if (cheaperOwnExists && myMinPrice !== null) {
        db.prepare('UPDATE monitor_items SET my_price = ?, currency = ? WHERE id = ?')
          .run(myMinPrice, myMinCurrency ?? item.currency, item.id);
        item.my_price = myMinPrice;
        item.currency = myMinCurrency ?? item.currency;
        console.log(`[monitor/check] Precio actualizado: ${item.name} → ${myMinPrice} ${item.currency}`);
      }

      results.push({
        item:             item.name,
        myPrice:          item.my_price,
        myCurrency:       item.currency,
        myNormPrice:      effectiveNormPrice,
        marketMin,
        marketNormMin,
        marketCurrency,
        marketTotal:      marketTotal ?? 0,
        myActiveMin:      myMinPrice,
        myActiveCurrency: myMinCurrency ?? item.currency,
        cheaperOwnExists,
        isMinPrice:       noActiveListings ? false : isMinPrice,
        tied:             noActiveListings ? false : tied,
        noActiveListings,
        cheapestSeller,
        cheapestOnline:   cheapestOnlineStatus,
        tiedSeller: tied ? {
          seller: cheapestSeller,
          online: cheapestOnlineStatus,
        } : null,
        myListingsCount:  myListings.length,
        storedQuantity:   item.quantity ?? 1,
        cheaper: (noActiveListings || !isMinPrice) ? [{
          seller:   cheapestSeller,
          price:    marketMin,
          normPrice: marketNormMin,
          currency: marketCurrency,
          online:   cheapestOnlineStatus,
        }] : [],
      });

      // ─── Actualizar caché Tracker ──────────────────────────────────────────
      const gemInfo  = GEMS.find(g => g.type === type);
      const cached   = db.prepare('SELECT category FROM gem_market_prices WHERE gem_type=? AND realm=? AND league=?').get(type, realm, league);
      const category = gemInfo?.cat ?? cached?.category ?? 'item';

      const efectivaIsMinPrice = !noActiveListings && isMinPrice;
      // Guardar precio raw + currency para display correcto en Tracker
      const trackerPrice    = efectivaIsMinPrice ? myMinPrice    : marketMin;
      const trackerCurrency = efectivaIsMinPrice ? (myMinCurrency ?? item.currency) : marketCurrency;

      if (noActiveListings) {
        if (cheapestOther && otherMinPrice !== null) {
          db.prepare(`
            INSERT INTO gem_market_prices
              (gem_type, realm, league, category, cheapest_price, currency,
               seller, seller_online, indexed, total_listings, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(gem_type, realm, league) DO UPDATE SET
              cheapest_price = excluded.cheapest_price,
              currency       = excluded.currency,
              seller         = excluded.seller,
              seller_online  = excluded.seller_online,
              indexed        = excluded.indexed,
              total_listings = excluded.total_listings,
              fetched_at     = excluded.fetched_at
          `).run(
            type, realm, league, category, otherMinPrice, marketCurrency,
            cheapestSeller, cheapestOnlineStatus,
            cheapestOther.listing?.indexed ?? null,
            marketTotal ?? 0
          );
          console.log(`[monitor/check] Tracker actualizado tras venta: ${type} → ${otherMinPrice} ${marketCurrency}`);
        } else {
          db.prepare('DELETE FROM gem_market_prices WHERE gem_type=? AND realm=? AND league=?').run(type, realm, league);
          console.log(`[monitor/check] Tracker eliminado: ${type} (vendido y sin mercado)`);
        }
      } else if (trackerPrice !== null) {
        let trackerSeller, trackerOnline, trackerIndexed;

        if (efectivaIsMinPrice && myListings.length > 0) {
          const myListing = myListings.find(l => l.listing.price.amount === myMinPrice) ?? myListings[0];
          trackerSeller  = myListing.listing.account.name ?? myAccount;
          trackerOnline  = 'online';
          trackerIndexed = myListing.listing.indexed ?? null;
        } else {
          trackerSeller  = cheapestSeller;
          trackerOnline  = cheapestOnlineStatus;
          trackerIndexed = cheapestOther?.listing?.indexed ?? null;
        }

        db.prepare(`
          INSERT INTO gem_market_prices
            (gem_type, realm, league, category, cheapest_price, currency,
             seller, seller_online, indexed, total_listings, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(gem_type, realm, league) DO UPDATE SET
            cheapest_price = excluded.cheapest_price,
            currency       = excluded.currency,
            seller         = excluded.seller,
            seller_online  = excluded.seller_online,
            indexed        = excluded.indexed,
            total_listings = excluded.total_listings,
            fetched_at     = excluded.fetched_at
        `).run(type, realm, league, category, trackerPrice, trackerCurrency,
               trackerSeller, trackerOnline, trackerIndexed, marketTotal ?? 0);

        console.log(`[monitor/check] Tracker: ${type} → ${trackerPrice} ${trackerCurrency} seller_online=${trackerOnline}`);
      }

    } catch (err) {
      console.error('ERROR en item', item.name, err.response?.data || err.message);
      results.push({ item: item.name, myPrice: item.my_price, error: err.message });
    }
  }

  clearInterval(heartbeat);
  send({ status: 'done', results });
  res.end();
});

module.exports = router;