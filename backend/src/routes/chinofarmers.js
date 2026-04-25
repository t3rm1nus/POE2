const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { searchItems, fetchListings } = require('../poeApiClient');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── SSE: clientes del poller de estado online ────────────────────────────────
const clients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch (_) {}
  }
}

// ─── Estado en memoria ────────────────────────────────────────────────────────
const userState = new Map();

{
  const rows = db.prepare('SELECT username, is_online FROM chinofarmers').all();
  for (const row of rows) {
    userState.set(row.username, { is_online: row.is_online ?? 'unknown', initialized: false });
  }
}

// ─── Config del poller ────────────────────────────────────────────────────────
let pollerTimer   = null;
let pollerMs      = 5 * 60 * 1000;
let currentRealm  = 'pc';
let currentLeague = 'Standard';

async function checkUserOnline(username) {
  try {
    const query = {
      query: {
        status: { option: 'online' },
        filters: {
          trade_filters: {
            filters: { account: { input: username } },
            disabled: false,
          },
        },
        stats: [{ type: 'and', filters: [], disabled: true }],
      },
      sort: { price: 'asc' },
    };
    const search = await searchItems(query, { league: currentLeague, realm: currentRealm });
    return (search.total ?? 0) > 0 ? 'online' : 'offline';
  } catch (err) {
    console.error(`[chinofarmers] Error comprobando ${username}:`, err.message);
    return 'unknown';
  }
}

async function pollAll() {
  const users = db.prepare('SELECT * FROM chinofarmers WHERE active = 1').all();
  if (users.length === 0) return;

  broadcast({ type: 'poll_start', timestamp: new Date().toISOString() });
  console.log(`[chinofarmers] Iniciando poll de ${users.length} usuarios activos...`);

  for (const user of users) {
    const prev      = userState.get(user.username) ?? { is_online: 'unknown', initialized: false };
    const isOnline  = await checkUserOnline(user.username);
    const now       = new Date().toISOString();
    const lastSeen  = isOnline === 'online' ? now : (user.last_seen ?? null);

    db.prepare(`
      UPDATE chinofarmers
      SET is_online = ?, last_checked = ?, last_seen = ?
      WHERE username = ?
    `).run(isOnline, now, lastSeen, user.username);

    userState.set(user.username, { is_online: isOnline, initialized: true });

    broadcast({
      type:         'status_update',
      id:           user.id,
      username:     user.username,
      is_online:    isOnline,
      last_checked: now,
      last_seen:    lastSeen,
    });

    if (prev.initialized && prev.is_online === 'online' && isOnline === 'offline') {
      console.log(`[chinofarmers] ${user.username} se acaba de desconectar.`);
      broadcast({ type: 'went_offline', id: user.id, username: user.username });
    }
  }

  broadcast({ type: 'poll_done', timestamp: new Date().toISOString() });
  console.log('[chinofarmers] Poll completado.');
}

function startPoller() {
  if (pollerTimer) clearInterval(pollerTimer);
  pollerTimer = setInterval(pollAll, pollerMs);
  console.log(`[chinofarmers] Poller activo: cada ${pollerMs / 1000}s`);
}

function stopPoller() {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
    console.log('[chinofarmers] Poller detenido.');
  }
}

startPoller();

// ═══════════════════════════════════════════════════════════════════════════════
// ─── STOCK SCAN ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// username → { realm, league, startedAt }
const scanningUsers = new Map();

// username → Set<res>
const stockEventClients = new Map();

function broadcastStockEvent(username, data) {
  const cls = stockEventClients.get(username);
  if (!cls || cls.size === 0) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of cls) {
    try { res.write(msg); } catch (_) {}
  }
}

async function runStockScan(username, realm, league) {
  if (scanningUsers.has(username)) return;

  const cf = db.prepare('SELECT id FROM chinofarmers WHERE username = ?').get(username);
  if (!cf) return;

  scanningUsers.set(username, { realm, league, startedAt: new Date().toISOString() });
  broadcastStockEvent(username, { type: 'scan_start', realm, league });
  console.log(`[stocks] Iniciando escaneo de stock para ${username} (${realm}/${league})...`);

  try {
    const query = {
      query: {
        status: { option: 'any' },
        filters: {
          trade_filters: {
            filters: { account: { input: username } },
            disabled: false,
          },
          misc_filters: {
            filters: {
              gem_level:   { min: 21 },
              gem_sockets: { min: 5  },
            },
            disabled: false,
          },
        },
        stats: [{ type: 'and', filters: [], disabled: true }],
      },
      sort: { price: 'asc' },
    };

    const search = await searchItems(query, { league, realm });
    const allIds = search.result || [];
    const total  = search.total  ?? 0;

    broadcastStockEvent(username, { type: 'found', count: allIds.length, total });
    console.log(`[stocks] ${username}: ${allIds.length} listings encontrados.`);

    // Limpiar stocks anteriores de esta combinación realm+league
    db.prepare(
      'DELETE FROM chinofarmer_stocks WHERE cf_id = ? AND realm = ? AND league = ?'
    ).run(cf.id, realm, league);

    if (allIds.length === 0) {
      broadcastStockEvent(username, { type: 'scan_done', stocks: [] });
      return;
    }

    // Obtener en chunks de 10
    const chunks = [];
    for (let i = 0; i < allIds.length; i += 10) {
      chunks.push(allIds.slice(i, i + 10));
    }

    const insertStmt = db.prepare(`
      INSERT INTO chinofarmer_stocks (cf_id, username, gem_type, gem_name, price, currency, realm, league)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < chunks.length; i++) {
      broadcastStockEvent(username, {
        type:     'fetching',
        progress: i + 1,
        total:    chunks.length,
        message:  `Chunk ${i + 1}/${chunks.length}...`,
      });

      const fetched = await fetchListings(chunks[i], search.id, { realm });

      for (const listing of fetched.result || []) {
        if (!listing?.listing?.price || !listing?.item) continue;

        const price    = listing.listing.price.amount;
        const currency = listing.listing.price.currency;
        const gemType  = listing.item.typeLine || listing.item.baseType || '';
        const gemName  = listing.item.name      || gemType;

        insertStmt.run(cf.id, username, gemType, gemName, price, currency, realm, league);
      }

      if (i < chunks.length - 1) await sleep(3000);
    }

    const stocks = db.prepare(
      'SELECT * FROM chinofarmer_stocks WHERE cf_id = ? AND realm = ? AND league = ? ORDER BY price ASC'
    ).all(cf.id, realm, league);

    broadcastStockEvent(username, { type: 'scan_done', stocks });
    console.log(`[stocks] Escaneo completado para ${username}: ${stocks.length} registros guardados.`);

  } catch (err) {
    console.error(`[stocks] Error escaneando ${username}:`, err.message);
    broadcastStockEvent(username, { type: 'scan_error', error: err.message });
  } finally {
    scanningUsers.delete(username);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── RUTAS BASE (chinofarmers) ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/chinofarmers
router.get('/', (req, res) => {
  const users = db.prepare('SELECT * FROM chinofarmers ORDER BY created_at ASC').all();
  res.json(users);
});

// POST /api/chinofarmers
router.post('/', (req, res) => {
  const username = req.body.username?.trim();
  if (!username) return res.status(400).json({ error: 'username requerido' });

  try {
    const result = db.prepare(
      'INSERT INTO chinofarmers (username) VALUES (?)'
    ).run(username);

    const user = db.prepare('SELECT * FROM chinofarmers WHERE id = ?').get(result.lastInsertRowid);
    userState.set(user.username, { is_online: 'unknown', initialized: false });
    broadcast({ type: 'user_added', user });
    res.status(201).json(user);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'El usuario ya existe en la lista' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chinofarmers/:id  (solo IDs numéricos para no colisionar con /:username/stocks)
// DESPUÉS
router.delete('/:id', (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
    const user = db.prepare('SELECT * FROM chinofarmers WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'No encontrado' });

  db.prepare('DELETE FROM chinofarmers WHERE id = ?').run(req.params.id);
  userState.delete(user.username);
  broadcast({ type: 'user_deleted', id: parseInt(req.params.id) });
  res.json({ deleted: true });
});

// PATCH /api/chinofarmers/:id/active
router.patch('/:id/active', (req, res) => {
  const user = db.prepare('SELECT * FROM chinofarmers WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'No encontrado' });

  const active = req.body.active ? 1 : 0;
  db.prepare('UPDATE chinofarmers SET active = ? WHERE id = ?').run(active, req.params.id);

  if (active) {
    userState.set(user.username, { is_online: user.is_online ?? 'unknown', initialized: false });
  } else {
    userState.delete(user.username);
  }

  const updated = db.prepare('SELECT * FROM chinofarmers WHERE id = ?').get(req.params.id);
  broadcast({ type: 'user_updated', user: updated });
  res.json(updated);
});

// POST /api/chinofarmers/interval
router.post('/interval', (req, res) => {
  const { minutes, realm, league } = req.body;

  if (realm)  currentRealm  = realm;
  if (league) currentLeague = league;

  if (minutes !== undefined) {
    const mins = parseInt(minutes);
    if (mins <= 0) {
      stopPoller();
    } else {
      pollerMs = mins * 60 * 1000;
      startPoller();
    }
  }

  res.json({ ok: true, pollerMs, realm: currentRealm, league: currentLeague });
});

// GET /api/chinofarmers/events (SSE estado online)
router.get('/events', (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (req.query.realm)  currentRealm  = req.query.realm;
  if (req.query.league) currentLeague = req.query.league;

  const users = db.prepare('SELECT * FROM chinofarmers ORDER BY created_at ASC').all();
  res.write(`data: ${JSON.stringify({ type: 'init', users })}\n\n`);

  clients.add(res);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── RUTAS DE STOCKS ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/chinofarmers/:username/stocks
router.get('/:username/stocks', (req, res) => {
  const { username } = req.params;
  const realm  = req.query.realm  || 'pc';
  const league = req.query.league || 'Standard';

  const cf = db.prepare('SELECT id FROM chinofarmers WHERE username = ?').get(username);
  if (!cf) return res.status(404).json({ error: 'Usuario no encontrado' });

  const stocks = db.prepare(
    'SELECT * FROM chinofarmer_stocks WHERE cf_id = ? AND realm = ? AND league = ? ORDER BY price ASC'
  ).all(cf.id, realm, league);

  res.json({
    stocks,
    isScanning: scanningUsers.has(username),
    scanInfo:   scanningUsers.get(username) || null,
  });
});

// POST /api/chinofarmers/:username/stocks/scan
router.post('/:username/stocks/scan', (req, res) => {
  const { username } = req.params;
  const realm  = req.body.realm  || req.query.realm  || 'pc';
  const league = req.body.league || req.query.league || 'Standard';

  if (scanningUsers.has(username)) {
    return res.json({ ok: true, message: 'Escaneo ya en progreso' });
  }

  runStockScan(username, realm, league).catch(err => {
    console.error(`[stocks] runStockScan unhandled error for ${username}:`, err.message);
  });

  res.json({ ok: true, message: 'Escaneo iniciado' });
});

// DELETE /api/chinofarmers/:username/stocks
router.delete('/:username/stocks', (req, res) => {
  const { username } = req.params;
  const realm  = req.query.realm  || 'pc';
  const league = req.query.league || 'Standard';

  const cf = db.prepare('SELECT id FROM chinofarmers WHERE username = ?').get(username);
  if (!cf) return res.status(404).json({ error: 'Usuario no encontrado' });

  db.prepare(
    'DELETE FROM chinofarmer_stocks WHERE cf_id = ? AND realm = ? AND league = ?'
  ).run(cf.id, realm, league);

  broadcastStockEvent(username, { type: 'stocks_cleared' });
  res.json({ deleted: true });
});

// GET /api/chinofarmers/:username/stocks/events (SSE progreso de escaneo)
router.get('/:username/stocks/events', (req, res) => {
  const { username } = req.params;

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Estado inicial
  res.write(`data: ${JSON.stringify({
    type:       'connected',
    isScanning: scanningUsers.has(username),
    scanInfo:   scanningUsers.get(username) || null,
  })}\n\n`);

  if (!stockEventClients.has(username)) {
    stockEventClients.set(username, new Set());
  }
  stockEventClients.get(username).add(res);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const cls = stockEventClients.get(username);
    if (cls) {
      cls.delete(res);
      if (cls.size === 0) stockEventClients.delete(username);
    }
  });
});

module.exports = router;