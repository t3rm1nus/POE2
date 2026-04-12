// Carga las traducciones de gemas desde la API de POE2 y las cachea en memoria
const axios = require('axios');

let translationMap = null; // { 'Charged Staff': 'Bastón Cargado', ... }

async function loadTranslations() {
  if (translationMap) return translationMap;

  try {
    // La API de trade de POE2 expone los datos de ítems traducidos por locale
    const res = await axios.get(
      'https://www.pathofexile.com/api/trade2/data/items',
      {
        headers: {
          'User-Agent': 'POE2MarketWatcher/1.0 (personal tool)',
          'Accept-Language': 'es',  // Pedir español
        }
      }
    );

    translationMap = {};
    // La respuesta tiene categorías: { result: [{ label, entries: [{type, text}] }] }
    for (const category of res.data.result) {
      for (const entry of category.entries) {
        if (entry.type) translationMap[entry.type] = entry.text || entry.type;
      }
    }

    console.log(`[Translations] ${Object.keys(translationMap).length} traducciones cargadas`);
    return translationMap;
  } catch (err) {
    console.warn('[Translations] No se pudieron cargar traducciones:', err.message);
    translationMap = {}; // fallback vacío, usará nombres en inglés
    return translationMap;
  }
}

async function translateItemName(englishName) {
  const map = await loadTranslations();
  return map[englishName] || englishName; // fallback al inglés si no hay traducción
}

// Invalidar caché (útil si quieres refrescar sin reiniciar el servidor)
function clearTranslationCache() {
  translationMap = null;
}

module.exports = { loadTranslations, translateItemName, clearTranslationCache };