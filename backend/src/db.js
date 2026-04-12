const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/poe2market.db');


// Crear carpeta si no existe
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

// Activar WAL para mejor rendimiento
db.pragma('journal_mode = WAL');

// Crear tablas si no existen
db.exec(`
    CREATE TABLE IF NOT EXISTS monitor_items (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      category  TEXT NOT NULL DEFAULT 'item',
      query     TEXT NOT NULL,
      my_price  REAL NOT NULL,
      currency  TEXT NOT NULL DEFAULT 'chaos',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

console.log(`Base de datos lista en: ${dbPath}`);

module.exports = db;