const express = require('express');
const router = express.Router();
const axios = require('axios');
const { translateItemName } = require('../gemTranslations');
const db = require('../db');

const BASE_URL = 'https://www.pathofexile.com/api/trade2';
const LEAGUE = 'Standard';
const CHUNK_SIZE = 10;
const DELAY_MS = 8000;
const { GEMS } = require('../tracker');
const gemCatMap = Object.fromEntries(GEMS.map(g => [g.type, g.cat]));

function getHeaders() {
  return {
    'User-Agent': 'POE2MarketWatcher/1.0 (personal tool)',
    'Content-Type': 'application/json',
    'Cookie': `POESESSID=${process.env.POESESSID}`,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchChunkWithRetry(ids, queryId, retries = 0) {
  try {
    const chunk = ids.join(',');
    const res = await axios.get(
      `${BASE_URL}/fetch/${chunk}?query=${queryId}`,
      { headers: getHeaders() }
    );
    return res.data.result;
  } catch (err) {
    if (err.response?.status === 429 && retries < 3) {
      const wait = 60000 * (retries + 1);
      console.warn(`429 en import. Esperando ${wait/1000}s...`);
      await sleep(wait);
      return fetchChunkWithRetry(ids, queryId, retries + 1);
    }
    throw err;
  }
}

router.get('/listings', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const account = process.env.POE_ACCOUNT || req.query.account;
    if (!account) {
      send({ error: 'Falta parámetro account' });
      return res.end();
    }

    send({ status: 'searching', message: 'Buscando tus listings...' });

    const searchRes = await axios.post(
      `${BASE_URL}/search/poe2/${LEAGUE}`,
      {
        query: {
          filters: {
            trade_filters: {
              filters: {
                account: { input: account },
                // Filtrar solo listings en divine desde la API
                price: { option: 'divine' }
              }
            },
            misc_filters: {
              filters: {
                gem_level: { min: 21 },
                gem_sockets: { min: 5 }
              },
              disabled: false
            }
          }
        }
      },
      { headers: getHeaders() }
    );

    const { id: queryId, result: allIds, total } = searchRes.data;
    send({ status: 'found', total, message: `${total} listings encontrados` });

    if (!allIds || allIds.length === 0) {
      send({ status: 'done', items: [] });
      return res.end();
    }

    const items = [];
    const chunks = [];
    for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
      chunks.push(allIds.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i++) {
      send({
        status: 'fetching',
        progress: i + 1,
        total_chunks: chunks.length,
        message: `Chunk ${i + 1}/${chunks.length}...`
      });

      const results = await fetchChunkWithRetry(chunks[i], queryId);

      for (const r of results) {
        if (!r?.listing?.price || !r?.item) continue;

        const currency = r.listing.price.currency;
        if (currency !== 'divine') continue;

        const isGem = true;
        const rawName = r.item.name || r.item.typeLine;
        const rawType = r.item.typeLine || r.item.baseType;
        const translatedName = isGem ? await translateItemName(rawName || rawType) : rawName;

        items.push({
          name: translatedName,
          type: rawType,
          my_price: r.listing.price.amount,
          currency: 'divine',
          category: isGem ? 'gem' : 'item',
        });
      }

      if (i < chunks.length - 1) await sleep(DELAY_MS);
    }

    

    // Como SQLite no tiene ON CONFLICT por columna no-unique fácilmente,
    // hacemos el upsert manual: borrar los del mismo type e insertar los nuevos
    const types = [...new Set(items.map(i => i.type))];
    console.log('Guardando en BD:', items.length, 'items');
    console.log('DB path:', db.name); // mejor-sqlite3 expone el path así
    for (const type of types) {
      db.prepare("DELETE FROM monitor_items WHERE json_extract(query, '$.query.type') = ?").run(type);
    }

    // Reemplazar el bloque de DELETE + INSERT por esto:
    for (const item of items) {
      const isGem = item.category === 'gem';
      const query = isGem ? {
        query: {
          type: item.type,
          stats: [{ type: 'and', filters: [], disabled: true }],
          status: { option: 'any' },
          filters: {
            misc_filters: {
              filters: { gem_level: { min: 21 }, gem_sockets: { min: 5 } },
              disabled: false
            },
            trade_filters: {
              filters: { price: { option: 'divine' } }
            }
          }
        },
        sort: { price: 'asc' }
      } : {
        query: {
          type: item.type,
          filters: {
            trade_filters: {
              filters: { price: { option: 'divine' } }
            }
          }
        },
        sort: { price: 'asc' }
      };

      // Upsert por name + my_price: si existe ese name con ese precio, actualizar; si no, insertar
      const existing = db.prepare('SELECT id FROM monitor_items WHERE name = ? AND my_price = ?').get(item.name, item.my_price);
      if (existing) {
        db.prepare('UPDATE monitor_items SET query = ?, currency = ?, category = ? WHERE id = ?')
          .run(JSON.stringify(query), item.currency, item.category, existing.id);
      } else {
        db.prepare('INSERT INTO monitor_items (name, category, query, my_price, currency) VALUES (?, ?, ?, ?, ?)')
          .run(item.name, item.category, JSON.stringify(query), item.my_price, item.currency);
      }
      if (item.category === 'gem') {
        const gemType     = item.type;                          // ✅ variable correcta
        const gemCategory = gemCatMap[gemType] || null;
        const myPrice     = item.my_price;                      // ✅ variable correcta

        const cached = db.prepare(
          'SELECT cheapest_price FROM gem_market_prices WHERE gem_type = ?'
        ).get(gemType);
        if (!cached || cached.cheapest_price === null || myPrice <= cached.cheapest_price) {
          db.prepare(`
            INSERT INTO gem_market_prices
              (gem_type, category, cheapest_price, currency, seller, seller_online, total_listings, fetched_at)
            VALUES (?, ?, ?, 'divine', ?, 1, 1, datetime('now'))
            ON CONFLICT(gem_type) DO UPDATE SET
              cheapest_price = excluded.cheapest_price,
              seller         = excluded.seller,
              seller_online  = 1,
              fetched_at     = excluded.fetched_at
          `).run(gemType, gemCategory, myPrice, process.env.POE_ACCOUNT);
        }
        
      }
      
      


    }

    send({ status: 'done', items });
    res.end();

  } catch (err) {
    console.error('Error en import:', err.response?.data || err.message);
    send({ error: err.message });
    res.end();
  }
});

module.exports = router;