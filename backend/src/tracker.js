const express = require('express');
const router = express.Router();
const db = require('./db');
const { searchItems, fetchListings } = require('./poeApiClient');

const MAX_LISTING_AGE_MONTHS = 4;
const CACHE_MAX_AGE_HOURS    = 24;

function isListingRecent(listing) {
  if (!listing?.indexed) return true;
  const indexed = new Date(listing.indexed);
  const cutoff  = new Date();
  cutoff.setMonth(cutoff.getMonth() - MAX_LISTING_AGE_MONTHS);
  return indexed >= cutoff;
}

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
  { type: 'Explosive Arrow',         cat: 'Arco' },
  { type: 'Toxic Growth',            cat: 'Arco' },
  { type: 'Magnetic Salvo',          cat: 'Arco' },
  { type: 'Toxic Dominion',          cat: 'Arco' },
  { type: 'Disengage',               cat: 'Arco' },
  { type: 'Lightning Rod',           cat: 'Arco' },
  { type: 'Storm Caller Arrow',      cat: 'Arco' },
  { type: 'Paralyzing Arrow',        cat: 'Arco' },
  { type: 'Freezing Mark',           cat: 'Arco' },
  { type: "Sniper's Mark",           cat: 'Arco' },
  { type: 'Voltaic Mark',            cat: 'Arco' },
  { type: 'Caustic Arrow',           cat: 'Arco' },
  // Bastón
  { type: 'Charged Staff',           cat: 'Bastón' },
  { type: 'Killing Palm',            cat: 'Bastón' },
  { type: 'Glacial Cascade',         cat: 'Bastón' },
  { type: 'Tempest Bell',            cat: 'Bastón' },
  { type: 'Whirling Assault',        cat: 'Bastón' },
  { type: 'Permafrost Bolt',         cat: 'Bastón' },
  { type: 'Wind Strike',             cat: 'Bastón' },
  { type: 'Destabilising Palm',      cat: 'Bastón' },
  { type: 'Ice Strike',              cat: 'Bastón' },
  { type: 'Tempest Flurry',          cat: 'Bastón' },
  { type: 'Rushing Assault',         cat: 'Bastón' },
  { type: 'Frost Wall',              cat: 'Bastón' },
  { type: 'Drain Strike',            cat: 'Bastón' },
  { type: 'Storm Wave',              cat: 'Bastón' },
  { type: 'Hand of Chayula',         cat: 'Bastón' },
  { type: 'Ruin',                    cat: 'Bastón' },
  { type: 'Shattering Palm',         cat: 'Bastón' },
  { type: 'Thunder Clap',            cat: 'Bastón' },
  { type: 'Snap',                    cat: 'Bastón' },
  { type: 'Impending Doom',          cat: 'Bastón' },
  // Ocultismo
  { type: 'Skeletal Archer',         cat: 'Ocultismo' },
  { type: 'Unearth',                 cat: 'Ocultismo' },
  { type: 'Contagion',               cat: 'Ocultismo' },
  { type: 'Enervate',                cat: 'Ocultismo' },
  { type: 'Skeletal Pyromancer',     cat: 'Ocultismo' },
  { type: 'Bone Cage',               cat: 'Ocultismo' },
  { type: 'Essence Drain',           cat: 'Ocultismo' },
  { type: 'Raise Zombie',            cat: 'Ocultismo' },
  { type: 'Skeletal Frost Mage',     cat: 'Ocultismo' },
  { type: 'Pain Offering',           cat: 'Ocultismo' },
  { type: 'Bone Storm',              cat: 'Ocultismo' },
  { type: 'Detonate Dead',           cat: 'Ocultismo' },
  { type: 'Vulnerability',           cat: 'Ocultismo' },
  { type: 'Raise Spectre',           cat: 'Ocultismo' },
  { type: 'Profane Ritual',          cat: 'Ocultismo' },
  { type: 'Skeletal Slasher',        cat: 'Ocultismo' },
  { type: 'Despair',                 cat: 'Ocultismo' },
  { type: 'Dark Effigy',             cat: 'Ocultismo' },
  { type: 'Skeletal Storm Mage',     cat: 'Ocultismo' },
  { type: 'Bone Offering',           cat: 'Ocultismo' },
  { type: 'Malefic Blast',           cat: 'Ocultismo' },
  { type: 'Skeleton Brute',          cat: 'Ocultismo' },
  { type: 'Skeletal Cleric',         cat: 'Ocultismo' },
  { type: 'Soul Offering',           cat: 'Ocultismo' },
  // Primalismo
  { type: 'Volcano',                 cat: 'Primalismo' },
  { type: 'Furious Assault',         cat: 'Primalismo' },
  { type: 'Snare',                   cat: 'Primalismo' },
  { type: 'Lunar Assault',           cat: 'Primalismo' },
  { type: 'Seismic Totem',           cat: 'Primalismo' },
  { type: 'Magma Orb',               cat: 'Primalismo' },
  { type: 'Charge',                  cat: 'Primalismo' },
  { type: 'Winged Explosion',        cat: 'Primalismo' },
  { type: 'Rolling Thunder',         cat: 'Primalismo' },
  { type: 'Mountain Fury',           cat: 'Primalismo' },
  { type: 'Devour',                  cat: 'Primalismo' },
  { type: 'Arctic Howl',             cat: 'Primalismo' },
  { type: 'Savage Cry',              cat: 'Primalismo' },
  { type: 'Spell Totem',             cat: 'Primalismo' },
  { type: 'Crosscut',                cat: 'Primalismo' },
  { type: 'Oil Barrage',             cat: 'Primalismo' },
  { type: 'Carnivorous Shrine',      cat: 'Primalismo' },
  { type: 'Tornado',                 cat: 'Primalismo' },
  { type: 'Rampage',                 cat: 'Primalismo' },
  { type: 'Flame Breath',            cat: 'Primalismo' },
  { type: 'Lunar Blessing',          cat: 'Primalismo' },
  { type: 'Walking Calamity',        cat: 'Primalismo' },
  // Maza
  { type: 'Earthquake',              cat: 'Maza' },
  { type: 'Bone Shatter',            cat: 'Maza' },
  { type: 'Rolling Slam',            cat: 'Maza' },
  { type: 'Armour Breaker',          cat: 'Maza' },
  { type: 'Infernal Cry',            cat: 'Maza' },
  { type: 'Shield Charge',           cat: 'Maza' },
  { type: 'Perfect Strike',          cat: 'Maza' },
  { type: 'Molten Blast',            cat: 'Maza' },
  { type: 'Resonating Shield',       cat: 'Maza' },
  { type: 'Leap Slam',               cat: 'Maza' },
  { type: 'Seismic Focus',           cat: 'Maza' },
  { type: 'Volcanic Fissure',        cat: 'Maza' },
  { type: 'Bulwark',                 cat: 'Maza' },
  { type: 'Fissure',                 cat: 'Maza' },
  { type: 'Fortify',                 cat: 'Maza' },
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
  { type: 'Stun Grenade',            cat: 'Ballesta' },
  { type: 'Rapid Fire',              cat: 'Ballesta' },
  { type: 'Ice Shards',              cat: 'Ballesta' },
  { type: 'Galvanic Shards',         cat: 'Ballesta' },
  { type: 'Gas Grenade',             cat: 'Ballesta' },
  { type: 'Artillery Ballista',      cat: 'Ballesta' },
  { type: 'Explosive Shot',          cat: 'Ballesta' },
  { type: 'Glacial Bolt',            cat: 'Ballesta' },
  { type: 'Voltaic Grenade',         cat: 'Ballesta' },
  { type: 'Siege Ballista',          cat: 'Ballesta' },
  { type: 'Explosive Storm Rounds',  cat: 'Ballesta' },
  { type: 'Oil Grenade',             cat: 'Ballesta' },
  { type: 'Hailstorm Rounds',        cat: 'Ballesta' },
  { type: 'Electric Burst Rounds',   cat: 'Ballesta' },
  { type: 'Emergency Reload',        cat: 'Ballesta' },
  { type: 'Mortar Round',            cat: 'Ballesta' },
  { type: 'Siege Cascade',           cat: 'Ballesta' },
  { type: 'Plasma Explosion',        cat: 'Ballesta' },
  { type: 'Cluster Grenade',         cat: 'Ballesta' },
  // Lanza
  { type: 'Recoil',                  cat: 'Lanza' },
  { type: 'Whirling Slash',          cat: 'Lanza' },
  { type: 'Whirlwind',               cat: 'Lanza' },
  { type: 'Explosive Spear',         cat: 'Lanza' },
  { type: 'Lightning Spear',         cat: 'Lanza' },
  { type: 'Execute',                 cat: 'Lanza' },
  { type: 'Frost Fangs',             cat: 'Lanza' },
  { type: 'Slash',                   cat: 'Lanza' },
  { type: 'Quick Assault',           cat: 'Lanza' },
  { type: 'Spear Field',             cat: 'Lanza' },
  { type: 'Storm Thrust',            cat: 'Lanza' },
  { type: 'Blood Hunt',              cat: 'Lanza' },
  { type: 'Glacial Thrust',          cat: 'Lanza' },
  { type: 'Primal Strikes',          cat: 'Lanza' },
  { type: 'Thundering Leap',         cat: 'Lanza' },
  { type: "Hound's Mark",            cat: 'Lanza' },
  { type: 'Tame Beast',              cat: 'Lanza' },
  { type: 'Whirlwind Thrust',        cat: 'Lanza' },
  { type: 'Elemental Pulse',         cat: 'Lanza' },
  { type: 'Wind Serpent Fury',       cat: 'Lanza' },
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
  { type: 'Cast on Dodge Roll',      cat: 'Soporte' },
  { type: 'Charge Management',       cat: 'Soporte' },
  { type: 'Reaper Conjuration',      cat: 'Soporte' },
  { type: 'Barrier Invocation',      cat: 'Soporte' },
  { type: 'Persistent Illusion',     cat: 'Soporte' },
  { type: 'Elemental Invocation',    cat: 'Soporte' },
  { type: 'Raging Spirits',          cat: 'Soporte' },
  { type: 'Convalescence',           cat: 'Soporte' },
  { type: 'Mana Remnants',           cat: 'Soporte' },
  { type: 'Element Drain',           cat: 'Soporte' },
  { type: 'Blink',                   cat: 'Soporte' },
  { type: 'Elemental Confluence',    cat: 'Soporte' },
  { type: 'Grim Feast',              cat: 'Soporte' },
  { type: 'Withering Presence',      cat: 'Soporte' },
  { type: 'Devouring Swarm',         cat: 'Soporte' },
  { type: 'Cast on Minion Death',    cat: 'Soporte' },
  { type: 'Cast on Critical Strike', cat: 'Soporte' },
  { type: 'Sacrifice',               cat: 'Soporte' },
  { type: 'Thorn Zone',              cat: 'Soporte' },
  { type: 'Wild Fury',               cat: 'Soporte' },
  { type: 'Wolf Pack',               cat: 'Soporte' },
  { type: 'Moment of Need',          cat: 'Soporte' },
  { type: 'Overwhelming Presence',   cat: 'Soporte' },
  { type: 'Bark Skin',               cat: 'Soporte' },
  { type: 'Eternal Fury',            cat: 'Soporte' },
  { type: 'Wild Conjuration',        cat: 'Soporte' },
  { type: 'Magma Barrier',           cat: 'Soporte' },
  { type: 'Plundered Plates',        cat: 'Soporte' },
  { type: 'Iron Barrier',            cat: 'Soporte' },
  { type: 'Savagery',                cat: 'Soporte' },
  { type: 'Ghost Dance',             cat: 'Soporte' },
  { type: 'Attrition',               cat: 'Soporte' },
  { type: 'Shard Collector',         cat: 'Soporte' },
  { type: 'Combat Frenzy',           cat: 'Soporte' },
  { type: 'Thorn Trail',             cat: 'Soporte' },
  { type: 'Rhoa Mount',              cat: 'Soporte' },
  { type: 'Phantom Archer',          cat: 'Soporte' },
];

// ─── GET /api/tracker/gems — datos en caché ──────────────────────────────────
router.get('/gems', (req, res) => {
  const gems = db.prepare(
    'SELECT * FROM gem_market_prices ORDER BY cheapest_price DESC'
  ).all();

  const meta = db.prepare(
    "SELECT MIN(fetched_at) as oldest, MAX(fetched_at) as newest, COUNT(*) as total FROM gem_market_prices"
  ).get();

  // Cuántas gemas están obsoletas (>24h)
  const cutoffStr = (() => {
    const d = new Date();
    d.setHours(d.getHours() - CACHE_MAX_AGE_HOURS);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  })();

  const staleCount = db.prepare(
    "SELECT COUNT(*) as n FROM gem_market_prices WHERE fetched_at < ?"
  ).get(cutoffStr)?.n ?? 0;

  const pendingCount = GEMS.length - (meta?.total ?? 0);

  res.json({ gems, meta, stale_count: staleCount, pending_count: pendingCount, total_gems: GEMS.length });
});

// ─── GET /api/tracker/scan — SSE, escanea gemas obsoletas (o todas con force) ─
router.get('/scan', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const force = req.query.force === 'true';

  // Calcular qué gemas hay que escanear
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

  // Cancelar si el cliente desconecta
  let cancelled = false;
  req.on('close', () => { cancelled = true; });

  let done = 0;

  for (const gem of gemsToScan) {
    if (cancelled) break;

    try {
      send({ status: 'scanning', gem_type: gem.type, category: gem.cat, progress: done, total: gemsToScan.length });

      const query = {
        query: {
          type: gem.type,
          stats:  [{ type: 'and', filters: [], disabled: true }],
          status: { option: 'any' },
          filters: {
            misc_filters: {
              filters: { gem_level: { min: 21 }, gem_sockets: { min: 5 } },
              disabled: false
            },
            trade_filters: {
              filters: { price: { option: 'divine' } }
            }
          }
        },
        sort: { price: 'asc' }
      };

      const search = await searchItems(query);
      let cheapest       = null;
      let total_listings = 0;

      if (search.result?.length > 0) {
        total_listings = search.total || search.result.length;
        const fetched  = await fetchListings(search.result.slice(0, 10), search.id);
        const filtered = (fetched.result || [])
          .filter(l => l?.listing?.price && isListingRecent(l.listing))
          .sort((a, b) => a.listing.price.amount - b.listing.price.amount);
        cheapest = filtered[0] || null;
      }

      const price         = cheapest?.listing?.price?.amount    ?? null;
      const currency      = cheapest?.listing?.price?.currency   ?? 'divine';
      const seller        = cheapest?.listing?.account?.name     ?? null;
      const seller_online = cheapest?.listing?.account?.online   ? 1 : 0;
      const indexed       = cheapest?.listing?.indexed           ?? null;

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

module.exports = router;
module.exports.GEMS = GEMS; // exportar para posible uso en otros módulos