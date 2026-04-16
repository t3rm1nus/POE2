const express = require('express');
const router = express.Router();
const db = require('./db');
const { searchItems, fetchListings } = require('./poeApiClient');

// ✅ FIX PROBLEMA 2: eliminado MAX_LISTING_AGE_MONTHS y la función isListingRecent()
// basada en fecha. El filtro de compra inmediata (sale_type: 'priced') se aplica
// directamente en la query a la API, que es la forma correcta y oficial.
const CACHE_MAX_AGE_HOURS = 24;

// ─── Lista maestra de gemas con categoría ────────────────────────────────────
const GEMS = [
    // Arco
    { type: 'Tornado Shot',            cat: 'Arco' },
    { type: 'Ice Shot',                cat: 'Arco' },
    { type: 'Lightning Arrow',         cat: 'Arco' },
    { type: 'Barrage',                 cat: 'Arco' },
    { type: 'Rain of Arrows',          cat: 'Arco' },
    { type: 'Vine Arrow',              cat: 'Arco' },
    { type: 'Spiral Volley',           cat: 'Arco' },
    { type: 'Electrocuting Arrow',     cat: 'Arco' },
    { type: 'Freezing Salvo',          cat: 'Arco' },
    { type: 'Snipe',                   cat: 'Arco' },
    { type: 'Ice-Tipped Arrows',       cat: 'Arco' },
    { type: 'Gas Arrow',               cat: 'Arco' },
    { type: 'Detonating Arrow',        cat: 'Arco' },
    { type: 'Toxic Growth',            cat: 'Arco' },
    { type: 'Magnetic Salvo',          cat: 'Arco' },
    { type: 'Toxic Domain',            cat: 'Arco' },
    { type: 'Disengage',               cat: 'Arco' },
    { type: 'Lightning Rod',           cat: 'Arco' },
    { type: 'Stormcaller Arrow',       cat: 'Arco' },
    { type: 'Poisonburst Arrow',       cat: 'Arco' },
    { type: 'Freezing Mark',           cat: 'Arco' },
    { type: "Sniper's Mark",           cat: 'Arco' },
    { type: 'Voltaic Mark',            cat: 'Arco' },
    // Bastón
    { type: 'Charged Staff',           cat: 'Bastón' },
    { type: 'Killing Palm',            cat: 'Bastón' },
    { type: 'Glacial Cascade',         cat: 'Bastón' },
    { type: 'Tempest Bell',            cat: 'Bastón' },
    { type: 'Whirling Assault',        cat: 'Bastón' },
    { type: 'Permafrost Bolts',        cat: 'Bastón' },
    { type: 'Staggering Palm',         cat: 'Bastón' },
    { type: 'Ice Strike',              cat: 'Bastón' },
    { type: 'Tempest Flurry',          cat: 'Bastón' },
    { type: 'Rapid Assault',           cat: 'Bastón' },
    { type: 'Frost Wall',              cat: 'Bastón' },
    { type: 'Siphoning Strike',        cat: 'Bastón' },
    { type: 'Storm Wave',              cat: 'Bastón' },
    { type: 'Hand of Chayula',         cat: 'Bastón' },
    { type: 'Shattering Palm',         cat: 'Bastón' },
    { type: 'Thunderstorm',            cat: 'Bastón' },
    { type: 'Snap',                    cat: 'Bastón' },
    { type: 'Impending Doom',          cat: 'Bastón' },
    // Ocultismo
    { type: 'Skeletal Sniper',         cat: 'Ocultismo' },
    { type: 'Unearth',                 cat: 'Ocultismo' },
    { type: 'Contagion',               cat: 'Ocultismo' },
    { type: 'Skeletal Arsonist',       cat: 'Ocultismo' },
    { type: 'Bone Cage',               cat: 'Ocultismo' },
    { type: 'Essence Drain',           cat: 'Ocultismo' },
    { type: 'Raise Zombie',            cat: 'Ocultismo' },
    { type: 'Skeletal Frost Mage',     cat: 'Ocultismo' },
    { type: 'Pain Offering',           cat: 'Ocultismo' },
    { type: 'Bonestorm',               cat: 'Ocultismo' },
    { type: 'Detonate Dead',           cat: 'Ocultismo' },
    { type: 'Vulnerability',           cat: 'Ocultismo' },
    { type: 'Bind Spectre',            cat: 'Ocultismo' },
    { type: 'Profane Ritual',          cat: 'Ocultismo' },
    { type: 'Skeletal Reaver',         cat: 'Ocultismo' },
    { type: 'Despair',                 cat: 'Ocultismo' },
    { type: 'Dark Effigy',             cat: 'Ocultismo' },
    { type: 'Skeletal Storm Mage',     cat: 'Ocultismo' },
    { type: 'Bone Offering',           cat: 'Ocultismo' },
    { type: 'Hexblast',                cat: 'Ocultismo' },
    { type: 'Skeletal Brute',          cat: 'Ocultismo' },
    { type: 'Skeletal Cleric',         cat: 'Ocultismo' },
    { type: 'Soul Offering',           cat: 'Ocultismo' },
    // Primalismo
    { type: 'Volcano',                 cat: 'Primalismo' },
    { type: 'Savage Fury',             cat: 'Primalismo' },
    { type: 'Entangle',                cat: 'Primalismo' },
    { type: 'Lunar Assault',           cat: 'Primalismo' },
    { type: 'Shockwave Totem',         cat: 'Primalismo' },
    { type: 'Rolling Magma',           cat: 'Primalismo' },
    { type: 'Wing Blast',              cat: 'Primalismo' },
    { type: 'Falling Thunder',         cat: 'Primalismo' },
    { type: 'Ferocious Roar',          cat: 'Primalismo' },
    { type: 'Devour',                  cat: 'Primalismo' },
    { type: 'Arctic Howl',             cat: 'Primalismo' },
    { type: 'Spell Totem',             cat: 'Primalismo' },
    { type: 'Oil Barrage',             cat: 'Primalismo' },
    { type: 'Cross Slash',             cat: 'Primalismo' },
    { type: 'Tornado',                 cat: 'Primalismo' },
    { type: 'Rampage',                 cat: 'Primalismo' },
    { type: 'Flame Breath',            cat: 'Primalismo' },
    { type: 'Lunar Blessing',          cat: 'Primalismo' },
    { type: 'Walking Calamity',        cat: 'Primalismo' },
    // Maza
    { type: 'Earthquake',              cat: 'Maza' },
    { type: 'Boneshatter',             cat: 'Maza' },
    { type: 'Rolling Slam',            cat: 'Maza' },
    { type: 'Armour Breaker',          cat: 'Maza' },
    { type: 'Infernal Cry',            cat: 'Maza' },
    { type: 'Shield Charge',           cat: 'Maza' },
    { type: 'Perfect Strike',          cat: 'Maza' },
    { type: 'Molten Blast',            cat: 'Maza' },
    { type: 'Resonating Shield',       cat: 'Maza' },
    { type: 'Leap Slam',               cat: 'Maza' },
    { type: 'Volcanic Fissure',        cat: 'Maza' },
    { type: 'Iron Ward',               cat: 'Maza' },
    { type: 'Earthshatter',            cat: 'Maza' },
    { type: 'Fortifying Cry',          cat: 'Maza' },
    { type: 'Forge Hammer',            cat: 'Maza' },
    { type: 'Seismic Cry',             cat: 'Maza' },
    { type: 'Supercharged Slam',       cat: 'Maza' },
    { type: 'Stampede',                cat: 'Maza' },
    { type: 'Ancestral Warrior Totem', cat: 'Maza' },
    { type: 'Hammer of the Gods',      cat: 'Maza' },
    { type: 'Ancestral Cry',           cat: 'Maza' },
    // Ballesta
    { type: 'Fragmentation Rounds',    cat: 'Ballesta' },
    { type: 'Armour Piercing Rounds',  cat: 'Ballesta' },
    { type: 'Permafrost Bolts',        cat: 'Ballesta' },
    { type: 'Explosive Grenade',       cat: 'Ballesta' },
    { type: 'High Velocity Rounds',    cat: 'Ballesta' },
    { type: 'Incendiary Shot',         cat: 'Ballesta' },
    { type: 'Flash Grenade',           cat: 'Ballesta' },
    { type: 'Rapid Shot',              cat: 'Ballesta' },
    { type: 'Ice Shards',              cat: 'Ballesta' },
    { type: 'Galvanic Shards',         cat: 'Ballesta' },
    { type: 'Gas Grenade',             cat: 'Ballesta' },
    { type: 'Artillery Ballista',      cat: 'Ballesta' },
    { type: 'Explosive Shot',          cat: 'Ballesta' },
    { type: 'Glacial Bolt',            cat: 'Ballesta' },
    { type: 'Voltaic Grenade',         cat: 'Ballesta' },
    { type: 'Siege Ballista',          cat: 'Ballesta' },
    { type: 'Shockburst Rounds',       cat: 'Ballesta' },
    { type: 'Oil Grenade',             cat: 'Ballesta' },
    { type: 'Hailstorm Rounds',        cat: 'Ballesta' },
    { type: 'Emergency Reload',        cat: 'Ballesta' },
    { type: 'Mortar Cannon',           cat: 'Ballesta' },
    { type: 'Siege Cascade',           cat: 'Ballesta' },
    { type: 'Plasma Blast',            cat: 'Ballesta' },
    { type: 'Cluster Grenade',         cat: 'Ballesta' },
    // Lanza
    { type: 'Escape Shot',             cat: 'Lanza' },
    { type: 'Whirling Slash',          cat: 'Lanza' },
    { type: 'Whirlwind Lance',         cat: 'Lanza' },
    { type: 'Explosive Spear',         cat: 'Lanza' },
    { type: 'Lightning Spear',         cat: 'Lanza' },
    { type: 'Fangs of Frost',          cat: 'Lanza' },
    { type: 'Primal Strikes',          cat: 'Lanza' },
    { type: 'Spearfield',              cat: 'Lanza' },
    { type: 'Storm Lance',             cat: 'Lanza' },
    { type: 'Blood Hunt',              cat: 'Lanza' },
    { type: 'Glacial Lance',           cat: 'Lanza' },
    { type: 'Thunderous Leap',         cat: 'Lanza' },
    { type: "Bloodhound's Mark",       cat: 'Lanza' },
    { type: 'Tame Beast',              cat: 'Lanza' },
    { type: 'Vaulting Impact',         cat: 'Lanza' },
    { type: 'Elemental Sundering',     cat: 'Lanza' },
    { type: "Wind Serpent's Fury",     cat: 'Lanza' },
    { type: 'Spear of Solaris',        cat: 'Lanza' },
    // Heraldo
    { type: 'Herald of Blood',         cat: 'Heraldo' },
    { type: 'Herald of Ice',           cat: 'Heraldo' },
    { type: 'Herald of Thunder',       cat: 'Heraldo' },
    { type: 'Herald of Ash',           cat: 'Heraldo' },
    // Soporte
    { type: 'Trinity',                 cat: 'Soporte' },
    { type: 'Archmage',                cat: 'Soporte' },
    { type: 'Blasphemy',               cat: 'Soporte' },
    { type: 'Arctic Armour',           cat: 'Soporte' },
    { type: 'Mirage Archer',           cat: 'Soporte' },
    { type: 'Wind Dancer',             cat: 'Soporte' },
    { type: 'Defiance Banner',         cat: 'Soporte' },
    { type: 'War Banner',              cat: 'Soporte' },
    { type: 'Dread Banner',            cat: 'Soporte' },
    { type: 'Cast on Dodge',           cat: 'Soporte' },
    { type: 'Charge Regulation',       cat: 'Soporte' },
    { type: "Reaper's Invocation",     cat: 'Soporte' },
    { type: 'Barrier Invocation',      cat: 'Soporte' },
    { type: 'Lingering Illusion',      cat: 'Soporte' },
    { type: 'Elemental Invocation',    cat: 'Soporte' },
    { type: 'Raging Spirits',          cat: 'Soporte' },
    { type: 'Convalescence',           cat: 'Soporte' },
    { type: 'Mana Remnants',           cat: 'Soporte' },
    { type: 'Siphon Elements',         cat: 'Soporte' },
    { type: 'Blink',                   cat: 'Soporte' },
    { type: 'Elemental Conflux',       cat: 'Soporte' },
    { type: 'Grim Feast',              cat: 'Soporte' },
    { type: 'Withering Presence',      cat: 'Soporte' },
    { type: 'Ravenous Swarm',          cat: 'Soporte' },
    { type: 'Cast on Minion Death',    cat: 'Soporte' },
    { type: 'Cast on Critical',        cat: 'Soporte' },
    { type: 'Sacrifice',               cat: 'Soporte' },
    { type: 'Feral Invocation',        cat: 'Soporte' },
    { type: 'Wolf Pack',               cat: 'Soporte' },
    { type: 'Time of Need',            cat: 'Soporte' },
    { type: 'Overwhelming Presence',   cat: 'Soporte' },
    { type: 'Barkskin',                cat: 'Soporte' },
    { type: 'Eternal Rage',            cat: 'Soporte' },
    { type: 'Magma Barrier',           cat: 'Soporte' },
    { type: 'Scavenged Plating',       cat: 'Soporte' },
    { type: 'Shield Wall',             cat: 'Soporte' },
    { type: 'Ghost Dance',             cat: 'Soporte' },
    { type: 'Attrition',               cat: 'Soporte' },
    { type: 'Shard Scavenger',         cat: 'Soporte' },
    { type: 'Combat Frenzy',           cat: 'Soporte' },
    { type: 'Trail of Caltrops',       cat: 'Soporte' },
    { type: 'Rhoa Mount',              cat: 'Soporte' },
];

// ─── GET /api/tracker/gems — datos en caché ──────────────────────────────────
router.get('/gems', (req, res) => {
  const gems = db.prepare(
    'SELECT * FROM gem_market_prices ORDER BY cheapest_price DESC'
  ).all();

  const meta = db.prepare(
    "SELECT MIN(fetched_at) as oldest, MAX(fetched_at) as newest, COUNT(*) as total FROM gem_market_prices"
  ).get();

  const cutoffStr = (() => {
    const d = new Date();
    d.setHours(d.getHours() - CACHE_MAX_AGE_HOURS);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  })();

  const staleCount = db.prepare(
    "SELECT COUNT(*) as n FROM gem_market_prices WHERE fetched_at < ?"
  ).get(cutoffStr)?.n ?? 0;

  const pendingCount = GEMS.length - (meta?.total ?? 0);

  res.json({
    gems,
    meta,
    stale_count: staleCount,
    pending_count: pendingCount,
    total_gems: GEMS.length,
    my_account: process.env.POE_ACCOUNT || '',   // ← AÑADIR ESTA LÍNEA
  })});

// ─── GET /api/tracker/scan — SSE ─────────────────────────────────────────────
router.get('/scan', async (req, res) => {
  const realm  = req.query.realm  || 'sony';
  const league = req.query.league || 'Standard';
  const force  = req.query.force === 'true';

  console.log(`[tracker/scan] realm=${realm} league=${league} force=${force}`);

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  let gemsToScan;
  if (force) {
    gemsToScan = GEMS;
  } else {
    const cutoffStr = (() => {
      const d = new Date();
      d.setHours(d.getHours() - CACHE_MAX_AGE_HOURS);
      return d.toISOString().replace('T', ' ').slice(0, 19);
    })();

    const fresh = db.prepare(
      "SELECT gem_type FROM gem_market_prices WHERE fetched_at > ?"
    ).all(cutoffStr);
    const freshSet = new Set(fresh.map(r => r.gem_type));
    gemsToScan = GEMS.filter(g => !freshSet.has(g.type));
  }

  if (gemsToScan.length === 0) {
    send({ status: 'done', scanned: 0, message: 'Todo está actualizado, no hay nada que escanear.' });
    return res.end();
  }

  send({ status: 'start', total: gemsToScan.length, total_gems: GEMS.length });

  let cancelled = false;
  req.on('close', () => { cancelled = true; });

  let done = 0;

  for (const gem of gemsToScan) {
    if (cancelled) break;

    try {
      send({ status: 'scanning', gem_type: gem.type, category: gem.cat, progress: done, total: gemsToScan.length });

      // ✅ FIX PROBLEMA 2: sale_type 'priced' en lugar del filtro de fecha isListingRecent()
      const query = {
        query: {
          type: gem.type,
          stats:  [{ type: 'and', filters: [], disabled: true }],
          status: { option: 'securable' },
          filters: {
            misc_filters: {
              filters: { gem_level: { min: 21 }, gem_sockets: { min: 5 } },
              disabled: false
            },
            trade_filters: {
              filters: {
                price:     { option: 'divine' },
                sale_type: { option: 'priced' },   // ← solo compra inmediata
              },
              disabled: false
            }
          }
        },
        sort: { price: 'asc' }
      };

      const search = await searchItems(query, { league, realm });
      let cheapest       = null;
      let total_listings = 0;

      if (search.result?.length > 0) {
        total_listings = search.total || search.result.length;

        // Buscar el primer listing válido en las primeras 3 tandas
        for (let i = 0; i < Math.min(3, Math.ceil(search.result.length / 10)); i++) {
          const batch = search.result.slice(i * 10, (i + 1) * 10);
          if (batch.length === 0) break;

          const fetched  = await fetchListings(batch, search.id);
          const filtered = (fetched.result || [])
            .filter(l => l?.listing?.price)
            .sort((a, b) => a.listing.price.amount - b.listing.price.amount);

          if (filtered.length > 0) {
            cheapest = filtered[0];
            break;
          }
        }
      }

      const price         = cheapest?.listing?.price?.amount   ?? null;
      const currency      = cheapest?.listing?.price?.currency ?? 'divine';
      const seller        = cheapest?.listing?.account?.name   ?? null;
      const seller_online = cheapest?.listing?.account?.online ? 1 : 0;
      const indexed       = cheapest?.listing?.indexed         ?? null;

      db.prepare(`
        INSERT INTO gem_market_prices
          (gem_type, category, cheapest_price, currency, seller, seller_online, indexed, total_listings, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(gem_type) DO UPDATE SET
          category       = excluded.category,
          cheapest_price = excluded.cheapest_price,
          currency       = excluded.currency,
          seller         = excluded.seller,
          seller_online  = excluded.seller_online,
          indexed        = excluded.indexed,
          total_listings = excluded.total_listings,
          fetched_at     = excluded.fetched_at
      `).run(gem.type, gem.cat, price, currency, seller, seller_online, indexed, total_listings);

      done++;
      send({
        status: 'gem_done',
        gem_type: gem.type,
        category: gem.cat,
        price,
        currency,
        seller,
        seller_online,
        total_listings,
        progress: done,
        total: gemsToScan.length
      });

    } catch (err) {
      console.error(`Error escaneando ${gem.type}:`, err.message);
      if (err.response?.data) console.error('  Detalle:', JSON.stringify(err.response.data));

      done++;
      send({
        status: 'gem_error',
        gem_type: gem.type,
        error: err.message,
        progress: done,
        total: gemsToScan.length
      });
    }
  }

  send({ status: 'done', scanned: done });
  res.end();
});

router.delete('/gems', (req, res) => {
  db.prepare('DELETE FROM gem_market_prices').run();
  res.json({ deleted: true });
});

module.exports = router;
module.exports.GEMS = GEMS;