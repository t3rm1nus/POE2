const axios = require('axios');

const BASE_URL = 'https://www.pathofexile.com/api/trade2';
const LEAGUE = 'Standard';

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
      // Backoff exponencial: 10s, 20s, 40s
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

// Buscar ítems — devuelve { id: queryId, result: [ids...], total }
async function searchItems(query) {
  return enqueue(async () => {
    const response = await axios.post(
      `${BASE_URL}/search/poe2/${LEAGUE}`,
      query,
      { headers: getHeaders() }
    );
    return response.data;
  });
}

// Obtener detalles de listings por IDs (máx 10 por llamada)
async function fetchListings(ids, queryId) {
  return enqueue(async () => {
    const chunk = ids.slice(0, 10).join(',');
    const response = await axios.get(
      `${BASE_URL}/fetch/${chunk}?query=${queryId}`,
      { headers: getHeaders() }
    );
    return response.data;
  });
}

// Obtener el listing más barato de una búsqueda
async function getCheapestListing(query) {
  const search = await searchItems(query);
  console.log('search result:', search?.id, search?.result?.length);

  if (!search.result || search.result.length === 0) {
    return null;
  }

  const topIds = search.result.slice(0, 10);
  const listings = await fetchListings(topIds, search.id);
  console.log('listings completo:', JSON.stringify(listings));
  console.log('listings raw:', JSON.stringify(listings?.result?.[0], null, 2));
  const sorted = listings.result
    
    .filter(l => l?.listing?.price)
    .sort((a, b) => a.listing.price.amount - b.listing.price.amount);
    console.log('listings.result[0]:', JSON.stringify(listings.result[0], null, 2));
    console.log('sorted[0]:', JSON.stringify(sorted[0]?.listing?.price));

  return sorted[0] || null;
}
async function analyzePrices(query, myAccount) {
  const accountLower = myAccount?.toLowerCase();

  // Deep clone para no mutar el original
  const myQuery = JSON.parse(JSON.stringify(query));
  const marketQuery = JSON.parse(JSON.stringify(query));

  // Añadir filtro de cuenta Y precio divine AL EXISTENTE (no reemplazar)
  myQuery.query.filters = myQuery.query.filters || {};
  myQuery.query.filters.trade_filters = {
    filters: {
      account: { input: myAccount },
      price: { option: 'divine' }
    }
  };

  // Mercado: solo añadir filtro divine, mantener misc_filters intacto
  marketQuery.query.filters = marketQuery.query.filters || {};
  marketQuery.query.filters.trade_filters = {
    filters: {
      price: { option: 'divine' }
    }
  };

  // En serie para respetar rate limit
  const mySearch = await searchItems(myQuery);
  const myListings = [];
  if (mySearch.result?.length > 0) {
    const myFetch = await fetchListings(mySearch.result.slice(0, 10), mySearch.id);
    myListings.push(...myFetch.result.filter(l => l?.listing?.price));
    myListings.sort((a, b) => a.listing.price.amount - b.listing.price.amount);
  }

  const marketSearch = await searchItems(marketQuery);
  const marketListings = [];
  if (marketSearch.result?.length > 0) {
    const marketFetch = await fetchListings(marketSearch.result.slice(0, 10), marketSearch.id);
    const others = marketFetch.result
      .filter(l => l?.listing?.price && l.listing.account.name?.toLowerCase() !== accountLower)
      .sort((a, b) => a.listing.price.amount - b.listing.price.amount);
    marketListings.push(...others);
  }

  const cheapestOther = marketListings[0] || null;
  const myMinPrice = myListings[0]?.listing?.price?.amount ?? null;
  const otherMinPrice = cheapestOther?.listing?.price?.amount ?? null;
  const tied = myMinPrice !== null && otherMinPrice !== null && myMinPrice === otherMinPrice;

  console.log('myMinPrice:', myMinPrice, '| otherMinPrice:', otherMinPrice);

  return { cheapestOther, myListings, tied, myMinPrice, otherMinPrice };
}
module.exports = { searchItems, fetchListings, getCheapestListing , analyzePrices };