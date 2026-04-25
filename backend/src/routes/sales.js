const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ─── Tabla sales (creada aquí si no existe) ───────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sales (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    gem_name   TEXT NOT NULL,
    gem_type   TEXT NOT NULL,
    price      REAL NOT NULL,
    currency   TEXT NOT NULL DEFAULT 'divine',
    quantity   INTEGER NOT NULL DEFAULT 1,
    partial    INTEGER NOT NULL DEFAULT 0,
    realm      TEXT NOT NULL DEFAULT 'pc',
    league     TEXT NOT NULL DEFAULT 'Standard',
    sold_at    TEXT DEFAULT (datetime('now'))
  )
`);

// GET /api/sales
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM sales ORDER BY sold_at DESC'
  ).all();
  res.json(rows);
});

// POST /api/sales
router.post('/', (req, res) => {
  const { gem_name, gem_type, price, currency, quantity, partial, realm, league } = req.body;

  if (!gem_name || price === undefined) {
    return res.status(400).json({ error: 'gem_name y price son obligatorios' });
  }

  const result = db.prepare(`
    INSERT INTO sales (gem_name, gem_type, price, currency, quantity, partial, realm, league)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    gem_name,
    gem_type   || gem_name,
    price,
    currency   || 'divine',
    quantity   || 1,
    partial    ? 1 : 0,
    realm      || 'pc',
    league     || 'Standard'
  );

  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(sale);
});

// DELETE /api/sales/:id
router.delete('/:id', (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const sale = db.prepare('SELECT id FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

  db.prepare('DELETE FROM sales WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;