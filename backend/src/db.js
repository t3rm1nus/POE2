const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/poe2market.db');

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ─── Tablas base (instalaciones limpias) ──────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS monitor_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'item',
    query      TEXT NOT NULL,
    my_price   REAL NOT NULL,
    currency   TEXT NOT NULL DEFAULT 'chaos',
    quantity   INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gem_market_prices (
    gem_type       TEXT NOT NULL,
    realm          TEXT NOT NULL DEFAULT 'pc',
    league         TEXT NOT NULL DEFAULT 'Standard',
    category       TEXT,
    cheapest_price REAL,
    currency       TEXT DEFAULT 'divine',
    seller         TEXT,
    seller_online  TEXT DEFAULT 'unknown',
    indexed        TEXT,
    total_listings INTEGER DEFAULT 0,
    fetched_at     TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (gem_type, realm, league)
  );

  CREATE TABLE IF NOT EXISTS chinofarmers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT NOT NULL UNIQUE,
    active       INTEGER DEFAULT 1,
    is_online    TEXT DEFAULT 'unknown',
    last_checked TEXT,
    last_seen    TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chinofarmer_stocks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    cf_id      INTEGER NOT NULL,
    username   TEXT NOT NULL,
    gem_type   TEXT NOT NULL,
    gem_name   TEXT NOT NULL,
    price      REAL NOT NULL,
    currency   TEXT NOT NULL DEFAULT 'divine',
    realm      TEXT NOT NULL DEFAULT 'pc',
    league     TEXT NOT NULL DEFAULT 'Standard',
    scanned_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (cf_id) REFERENCES chinofarmers(id) ON DELETE CASCADE
  );
`);

// ─── Migración: quantity en monitor_items ─────────────────────────────────────
try {
  db.exec(`ALTER TABLE monitor_items ADD COLUMN quantity INTEGER DEFAULT 1`);
  console.log('[db] Migración: añadida columna quantity a monitor_items');
} catch {}

// ─── Migración: gem_market_prices → PK compuesta (gem_type, realm, league) ───
const tableRow = db.prepare(
  `SELECT sql FROM sqlite_master WHERE type='table' AND name='gem_market_prices'`
).get();

const pkIsComposite = tableRow?.sql?.includes('PRIMARY KEY (gem_type, realm, league)');

if (!pkIsComposite) {
  console.log('[db] Migrando gem_market_prices → PK compuesta (gem_type, realm, league)...');

  db.transaction(() => {
    db.exec(`ALTER TABLE gem_market_prices RENAME TO _gem_market_prices_old`);

    db.exec(`
      CREATE TABLE gem_market_prices (
        gem_type       TEXT NOT NULL,
        realm          TEXT NOT NULL DEFAULT 'pc',
        league         TEXT NOT NULL DEFAULT 'Standard',
        category       TEXT,
        cheapest_price REAL,
        currency       TEXT DEFAULT 'divine',
        seller         TEXT,
        seller_online  TEXT DEFAULT 'unknown',
        indexed        TEXT,
        total_listings INTEGER DEFAULT 0,
        fetched_at     TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (gem_type, realm, league)
      )
    `);

    db.exec(`
      INSERT INTO gem_market_prices
        (gem_type, realm, league, category, cheapest_price, currency,
         seller, seller_online, indexed, total_listings, fetched_at)
      SELECT
        gem_type,
        COALESCE(realm,  'pc'),
        COALESCE(league, 'Standard'),
        category,
        cheapest_price,
        currency,
        seller,
        CASE
          WHEN CAST(seller_online AS TEXT) = '1' OR seller_online = 'online'  THEN 'online'
          WHEN CAST(seller_online AS TEXT) = '0' OR seller_online = 'offline' THEN 'offline'
          ELSE 'unknown'
        END,
        indexed,
        COALESCE(total_listings, 0),
        fetched_at
      FROM _gem_market_prices_old
    `);

    db.exec(`DROP TABLE _gem_market_prices_old`);
  })();

  console.log('[db] Migración gem_market_prices completada.');
}

// ─── Migración: chinofarmers (para BBDDs existentes sin la tabla) ─────────────
try {
  const cfTable = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='chinofarmers'`
  ).get();

  if (!cfTable) {
    db.exec(`
      CREATE TABLE chinofarmers (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        username     TEXT NOT NULL UNIQUE,
        active       INTEGER DEFAULT 1,
        is_online    TEXT DEFAULT 'unknown',
        last_checked TEXT,
        last_seen    TEXT,
        created_at   TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log('[db] Tabla chinofarmers creada.');
  }
} catch (err) {
  console.error('[db] Error verificando tabla chinofarmers:', err.message);
}

// ─── Migración: chinofarmer_stocks (para BBDDs existentes sin la tabla) ───────
try {
  const stocksTable = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='chinofarmer_stocks'`
  ).get();

  if (!stocksTable) {
    db.exec(`
      CREATE TABLE chinofarmer_stocks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        cf_id      INTEGER NOT NULL,
        username   TEXT NOT NULL,
        gem_type   TEXT NOT NULL,
        gem_name   TEXT NOT NULL,
        price      REAL NOT NULL,
        currency   TEXT NOT NULL DEFAULT 'divine',
        realm      TEXT NOT NULL DEFAULT 'pc',
        league     TEXT NOT NULL DEFAULT 'Standard',
        scanned_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (cf_id) REFERENCES chinofarmers(id) ON DELETE CASCADE
      )
    `);
    console.log('[db] Tabla chinofarmer_stocks creada.');
  }
} catch (err) {
  console.error('[db] Error verificando tabla chinofarmer_stocks:', err.message);
}

console.log(`Base de datos lista en: ${dbPath}`);
module.exports = db;