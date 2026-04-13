const express = require('express');
const router = express.Router();
const { loadTranslations, clearTranslationCache } = require('../gemTranslations');

// GET /api/translations
// Devuelve el mapa completo { 'Charged Staff': 'Bastón Cargado', ... }
router.get('/', async (req, res) => {
  try {
    const map = await loadTranslations();
    res.json(map);
  } catch (err) {
    console.error('[translations route] Error:', err.message);
    res.status(500).json({ error: 'No se pudieron cargar las traducciones' });
  }
});

// POST /api/translations/refresh — fuerza recarga de la caché
router.post('/refresh', async (req, res) => {
  clearTranslationCache();
  const map = await loadTranslations();
  res.json({ ok: true, count: Object.keys(map).length });
});

module.exports = router;