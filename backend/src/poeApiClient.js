const axios = require('axios');

const BASE_URL = 'https://www.pathofexile.com/api/trade2';
const LEAGUE = 'Standard';
const REALM = process.env.POE_REALM || 'sony'; // 'sony' para PS5, 'poe2' para PC

// Cola simple para respetar rate limits (12 req / 60s)
const queue = [];
let processing = false;

const MAX_RETRIES = 3;

// ─── Filtro de antigüedad ────────────────────────────────────────────────────
// Descarta listings con listing.indexed anterior a N meses
const MAX_LISTING_AGE_MONTHS = 3;

function isListingRecent(listing) {
  if (!listing?.indexed) return true; // si no hay fecha, no filtrar
  const indexed = new Date(listing.indexed);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MAX_LISTING_AGE_MONTHS);
  return indexed >= cutoff;
}

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

async function searchItems(query) {
  return enqueue(async () => {
    const response = await axios.post(
      `${BASE_URL}/search/${REALM}/${LEAGUE}`,
      query,
      { headers: getHeaders() }
    );
    return response.data;
  });
}

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
    .filter(l => l?.listing?.price && isListingRecent(l.listing))
    .sort((a, b) => a.listing.price.amount - b.listing.price.amount);
  console.log('listings.result[0]:', JSON.stringify(listings.result[0], null, 2));
  console.log('sorted[0]:', JSON.stringify(sorted[0]?.listing?.price));

  return sorted[0] || null;
}

async function analyzePrices(query, myAccount) {
  const accountLower = myAccount?.toLowerCase();

  const myQuery = JSON.parse(JSON.stringify(query));
  const marketQuery = JSON.parse(JSON.stringify(query));

  myQuery.query.filters = myQuery.query.filters || {};
  myQuery.query.filters.trade_filters = {
    filters: {
      account: { input: myAccount },
      price: { option: 'divine' }
    }
  };

  marketQuery.query.filters = marketQuery.query.filters || {};
  marketQuery.query.filters.trade_filters = {
    filters: {
      price: { option: 'divine' }
    }
  };

  const mySearch = await searchItems(myQuery);
  const myListings = [];
  if (mySearch.result?.length > 0) {
    const myFetch = await fetchListings(mySearch.result.slice(0, 10), mySearch.id);
    const filtered = myFetch.result
      .filter(l => l?.listing?.price && isListingRecent(l.listing));
    myListings.push(...filtered);
    myListings.sort((a, b) => a.listing.price.amount - b.listing.price.amount);
  }

  const marketSearch = await searchItems(marketQuery);
  const marketListings = [];
  if (marketSearch.result?.length > 0) {
    const marketFetch = await fetchListings(marketSearch.result.slice(0, 10), marketSearch.id);
    const others = marketFetch.result
      .filter(l =>
        l?.listing?.price &&
        l.listing.account.name?.toLowerCase() !== accountLower &&
        isListingRecent(l.listing)
      )
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

module.exports = { searchItems, fetchListings, getCheapestListing, analyzePrices };