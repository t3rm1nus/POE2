// Carga traducciones de ítems desde la API de POE2 y las cachea en memoria (TTL: 1h)
// La API devuelve los nombres en el idioma configurado en la cuenta (POESESSID)
// → Para recibir nombres en español, la cuenta debe tener el idioma establecido en ES
const axios = require('axios');

let translationMap = null;   // { 'Charged Staff': 'Bastón Cargado', ... }
let cacheTimestamp = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

function isCacheValid() {
  return translationMap !== null && cacheTimestamp !== null && (Date.now() - cacheTimestamp) < CACHE_TTL_MS;
}

async function loadTranslations() {
  if (isCacheValid()) return translationMap;

  try {
    const res = await axios.get(
      'https://es.pathofexile.com/api/trade2/data/items',
      {
        headers: {
          'User-Agent': 'POE2MarketWatcher/1.0 (personal tool)',
          // POESESSID necesario para que la API respete el idioma de la cuenta
          'Cookie': `POESESSID=${process.env.POESESSID}`,
        }
      }
    );

    translationMap = {};

    // Respuesta: { result: [{ label: 'Gemas', entries: [{ type: 'Charged Staff', text: 'Bastón Cargado' }] }] }
    for (const category of res.data.result) {
      for (const entry of category.entries) {
        if (entry.type) {
          // entry.text es el nombre traducido; si no existe, fallback al type (inglés)
          translationMap[entry.type] = entry.text || entry.type;
        }
      }
    }

    cacheTimestamp = Date.now();
    console.log(`[Translations] ${Object.keys(translationMap).length} traducciones cargadas`);
    return translationMap;

  } catch (err) {
    console.warn('[Translations] No se pudieron cargar traducciones:', err.message);
    // Si falla, devolver mapa vacío sin cachear — se reintentará en la próxima llamada
    return {};
  }
}

// Traduce un nombre individual (inglés → español)
// Si no hay traducción, devuelve el original
async function translateItemName(englishName) {
  const map = await loadTranslations();
  return map[englishName] || englishName;
}

// Invalida la caché (útil para forzar recarga sin reiniciar el servidor)
function clearTranslationCache() {
  translationMap = null;
  cacheTimestamp = null;
}

module.exports = { loadTranslations, translateItemName, clearTranslationCache };