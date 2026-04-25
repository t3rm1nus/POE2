// backend/src/routes/ranking.js
const express = require('express');
const router  = express.Router();
const { searchItems, fetchListings } = require('../poeApiClient');
const db = require('../db');
const { GEMS } = require('../tracker');

// ─── Tabla de snapshots (tendencias de gemas) ─────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS ranking_snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    gem_type      TEXT    NOT NULL,
    league        TEXT    NOT NULL,
    realm         TEXT    NOT NULL,
    min_price     REAL,
    median_price  REAL,
    listing_count INTEGER DEFAULT 0,
    currency      TEXT    DEFAULT 'divine',
    checked_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_ranking_snap
    ON ranking_snapshots(gem_type, league, realm, checked_at);
`);

// ─── Helper: query de trade para gema Nv21 5 sockets ─────────────────────────
function buildGemQuery(type, currency = 'divine') {
  return {
    query: {
      type,
      status: { option: 'online' },
      stats:  [{ type: 'and', filters: [], disabled: true }],
      filters: {
        misc_filters: {
          filters: {
            gem_level:   { min: 21 },
            gem_sockets: { min: 5  },
          },
          disabled: false,
        },
        trade_filters: {
          filters: {
            sale_type: { option: 'priced' },
            price:     { option: currency },
          },
          disabled: false,
        },
      },
    },
    sort: { price: 'asc' },
  };
}

// ─── GET /api/ranking/gems  (SSE) ─────────────────────────────────────────────
router.get('/gems', async (req, res) => {
  const realm    = req.query.realm    || 'pc';
  const league   = req.query.league   || 'Standard';
  const limit    = Math.min(parseInt(req.query.limit) || 30, GEMS.length);
  const currency = req.query.currency || 'divine';

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let closed = false;
  const heartbeat = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15000);
  req.on('close', () => { closed = true; clearInterval(heartbeat); });

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const gemsToRank = GEMS.slice(0, limit);
  const results    = [];

  send({ status: 'checking', progress: 0, total: gemsToRank.length, message: 'Iniciando consulta al mercado...' });

  for (let i = 0; i < gemsToRank.length; i++) {
    if (closed) break;
    const gem = gemsToRank[i];

    send({ status: 'checking', progress: i, total: gemsToRank.length, message: `Consultando ${gem.name ?? gem.type}...` });

    try {
      const query  = buildGemQuery(gem.type, currency);
      const search = await searchItems(query, { league, realm });

      if (!search?.result?.length) {
        results.push({ type: gem.type, name: gem.name ?? gem.type, cat: gem.cat ?? 'gem',
          minPrice: null, medianPrice: null, listingCount: search?.total ?? 0,
          currency, trend: 0, trendAbs: 0, sellers: [] });
        continue;
      }

      const topIds   = search.result.slice(0, 10);
      const fetched  = await fetchListings(topIds, search.id, { realm });
      const valid    = (fetched.result || []).filter(l => l?.listing?.price);
      const prices   = valid.map(l => l.listing.price.amount).sort((a, b) => a - b);

      if (!prices.length) continue;

      const minPrice     = prices[0];
      const medianPrice  = prices[Math.floor(prices.length / 2)];
      const gemCurrency  = valid[0]?.listing?.price?.currency ?? currency;
      const listingCount = search.total ?? 0;
      const sellers      = valid.slice(0, 3).map(l => ({
        account: l.listing.account.name,
        price:   l.listing.price.amount,
        online:  !!l.listing.account.online,
      }));

      const prev = db.prepare(`
        SELECT min_price FROM ranking_snapshots
        WHERE gem_type = ? AND league = ? AND realm = ?
        ORDER BY checked_at DESC LIMIT 1
      `).get(gem.type, league, realm);

      const trendAbs = prev?.min_price != null ? (minPrice - prev.min_price) : 0;
      const trend    = prev?.min_price != null && prev.min_price > 0
        ? ((minPrice - prev.min_price) / prev.min_price) * 100 : 0;

      db.prepare(`
        INSERT INTO ranking_snapshots (gem_type, league, realm, min_price, median_price, listing_count, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(gem.type, league, realm, minPrice, medianPrice, listingCount, gemCurrency);

      results.push({ type: gem.type, name: gem.name ?? gem.type, cat: gem.cat ?? 'gem',
        minPrice, medianPrice, listingCount, currency: gemCurrency,
        trend: parseFloat(trend.toFixed(1)), trendAbs: parseFloat(trendAbs.toFixed(2)), sellers });

    } catch (err) {
      console.error('[ranking] Error en', gem.type, err.message);
      results.push({ type: gem.type, name: gem.name ?? gem.type, cat: gem.cat ?? 'gem',
        error: err.message, minPrice: null, medianPrice: null, listingCount: 0,
        currency, trend: 0, trendAbs: 0 });
    }

    send({ status: 'checking', progress: i + 1, total: gemsToRank.length, message: `${i + 1}/${gemsToRank.length} gemas consultadas` });
  }

  clearInterval(heartbeat);
  send({ status: 'done', results, fetchedAt: Date.now() });
  res.end();
});

// ─── GET /api/ranking/history/:gemType ───────────────────────────────────────
router.get('/history/:gemType', (req, res) => {
  const { gemType } = req.params;
  const realm  = req.query.realm  || 'pc';
  const league = req.query.league || 'Fate of the Vaal';
  const days   = Math.min(parseInt(req.query.days) || 7, 30);
  const since  = Math.floor(Date.now() / 1000) - days * 86400;

  const rows = db.prepare(`
    SELECT min_price, median_price, listing_count, currency, checked_at
    FROM ranking_snapshots
    WHERE gem_type = ? AND league = ? AND realm = ? AND checked_at >= ?
    ORDER BY checked_at ASC
  `).all(gemType, league, realm, since);

  res.json(rows);
});

// ─── poe2scout helpers ────────────────────────────────────────────────────────
const POE2SCOUT_BASE = 'https://poe2scout.com/api';
const POE2SCOUT_UA   = 'poe2market-watcher/1.0 (contact: usuario@ejemplo.com)';

async function poe2scoutFetch(path) {
  const res = await fetch(`${POE2SCOUT_BASE}${path}`, {
    headers: { 'User-Agent': POE2SCOUT_UA, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`poe2scout ${path}: HTTP ${res.status}`);
  return res.json();
}

function normalizeItem(item, category) {
  // La API devuelve PascalCase: CurrentPrice, PriceLogs, IconUrl, etc.
  const price = item.CurrentPrice ?? item.currentPrice ?? item.current_price ?? 0;
  const logs  = item.PriceLogs    ?? item.priceLogs    ?? item.price_logs    ?? [];

  let change1d = null;
  if (logs.length >= 2) {
    const newest = logs[logs.length - 1]?.Price ?? logs[logs.length - 1]?.price ?? logs[logs.length - 1];
    const oldest = logs[Math.max(0, logs.length - 5)]?.Price ?? logs[Math.max(0, logs.length - 5)]?.price ?? logs[Math.max(0, logs.length - 5)];
    if (newest != null && oldest != null && oldest > 0)
      change1d = parseFloat((((newest - oldest) / oldest) * 100).toFixed(1));
  }

  return {
    name:         item.Text         ?? item.name          ?? 'Desconocido',
    type:         category,
    icon:         item.IconUrl      ?? item.icon          ?? null,
    divineValue:  typeof price === 'number' ? price : 0,
    chaosValue:   item.ChaosValue   ?? item.chaosValue    ?? item.chaos_value   ?? 0,
    listingCount: item.ListingCount ?? item.listingCount  ?? item.listing_count ?? 0,
    change1d,
    links:        item.Links        ?? item.links         ?? null,
    corrupted:    item.Corrupted    ?? item.corrupted     ?? false,
    gemLevel:     item.GemLevel     ?? item.gemLevel      ?? item.gem_level     ?? null,
    gemQuality:   item.GemQuality   ?? item.gemQuality    ?? item.gem_quality   ?? null,
    detailsId:    item.ApiId        ?? item.apiId         ?? item.api_id        ?? null,
  };
}

// ─── GET /api/ranking/top100 ──────────────────────────────────────────────────
router.get('/top100', async (req, res) => {
  console.log('[ranking/top100] ▶ Llamada recibida', req.query);
  const league = req.query.league || 'Standard';
  const limit  = Math.min(parseInt(req.query.limit) || 100, 200);
  const realm  = 'poe2';

  try {
    // 1. Categorías disponibles
    let catData = null;
    try {
      catData = await poe2scoutFetch(`/${realm}/Items/Categories?LeagueName=${encodeURIComponent(league)}`);
    } catch (e) {
      console.warn('[ranking/top100] Categories falló:', e.message);
    }

    const rawUnique   = catData?.UniqueCategories   ?? catData?.uniqueCategories   ?? [];
    const rawCurrency = catData?.CurrencyCategories ?? catData?.currencyCategories ?? [];

    const uniqueCategories = rawUnique.length
      ? rawUnique.map(c => c.ApiId ?? c.api_id ?? c.id ?? c)
      : ['weapon', 'armour', 'accessory', 'flask', 'jewel'];

    const currencyCategories = rawCurrency.length
      ? rawCurrency.map(c => c.ApiId ?? c.api_id ?? c.id ?? c)
      : ['currency', 'fragments'];

    console.log('[ranking/top100] uniqueCategories:', uniqueCategories);
    console.log('[ranking/top100] currencyCategories:', currencyCategories);

    // 2. Únicos por categoría (en paralelo)
    const uniqueResults = await Promise.all(
      uniqueCategories.map(cat =>
        poe2scoutFetch(
          `/${realm}/Leagues/${encodeURIComponent(league)}/Uniques/ByCategory?Category=${encodeURIComponent(cat)}&perPage=50&referenceCurrency=divine`
        )
          .then(json => {
            const arr = json.Items ?? json.items ?? json.uniques ?? [];
            if (cat === uniqueCategories[0]) {
              console.log('[ranking/top100] 🧪 Uniques sample:', JSON.stringify(arr[0] ?? 'vacío'));
            }
            return arr.map(i => normalizeItem(i, cat));
          })
          .catch(err => { console.warn(`[ranking/top100] Uniques/${cat}:`, err.message); return []; })
      )
    );

    // 3. Divisas por categoría
    const currencyResults = await Promise.all(
      currencyCategories.map(cat =>
        poe2scoutFetch(
          `/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?Category=${encodeURIComponent(cat)}&perPage=30&referenceCurrency=divine`
        )
          .then(json => {
            const arr = json.Items ?? json.items ?? json.currencies ?? [];
            return arr.map(i => normalizeItem(i, 'currency'));
          })
          .catch(err => { console.warn(`[ranking/top100] Currencies/${cat}:`, err.message); return []; })
      )
    );

    const allItems = [...uniqueResults.flat(), ...currencyResults.flat()]
      .filter(i => i.divineValue > 0)
      .sort((a, b) => b.divineValue - a.divineValue)
      .slice(0, limit);

    console.log('[ranking/top100] ✅ Total ítems:', allItems.length);

    res.json({ items: allItems, fetchedAt: Date.now(), league, realm, source: 'poe2scout.com' });

  } catch (err) {
    console.error('[ranking/top100] Error general:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;