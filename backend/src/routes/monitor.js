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

// Ahora es GET con SSE para poder enviar progreso en tiempo real
router.get('/check', async (req, res) => {
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

  // Calcular types únicos para la barra de progreso
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

      let priceData;
      if (typeCache.has(type)) {
        priceData = typeCache.get(type);
      } else {
        send({ status: 'checking', progress: checkedTypes, total: totalTypes, message: `Comprobando ${item.name}...` });
        priceData = await analyzePrices(query, myAccount);
        typeCache.set(type, priceData);
        checkedTypes++;
        send({ status: 'checking', progress: checkedTypes, total: totalTypes, message: `Comprobando ${item.name}...` });
      }

      const { cheapestOther, myListings, myMinPrice, otherMinPrice } = priceData;

      if (!cheapestOther && myListings.length === 0) {
        results.push({ item: item.name, myPrice: item.my_price, myCurrency: item.currency, marketMin: null, isMinPrice: true, tied: false, cheaperOwnExists: false, cheaper: [] });
        continue;
      }

      const marketMin = otherMinPrice;
      const marketCurrency = cheapestOther?.listing?.price?.currency ?? item.currency;
      const isMinPrice = marketMin === null || item.my_price <= marketMin;
      const cheaperOwnExists = myMinPrice !== null && item.my_price > myMinPrice;
      const tied = isMinPrice && !cheaperOwnExists && marketMin !== null && item.my_price === marketMin;

      results.push({
        item: item.name,
        myPrice: item.my_price,
        myCurrency: item.currency,
        marketMin,
        marketCurrency,
        myActiveMin: myMinPrice,
        cheaperOwnExists,
        isMinPrice,
        tied,
        cheaper: isMinPrice ? [] : [{
          seller: cheapestOther.listing.account.name,
          price: marketMin,
          currency: marketCurrency,
          online: cheapestOther.listing.account.online,
        }]
      });
    } catch (err) {
      console.error('ERROR en item', item.name, err.response?.data || err.message);
      results.push({ item: item.name, error: err.message });
    }
  }

  send({ status: 'done', results });
  res.end();
});

module.exports = router;