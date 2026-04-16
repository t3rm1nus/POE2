const axios = require('axios');

const BASE_URL = 'https://www.pathofexile.com/api/trade2';
const LEAGUE   = 'Standard';
// ✅ FIX PROBLEMA 3: el default es 'sony' (PS5), nunca 'pc'
const REALM = process.env.POE_REALM || 'poe2';

// Cola simple para respetar rate limits (12 req / 60s)
const queue = [];
let processing = false;

const MAX_RETRIES = 3;

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
      const wait = 10000 * Math.pow(2, retries);
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
      }, 5000);
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
    'User-Agent': 'POE2MarketWatcher/1.0 (personal tool)',
    'Content-Type': 'application/json',
    'Cookie': `POESESSID=${process.env.POESESSID}`,
  };
}

// ✅ FIX PROBLEMA 2: eliminado filtro de antigüedad por fecha (listing.indexed),
// sustituido por sale_type = 'buyout' en los trade_filters de la query.
// Esto garantiza que solo se devuelven listings con precio fijo (compra inmediata),
// que es exactamente lo que opera en PS5 Standard.
// El filtro de fecha era poco fiable porque GGG no garantiza que `indexed` sea preciso.

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
    const chunk = ids.slice(0, 10).join(',');
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

  if (!search.result || search.result.length === 0) {
    return null;
  }

  const topIds = search.result.slice(0, 10);
  const listings = await fetchListings(topIds, search.id);
  const sorted = (listings.result || [])
    .filter(l => l?.listing?.price)
    .sort((a, b) => a.listing.price.amount - b.listing.price.amount);

  return sorted[0] || null;
}

async function analyzePrices(query, myAccount, { league = LEAGUE, realm = REALM } = {}) {
  const accountLower = myAccount?.toLowerCase();

  // ── Clonar queries antes de mutar ──────────────────────────────────────────
  const myQuery     = JSON.parse(JSON.stringify(query));
  const marketQuery = JSON.parse(JSON.stringify(query));
  // Asegurar status: securable (igual que la web oficial)
  myQuery.query.status     = { option: 'securable' };
  marketQuery.query.status = { option: 'securable' };

  // ✅ FIX PROBLEMA 2: añadir sale_type: 'buyout' para filtrar solo compra inmediata
  // Esto reemplaza el filtro de antigüedad por fecha que era poco fiable
  myQuery.query.filters = myQuery.query.filters || {};
  myQuery.query.filters.trade_filters = {
    filters: {
      sale_type: { option: 'priced' },
      account:   { input: myAccount },
      price:     { option: 'divine' },
    }
  };

  marketQuery.query.filters = marketQuery.query.filters || {};
  marketQuery.query.filters.trade_filters = {
    filters: {
      sale_type: { option: 'priced' },
      price:     { option: 'divine' },
    }
  };

  console.log(`[analyzePrices] realm=${realm} league=${league} type=${query?.query?.type}`);

  // ── Mis listings ───────────────────────────────────────────────────────────
  const mySearch   = await searchItems(myQuery, { league, realm });
  const myListings = [];
  if (mySearch.result?.length > 0) {
    const myFetch     = await fetchListings(mySearch.result.slice(0, 10),     mySearch.id,     { realm });
    const filtered = (myFetch.result || []).filter(l => l?.listing?.price);
    myListings.push(...filtered);
    myListings.sort((a, b) => a.listing.price.amount - b.listing.price.amount);
  }

  // ── Mercado general ────────────────────────────────────────────────────────
  const marketSearch   = await searchItems(marketQuery, { league, realm });
  const marketListings = [];
  if (marketSearch.result?.length > 0) {
    const marketFetch = await fetchListings(marketSearch.result.slice(0, 10), marketSearch.id, { realm });
    const others = (marketFetch.result || [])
      .filter(l =>
        l?.listing?.price &&
        l.listing.account.name?.toLowerCase() !== accountLower
      )
      .sort((a, b) => a.listing.price.amount - b.listing.price.amount);
    marketListings.push(...others);
  }

  const cheapestOther = marketListings[0] || null;
  const myMinPrice    = myListings[0]?.listing?.price?.amount  ?? null;
  const otherMinPrice = cheapestOther?.listing?.price?.amount  ?? null;
  const tied          = myMinPrice !== null && otherMinPrice !== null && myMinPrice === otherMinPrice;
  console.log(`[analyzePrices] myMin=${myMinPrice} otherMin=${otherMinPrice} total=${marketSearch.total}`);

  return { cheapestOther, myListings, tied, myMinPrice, otherMinPrice, marketTotal: marketSearch.total ?? 0 };
}

module.exports = { searchItems, fetchListings, getCheapestListing, analyzePrices };