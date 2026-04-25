const express = require('express');
const router = express.Router();
const axios = require('axios');
const { translateItemName } = require('../gemTranslations');
const db = require('../db');

const BASE_URL = 'https://www.pathofexile.com/api/trade2';
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
      console.warn(`429 en import. Esperando ${wait / 1000}s...`);
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
    const realm  = req.query.realm  || 'pc';
    const league = req.query.league || 'Standard';
    const account = process.env.POE_ACCOUNT || req.query.account;

    if (!account) {
      send({ error: 'Falta parámetro account' });
      return res.end();
    }

    send({ status: 'searching', message: 'Buscando tus listings...' });

    const searchRes = await axios.post(
      `${BASE_URL}/search/poe2/${league}`,
      {
        query: {
          filters: {
            trade_filters: {
              filters: {
                account: { input: account },
                price: { option: 'divine' }
              }
            },
            misc_filters: {
              filters: {
                gem_level:   { min: 21 },
                gem_sockets: { min: 5  }
              },
              disabled: false
            }
          }
        }
      },
      {
        headers: {
          ...getHeaders(),
          // realm se pasa como query param en la URL para PlayStation
          ...(realm === 'sony' ? {} : {})
        },
        params: realm === 'sony' ? { realm: 'sony' } : {}
      }
    );

    const { id: queryId, result: allIds, total } = searchRes.data;
    send({ status: 'found', total, message: `${total} listings encontrados` });

    if (!allIds || allIds.length === 0) {
      const existing = db.prepare('SELECT COUNT(*) as n FROM monitor_items').get().n
      if (existing > 0) {
        // La API devolvió 0 pero tenemos ítems guardados → probablemente error de sesión o liga
        // No borramos nada para no perder datos por un fallo transitorio
        send({
          status: 'done',
          items: [],
          warn: 'La API devolvió 0 listings. Si tienes gemas a la venta, comprueba tu POESESSID y la liga seleccionada.'
        });
      } else {
        send({ status: 'done', items: [] });
      }
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

        const rawName  = r.item.name     || r.item.typeLine;
        const rawType  = r.item.typeLine || r.item.baseType;
        const translatedName = await translateItemName(rawName || rawType);

        items.push({
          name:     translatedName,
          type:     rawType,
          my_price: r.listing.price.amount,
          currency: 'divine',
          category: 'gem',
        });
      }

      if (i < chunks.length - 1) await sleep(DELAY_MS);
    }

    // ─── Fuente de verdad: el import manda ──────────────────────────────────
    // Borramos TODO y reinsertamos desde cero con los datos frescos de la API.
    // Así los precios rebajados reemplazan a los anteriores sin dejar huérfanos,
    // y los ítems que ya no aparecen (vendidos) desaparecen solos.
    db.prepare('DELETE FROM monitor_items').run();
    console.log(`[import] monitor_items limpiado. Reimportando ${items.length} ítems...`);

    for (const item of items) {
      const query = {
        query: {
          type:   item.type,
          stats:  [{ type: 'and', filters: [], disabled: true }],
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
      };

      db.prepare(
        'INSERT INTO monitor_items (name, category, query, my_price, currency) VALUES (?, ?, ?, ?, ?)'
      ).run(item.name, item.category, JSON.stringify(query), item.my_price, item.currency);

      // ─── Actualizar caché del Tracker ──────────────────────────────────────
      // Solo sobrescribimos gem_market_prices si nuestro precio es igual o más
      // barato que el que había en caché (podría haber alguien más barato).
      const gemType     = item.type;
      const gemCategory = gemCatMap[gemType] || null;
      const myPrice     = item.my_price;

      const cached = db.prepare(
        'SELECT cheapest_price FROM gem_market_prices WHERE gem_type = ? AND realm = ? AND league = ?'
      ).get(gemType, realm, league);
      
      if (!cached || cached.cheapest_price === null || myPrice <= cached.cheapest_price) {
        db.prepare(`
          INSERT INTO gem_market_prices
            (gem_type, realm, league, category, cheapest_price, currency, seller, seller_online, total_listings, fetched_at)
          VALUES (?, ?, ?, ?, ?, 'divine', ?, 'online', 1, datetime('now'))
          ON CONFLICT(gem_type, realm, league) DO UPDATE SET
            category       = excluded.category,
            cheapest_price = excluded.cheapest_price,
            seller         = excluded.seller,
            seller_online  = 'online',
            fetched_at     = excluded.fetched_at
        `).run(gemType, realm, league, gemCategory, myPrice, process.env.POE_ACCOUNT);
      }
    }

    console.log(`[import] ${items.length} ítems guardados en monitor_items.`);
    send({ status: 'done', items });
    res.end();

  } catch (err) {
    console.error('Error en import:', err.response?.data || err.message);
    send({ error: err.message });
    res.end();
  }
});

module.exports = router;