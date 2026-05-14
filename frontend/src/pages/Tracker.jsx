import { useState, useMemo } from 'react'
import GEM_TRANSLATIONS from '../gemTranslations'
import { useTracker } from '../TrackerContext'

const CATEGORIES = ['Todas', 'Arco', 'Bastón', 'Ocultismo', 'Primalismo', 'Maza', 'Ballesta', 'Lanza', 'Heraldo', 'Soporte']

const CAT_COLORS = {
  'Arco':       '#22c55e',
  'Bastón':     '#60a5fa',
  'Ocultismo':  '#a855f7',
  'Primalismo': '#f97316',
  'Maza':       '#ef4444',
  'Ballesta':   '#eab308',
  'Lanza':      '#06b6d4',
  'Heraldo':    '#f43f5e',
  'Soporte':    '#8b5cf6',
}

function formatAge(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h >= 24) return `hace ${Math.floor(h / 24)}d`
  if (h > 0)   return `hace ${h}h ${m}m`
  return `hace ${m}m`
}

function isStaleDate(dateStr, maxHours = 24) {
  if (!dateStr) return true
  return (Date.now() - new Date(dateStr).getTime()) > maxHours * 3_600_000
}

function normalizeOnlineStatus(value, isOwn = false) {
  if (isOwn) return 'online'
  if (value === 'online'  || value === 1 || value === true)  return 'online'
  if (value === 'offline' || value === 0 || value === false)  return 'offline'
  return 'unknown'
}

let _pulseInjected = false
function injectPulseStyle() {
  if (_pulseInjected || typeof document === 'undefined') return
  _pulseInjected = true
  const s = document.createElement('style')
  s.textContent = `
    @keyframes sellerPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
      50%       { box-shadow: 0 0 0 4px rgba(34,197,94,0);  }
    }
    @keyframes unknownPulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.5; }
    }
  `
  document.head.appendChild(s)
}

function OnlineDot({ status, size = 8 }) {
  injectPulseStyle()
  const color = status === 'online'  ? '#22c55e'
              : status === 'unknown' ? '#f59e0b'
              :                        '#4b5563'
  const animation = status === 'online'  ? 'sellerPulse 2s ease-in-out infinite'
                  : status === 'unknown' ? 'unknownPulse 2.5s ease-in-out infinite'
                  :                        'none'
  const title = status === 'online'  ? 'Online'
              : status === 'unknown' ? 'Estado desconocido (puede tener privacidad activada)'
              :                        'Offline'
  return (
    <span title={title} style={{
      display: 'inline-block', width: `${size}px`, height: `${size}px`,
      borderRadius: '50%', flexShrink: 0, verticalAlign: 'middle',
      background: color, animation, transition: 'background 0.3s',
    }} />
  )
}

function SellerBadge({ seller, onlineStatus, isOwn = false, fetchedAt }) {
  const ageStr  = fetchedAt ? `Estado capturado ${formatAge(fetchedAt)}` : ''
  const tooltip = isOwn
    ? 'Tu cuenta'
    : onlineStatus === 'unknown'
      ? `Estado desconocido (¿privacidad activada?) · ${ageStr}`
      : `${onlineStatus === 'online' ? 'Online' : 'Offline'} · ${ageStr}`
  return (
    <span title={tooltip} style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
      fontSize: '0.82rem', color: isOwn ? 'var(--accent)' : 'inherit',
      fontWeight: isOwn ? 600 : 400, cursor: 'help',
    }}>
      <OnlineDot status={isOwn ? 'online' : onlineStatus} />
      {seller}
    </span>
  )
}

function CurrencyBadge({ currency }) {
  const isAnn = currency === 'annulment'
  return (
    <span style={{
      fontSize: '0.68rem', fontWeight: 700, padding: '0 4px',
      borderRadius: 3, marginLeft: 4,
      background: isAnn ? 'rgba(251,191,36,0.15)' : 'rgba(139,92,246,0.15)',
      border: `1px solid ${isAnn ? '#fbbf2460' : '#8b5cf660'}`,
      color: isAnn ? '#fbbf24' : '#a78bfa',
    }}>
      {isAnn ? 'Ø ann' : '◈ div'}
    </span>
  )
}

function Stat({ label, value, accent, dim, warn }) {
  const color = warn   ? '#f59e0b'
              : accent ? 'var(--accent)'
              : dim    ? 'var(--text-secondary)'
              : 'var(--text-primary)'
  return (
    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
      {label}:{' '}
      <strong style={{ color }}>{value}</strong>
    </span>
  )
}

const ANNULMENT_TO_DIVINE = 0.5

function divineEquiv(price, currency) {
  if (price === null || price === undefined) return Infinity
  if (currency === 'annulment') return price * ANNULMENT_TO_DIVINE
  return price
}

export default function Tracker() {
  // ── Todo lo persistente viene del contexto ───────────────────────────────
  const {
    gems, meta, staleCount, pendingCount, totalGems, myAccount,
    scanning, scanProgress, currentGem, evtSourceRef,
    startScan, stopScan, clearAllGems,
  } = useTracker()

  // ── Estado solo de UI (filtros) — puede vivir en el componente ───────────
  const [filterCat,   setFilterCat]   = useState('Todas')
  const [sortBy,      setSortBy]      = useState('price_desc')
  const [search,      setSearch]      = useState('')
  const [hideEmpty,   setHideEmpty]   = useState(false)
  const [hideSupport, setHideSupport] = useState(false)

  // ── Lista derivada ────────────────────────────────────────────────────────
  const gemList = useMemo(() => {
    let list = Object.values(gems)

    if (filterCat !== 'Todas') list = list.filter(g => g.category === filterCat)
    if (hideEmpty)   list = list.filter(g => g.cheapest_price !== null)
    if (hideSupport) list = list.filter(g => g.category !== 'Soporte')

    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(g => {
        const es   = (GEM_TRANSLATIONS[g.gem_type] || g.gem_type).toLowerCase()
        const orig = g.gem_type.toLowerCase()
        return es.includes(s) || orig.includes(s)
      })
    }

    list.sort((a, b) => {
      if (sortBy === 'price_desc') return divineEquiv(b.cheapest_price, b.currency) - divineEquiv(a.cheapest_price, a.currency)
      if (sortBy === 'price_asc')  return divineEquiv(a.cheapest_price, a.currency) - divineEquiv(b.cheapest_price, b.currency)
      if (sortBy === 'name') {
        const na = GEM_TRANSLATIONS[a.gem_type] || a.gem_type
        const nb = GEM_TRANSLATIONS[b.gem_type] || b.gem_type
        return na.localeCompare(nb, 'es')
      }
      if (sortBy === 'listings') return (b.total_listings || 0) - (a.total_listings || 0)
      if (sortBy === 'updated') {
        if (!a.fetched_at) return 1
        if (!b.fetched_at) return -1
        return new Date(a.fetched_at) - new Date(b.fetched_at)
      }
      return 0
    })

    return list
  }, [gems, filterCat, sortBy, search, hideEmpty, hideSupport])

  const totalScanned   = Object.keys(gems).length
  const totalWithPrice = Object.values(gems).filter(g => g.cheapest_price !== null).length
  const dataIsStale    = isStaleDate(meta?.newest)
  const noDataAtAll    = totalScanned === 0
  const isForceScan    = evtSourceRef.current?.url?.includes('force')

  const scanBtnLabel = noDataAtAll
    ? '🚀 Primer escaneo'
    : staleCount > 0
      ? `🔄 Actualizar ${staleCount + pendingCount} obsoletas`
      : '✅ Todo actualizado'

  return (
    <div className="tracker">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <h1 className="page-heading">📈 Mercado de Gemas Nv.21 / 5⬡</h1>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {meta?.newest && (
            <span style={{ fontSize: '0.8rem', color: dataIsStale ? '#f59e0b' : 'var(--text-secondary)' }}>
              {dataIsStale ? '⚠️' : '✅'} Actualizado {formatAge(meta.newest)}
            </span>
          )}

          {/* Indicador de escaneo en curso (visible desde cualquier página al volver) */}
          {scanning && (
            <span style={{ fontSize: '0.8rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span className="spinner" /> Escaneo en curso...
            </span>
          )}

          <button
            className="btn btn--secondary"
            onClick={() => startScan(false)}
            disabled={scanning || (!noDataAtAll && staleCount === 0 && pendingCount === 0)}
          >
            {scanning && !isForceScan ? '⏳ Escaneando...' : scanBtnLabel}
          </button>
          <button className="btn btn--primary" onClick={() => startScan(true)} disabled={scanning}>
            🔃 Forzar escaneo completo
          </button>
          {scanning && (
            <button className="btn btn--danger" onClick={stopScan}>✕ Detener</button>
          )}
          {!scanning && totalScanned > 0 && (
            <button className="btn btn--danger" onClick={clearAllGems}>🗑️ Borrar caché</button>
          )}
        </div>
      </div>

      {/* ── Barra de progreso ── */}
      {scanProgress && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{
              color: 'var(--text-secondary)', fontSize: '0.85rem',
              flex: '1 1 0', minWidth: 0, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {currentGem && (
                <span style={{
                  color: CAT_COLORS[currentGem.cat] || 'var(--accent)',
                  marginRight: '0.5rem', fontWeight: 600,
                }}>
                  [{currentGem.cat}]
                </span>
              )}
              {scanProgress.message}
            </span>
            {scanProgress.total > 0 && (
              <>
                <div style={{ flex: '0 0 180px', background: 'var(--bg-elevated)', borderRadius: '4px', height: '6px' }}>
                  <div style={{
                    width: `${(scanProgress.progress / scanProgress.total) * 100}%`,
                    background: 'var(--accent)', height: '100%', borderRadius: '4px',
                    transition: 'width 0.4s ease',
                  }} />
                </div>
                <span style={{ color: 'var(--accent)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  {scanProgress.progress}/{scanProgress.total}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Stats ── */}
      {totalScanned > 0 && (
        <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', padding: '0.75rem 1rem' }}>
          <Stat label="Escaneadas" value={`${totalScanned} / ${totalGems}`} />
          <Stat label="Con precio"  value={totalWithPrice}               accent />
          <Stat label="Sin oferta"  value={totalScanned - totalWithPrice} dim />
          {staleCount   > 0 && <Stat label="Obsoletas"  value={staleCount}   warn />}
          {pendingCount > 0 && <Stat label="Pendientes" value={pendingCount} warn />}
          {gemList.length !== totalScanned && <Stat label="En filtro" value={gemList.length} />}
        </div>
      )}

      {/* ── Leyenda online ── */}
      {totalScanned > 0 && (
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <OnlineDot status="online"  size={7} /> Online
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <OnlineDot status="unknown" size={7} /> Desconocido (posible privacidad)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <OnlineDot status="offline" size={7} /> Offline
          </span>
          <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            · Estado capturado en el último chequeo
          </span>
        </div>
      )}

      {/* ── Filtros ── */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input" placeholder="🔍 Buscar gema..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: '1 1 200px' }}
          />
          <select className="input input--short" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input input--short" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="price_desc">💰 Mayor precio</option>
            <option value="price_asc">💰 Menor precio</option>
            <option value="name">🔤 Nombre A-Z</option>
            <option value="listings">📦 Más listados</option>
            <option value="updated">🕐 Más antiguas</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} style={{ cursor: 'pointer' }} />
            Solo con precio
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={hideSupport} onChange={e => setHideSupport(e.target.checked)} style={{ cursor: 'pointer' }} />
            Ocultar soportes
          </label>
        </div>
      </div>

      {/* ── Tabla ── */}
      {gemList.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Gema</th>
                <th>Categoría</th>
                <th>Precio mín.</th>
                <th>Listados</th>
                <th>Vendedor</th>
                <th style={{ whiteSpace: 'nowrap' }}>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {gemList.map(gem => {
                const nameEs      = GEM_TRANSLATIONS[gem.gem_type] || gem.gem_type
                const namesDiffer = nameEs !== gem.gem_type
                const hasPrice    = gem.cheapest_price !== null
                const rowStale    = isStaleDate(gem.fetched_at)
                const catColor    = CAT_COLORS[gem.category] || 'var(--text-secondary)'
                const isOwn       = !!myAccount && gem.seller?.toLowerCase() === myAccount.toLowerCase()
                const onlineStatus = normalizeOnlineStatus(gem.seller_online, isOwn)

                return (
                  <tr key={gem.gem_type} style={{ opacity: hasPrice ? 1 : 0.45 }}>

                    <td>
                      <span
                        title={namesDiffer ? `EN: ${gem.gem_type}` : undefined}
                        style={namesDiffer ? { cursor: 'help', borderBottom: '1px dotted var(--text-secondary)' } : undefined}
                      >
                        {nameEs}
                      </span>
                    </td>

                    <td>
                      <span style={{
                        fontSize: '0.75rem', fontWeight: 600, color: catColor,
                        background: catColor + '22', border: `1px solid ${catColor}55`,
                        borderRadius: '4px', padding: '0.1rem 0.4rem', whiteSpace: 'nowrap',
                      }}>
                        {gem.category || '—'}
                      </span>
                    </td>

                    <td>
                      {hasPrice ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.15rem' }}>
                          <strong style={{ color: 'var(--accent)', fontSize: '1rem' }}>
                            {gem.cheapest_price}
                          </strong>
                          <CurrencyBadge currency={gem.currency} />
                          {gem.currency === 'annulment' && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginLeft: 2 }}>
                              ≈{(gem.cheapest_price * ANNULMENT_TO_DIVINE).toFixed(2)}◈
                            </span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Sin oferta</span>
                      )}
                    </td>

                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {gem.total_listings > 0 ? gem.total_listings : '—'}
                    </td>

                    <td>
                      {gem.seller ? (
                        <SellerBadge
                          seller={gem.seller}
                          onlineStatus={onlineStatus}
                          isOwn={isOwn}
                          fetchedAt={gem.fetched_at}
                        />
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>

                    <td style={{
                      fontSize: '0.75rem',
                      color: rowStale ? '#f59e0b' : 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                    }}>
                      {rowStale && '⚠️ '}{formatAge(gem.fetched_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : noDataAtAll ? (
        <div className="empty-state">
          <div style={{ marginBottom: '1rem', fontSize: '2rem' }}>📭</div>
          <div>No hay datos en caché.</div>
          <div style={{ marginTop: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Pulsa <strong>Primer escaneo</strong> para consultar el mercado de todas las gemas.
            <br />El proceso tarda ~{Math.ceil(200 * 2 * 5 / 60)} min por el rate limit de la API.
          </div>
        </div>
      ) : (
        <div className="empty-state">Sin resultados para el filtro actual.</div>
      )}
    </div>
  )
}