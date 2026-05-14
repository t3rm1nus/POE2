const axios = require('axios');

const BASE_URL = 'https://www.pathofexile.com/api/trade2';
const LEAGUE   = 'Standard';
const REALM    = process.env.POE_REALM || 'poe2';

// ─── Conversión de divisas ────────────────────────────────────────────────────
const ANN_TO_DIV = 0.5; // 2 orbes de anulación = 1 divine

/**
 * Normaliza un precio a divinos.
 * Devuelve null si la divisa no está soportada (se descartará el listing).
 */
function normalizePrice(amount, currency) {
  if (amount == null) return null;
  if (currency === 'divine')     return amount;
  if (currency === 'annulment' || currency === 'annul') return amount * ANN_TO_DIV;
  return null; // chaos, exalted, etc. → no aceptado
}

// ─── Cola: 1 request cada 8s → máx 7-8 req/min, bien por debajo del límite ──
const queue = [];
let processing = false;

const MAX_RETRIES    = 3;
const QUEUE_DELAY_MS = 8000;
const RETRY_BASE_MS  = 15000;

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  const { fn, resolve, reject, retries = 0 } = queue.shift();

  try {
    const result = await fn();
    resolve(result);
  } catch (err) {
    const status = err.response?.status;

    if (status === 429 && retries < MAX_RETRIES) {
      const retryAfter = parseInt(err.response?.headers?.['retry-after'] ?? '0', 10);
      const wait = retryAfter > 0
        ? retryAfter * 1000
        : RETRY_BASE_MS * Math.pow(2, retries);
      console.warn(`Rate limit alcanzado. Reintento ${retries + 1}/${MAX_RETRIES} en ${wait / 1000}s...`);
      setTimeout(() => {
        queue.unshift({ fn, resolve, reject, retries: retries + 1 });
        processing = false;
        processQueue();
      }, wait);
      return;
    }

    reject(err);
  } finally {
    if (processing) {
      setTimeout(() => {
        processing = false;
        processQueue();
      }, QUEUE_DELAY_MS);
    }
  }
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    processQueue();
  });
}

function getHeaders() {
  return {
    'User-Agent':   'POE2MarketWatcher/1.0 (personal tool)',
    'Content-Type': 'application/json',
    'Cookie':       `POESESSID=${process.env.POESESSID}`,
  };
}

async function searchItems(query, { league = LEAGUE, realm = REALM } = {}) {
  return enqueue(async () => {
    const url = `${BASE_URL}/search/${realm}/${encodeURIComponent(league)}`;
    console.log('→ searchItems URL:', url);
    const response = await axios.post(url, query, { headers: getHeaders() });
    return response.data;
  });
}

async function fetchListings(ids, queryId, { realm = REALM } = {}) {
  return enqueue(async () => {
    const chunk    = ids.slice(0, 10).join(',');
    const response = await axios.get(
      `${BASE_URL}/fetch/${chunk}?query=${queryId}&realm=${realm}`,
      { headers: getHeaders() }
    );
    return response.data;
  });
}

async function getCheapestListing(query, { league = LEAGUE, realm = REALM } = {}) {
  const search = await searchItems(query, { league, realm });
  console.log('search result:', search?.id, search?.result?.length);

  if (!search.result || search.result.length === 0) return null;

  const topIds   = search.result.slice(0, 10);
  const listings = await fetchListings(topIds, search.id);
  const sorted   = (listings.result || [])
    .filter(l => l?.listing?.price)
    .sort((a, b) => a.listing.price.amount - b.listing.price.amount);

  return sorted[0] || null;
}

// ─── analyzePrices ────────────────────────────────────────────────────────────
// Busca el mercado general (divine + annulment) y separa mis listings en local.
// Todas las comparaciones se hacen sobre precio normalizado a divinos.
// Devuelve tanto el precio raw (para mostrar) como el normalizado (para comparar).
async function analyzePrices(query, myAccount, { league = LEAGUE, realm = REALM } = {}) {
  const accountLower = myAccount?.toLowerCase();

  const marketQuery = JSON.parse(JSON.stringify(query));

  if (!marketQuery.query.stats)
    marketQuery.query.stats = [{ type: 'and', filters: [], disabled: true }];

  marketQuery.query.status  = { option: 'securable' };
  marketQuery.query.filters = marketQuery.query.filters || {};

  // ── Sin filtro de divisa: aceptamos divine Y annulment ───────────────────
  // Filtramos por divisa en local después de hacer el fetch.
  marketQuery.query.filters.trade_filters = {
    filters: {
      sale_type: { option: 'priced' },
      // price: { option: 'divine' }  ← eliminado para incluir annulment
    },
    disabled: false,
  };

  console.log(`[analyzePrices] realm=${realm} league=${league} type=${query?.query?.type}`);

  const marketSearch = await searchItems(marketQuery, { league, realm });

  const allListings = [];

  if (marketSearch.result?.length > 0) {
    const ids    = marketSearch.result.slice(0, 20);
    const chunk1 = await fetchListings(ids.slice(0, 10), marketSearch.id, { realm });
    allListings.push(...(chunk1.result || []).filter(l => l?.listing?.price));

    if (ids.length > 10) {
      const chunk2 = await fetchListings(ids.slice(10, 20), marketSearch.id, { realm });
      allListings.push(...(chunk2.result || []).filter(l => l?.listing?.price));
    }
  }

  // ── Filtrar a divisas soportadas, añadir normPrice, ordenar ─────────────
  const validListings = allListings
  .filter(l => {
    const c = l.listing.price.currency;
    return c === 'divine' || c === 'annulment' || c === 'annul';
  })
  .map(l => {
    // Normalizar 'annul' → 'annulment' para consistencia interna
    const rawCurrency = l.listing.price.currency;
    const currency = rawCurrency === 'annul' ? 'annulment' : rawCurrency;
    return {
      ...l,
      listing: {
        ...l.listing,
        price: { ...l.listing.price, currency }
      },
      _normPrice: normalizePrice(l.listing.price.amount, currency),
    };
  })
  .filter(l => l._normPrice !== null)
  .sort((a, b) => a._normPrice - b._normPrice);

  // ── Separar mis listings de los del mercado ──────────────────────────────
  const myListings = validListings
    .filter(l => accountLower && l.listing.account.name?.toLowerCase() === accountLower);

  const otherListings = validListings
    .filter(l => !accountLower || l.listing.account.name?.toLowerCase() !== accountLower);

  const cheapestOther = otherListings[0] || null;

  // Precios raw (para mostrar) y normalizados (para comparar)
  const myMinPrice       = myListings[0]?.listing?.price?.amount   ?? null;
  const myMinCurrency    = myListings[0]?.listing?.price?.currency ?? null;
  const myMinNormPrice   = myListings[0]?._normPrice               ?? null;

  const otherMinPrice    = cheapestOther?.listing?.price?.amount   ?? null;
  const otherMinCurrency = cheapestOther?.listing?.price?.currency ?? null;
  const otherMinNormPrice= cheapestOther?._normPrice               ?? null;

  const tied = myMinNormPrice !== null && otherMinNormPrice !== null
            && myMinNormPrice === otherMinNormPrice;

  console.log(
    `[analyzePrices] myMin=${myMinPrice}${myMinCurrency} (norm=${myMinNormPrice})`,
    `otherMin=${otherMinPrice}${otherMinCurrency} (norm=${otherMinNormPrice})`,
    `total=${marketSearch.total} (1 búsqueda)`
  );

  return {
    cheapestOther,
    myListings,
    tied,
    myMinPrice,
    myMinCurrency,
    myMinNormPrice,
    otherMinPrice,
    otherMinCurrency,
    otherMinNormPrice,
    marketTotal: marketSearch.total ?? 0,
  };
}

module.exports = { searchItems, fetchListings, getCheapestListing, analyzePrices, normalizePrice };