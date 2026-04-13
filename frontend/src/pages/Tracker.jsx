import { useState, useEffect, useRef, useMemo } from 'react'
import GEM_TRANSLATIONS from '../gemTranslations'

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

export default function Tracker() {
  // ─── Estado principal ────────────────────────────────────────────────────────
  // gems es un Map gem_type → objeto con los datos
  const [gems, setGems]           = useState({})
  const [meta, setMeta]           = useState(null)       // { oldest, newest, total }
  const [staleCount, setStaleCount]   = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [totalGems, setTotalGems] = useState(0)

  // ─── Scan ────────────────────────────────────────────────────────────────────
  const [scanning, setScanning]         = useState(false)
  const [scanProgress, setScanProgress] = useState(null)  // { message, progress, total }
  const [currentGem, setCurrentGem]     = useState(null)  // gem siendo consultada ahora
  const evtSourceRef = useRef(null)

  // ─── Filtros ─────────────────────────────────────────────────────────────────
  const [filterCat, setFilterCat] = useState('Todas')
  const [sortBy, setSortBy]       = useState('price_desc')
  const [search, setSearch]       = useState('')
  const [hideEmpty, setHideEmpty] = useState(false)

  // ─── Carga inicial ───────────────────────────────────────────────────────────
  useEffect(() => { loadCachedGems() }, [])

  async function loadCachedGems() {
    try {
      const res  = await fetch('/api/tracker/gems')
      const data = await res.json()
      const map  = {}
      for (const g of data.gems) map[g.gem_type] = g
      setGems(map)
      setMeta(data.meta)
      setStaleCount(data.stale_count   ?? 0)
      setPendingCount(data.pending_count ?? 0)
      setTotalGems(data.total_gems      ?? 0)
    } catch (err) {
      console.error('Error cargando caché de gemas:', err)
    }
  }

  // ─── Iniciar escaneo ─────────────────────────────────────────────────────────
  function startScan(force = false) {
    if (scanning) return
    setScanning(true)
    setCurrentGem(null)
    setScanProgress({ message: 'Conectando...', progress: 0, total: 0 })

    const evtSource = new EventSource(`/api/tracker/scan${force ? '?force=true' : ''}`)
    evtSourceRef.current = evtSource

    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data)

      if (data.status === 'start') {
        setScanProgress({ message: `Escaneando ${data.total} gemas pendientes...`, progress: 0, total: data.total })
      }

      if (data.status === 'scanning') {
        const nameEs = GEM_TRANSLATIONS[data.gem_type] || data.gem_type
        setCurrentGem({ name: nameEs, cat: data.category })
        setScanProgress(prev => ({
          ...prev,
          message: `Consultando: ${nameEs}`,
          progress: data.progress,
        }))
      }

      if (data.status === 'gem_done' || data.status === 'gem_error') {
        const { gem_type, category, price, currency, seller, seller_online, total_listings, progress, total } = data
        setScanProgress(prev => ({ ...prev, progress, total }))

        if (data.status === 'gem_done') {
          setGems(prev => ({
            ...prev,
            [gem_type]: {
              gem_type,
              category,
              cheapest_price:  price    ?? null,
              currency:        currency ?? 'divine',
              seller:          seller   ?? null,
              seller_online:   seller_online ?? 0,
              total_listings:  total_listings ?? 0,
              fetched_at:      new Date().toISOString(),
            }
          }))
        }
      }

      if (data.status === 'done') {
        evtSource.close()
        setScanning(false)
        setScanProgress(null)
        setCurrentGem(null)
        // Refrescar meta tras el scan
        loadCachedGems()
      }
    }

    evtSource.onerror = () => {
      evtSource.close()
      setScanning(false)
      setScanProgress({ message: 'Error de conexión — escaneo interrumpido' })
      setCurrentGem(null)
    }
  }

  function stopScan() {
    evtSourceRef.current?.close()
    evtSourceRef.current = null
    setScanning(false)
    setScanProgress(null)
    setCurrentGem(null)
  }

  // ─── Lista derivada ──────────────────────────────────────────────────────────
  const gemList = useMemo(() => {
    let list = Object.values(gems)

    if (filterCat !== 'Todas') {
      list = list.filter(g => g.category === filterCat)
    }

    if (hideEmpty) {
      list = list.filter(g => g.cheapest_price !== null)
    }

    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(g => {
        const es   = (GEM_TRANSLATIONS[g.gem_type] || g.gem_type).toLowerCase()
        const orig = g.gem_type.toLowerCase()
        return es.includes(s) || orig.includes(s)
      })
    }

    list.sort((a, b) => {
      if (sortBy === 'price_desc') {
        if (a.cheapest_price === null && b.cheapest_price === null) return 0
        if (a.cheapest_price === null) return 1
        if (b.cheapest_price === null) return -1
        return b.cheapest_price - a.cheapest_price
      }
      if (sortBy === 'price_asc') {
        if (a.cheapest_price === null && b.cheapest_price === null) return 0
        if (a.cheapest_price === null) return 1
        if (b.cheapest_price === null) return -1
        return a.cheapest_price - b.cheapest_price
      }
      if (sortBy === 'name') {
        const na = GEM_TRANSLATIONS[a.gem_type] || a.gem_type
        const nb = GEM_TRANSLATIONS[b.gem_type] || b.gem_type
        return na.localeCompare(nb, 'es')
      }
      if (sortBy === 'listings') {
        return (b.total_listings || 0) - (a.total_listings || 0)
      }
      if (sortBy === 'updated') {
        if (!a.fetched_at) return 1
        if (!b.fetched_at) return -1
        return new Date(a.fetched_at) - new Date(b.fetched_at) // más antiguo primero
      }
      return 0
    })

    return list
  }, [gems, filterCat, sortBy, search, hideEmpty])

  const totalScanned     = Object.keys(gems).length
  const totalWithPrice   = Object.values(gems).filter(g => g.cheapest_price !== null).length
  const dataIsStale      = isStaleDate(meta?.newest)
  const noDataAtAll      = totalScanned === 0

  const scanBtnLabel = noDataAtAll
    ? '🚀 Primer escaneo'
    : staleCount > 0
      ? `🔄 Actualizar ${staleCount + pendingCount} obsoletas`
      : '✅ Todo actualizado'

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="tracker">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <h1 className="page-heading">📈 Mercado de Gemas Nv.21 / 5⬡</h1>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {meta?.newest && (
            <span style={{
              fontSize: '0.8rem',
              color: dataIsStale ? '#f59e0b' : 'var(--text-secondary)',
            }}>
              {dataIsStale ? '⚠️' : '✅'} Actualizado {formatAge(meta.newest)}
            </span>
          )}

          <button
            className="btn btn--secondary"
            onClick={() => startScan(false)}
            disabled={scanning || (!noDataAtAll && staleCount === 0 && pendingCount === 0)}
          >
            {scanning && !evtSourceRef.current?.url?.includes('force') ? '⏳ Escaneando...' : scanBtnLabel}
          </button>

          <button
            className="btn btn--primary"
            onClick={() => startScan(true)}
            disabled={scanning}
          >
            🔃 Forzar escaneo completo
          </button>

          {scanning && (
            <button className="btn btn--danger" onClick={stopScan}>
              ✕ Detener
            </button>
          )}
        </div>
      </div>

      {/* ── Barra de progreso ── */}
      {scanProgress && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{
              color: 'var(--text-secondary)',
              fontSize: '0.85rem',
              flex: '1 1 0',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {currentGem && (
                <span style={{
                  color: CAT_COLORS[currentGem.cat] || 'var(--accent)',
                  marginRight: '0.5rem',
                  fontWeight: 600,
                }}>
                  [{currentGem.cat}]
                </span>
              )}
              {scanProgress.message}
            </span>

            {scanProgress.total > 0 && (
              <>
                <div style={{
                  flex: '0 0 180px',
                  background: 'var(--bg-elevated)',
                  borderRadius: '4px',
                  height: '6px',
                }}>
                  <div style={{
                    width: `${(scanProgress.progress / scanProgress.total) * 100}%`,
                    background: 'var(--accent)',
                    height: '100%',
                    borderRadius: '4px',
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

      {/* ── Stats rápidos ── */}
      {totalScanned > 0 && (
        <div className="card" style={{
          marginBottom: '1rem',
          display: 'flex',
          gap: '1.5rem',
          flexWrap: 'wrap',
          padding: '0.75rem 1rem',
        }}>
          <Stat label="Escaneadas"   value={`${totalScanned} / ${totalGems}`} />
          <Stat label="Con precio"   value={totalWithPrice}    accent />
          <Stat label="Sin oferta"   value={totalScanned - totalWithPrice} dim />
          {staleCount > 0 && <Stat label="Obsoletas" value={staleCount} warn />}
          {pendingCount > 0 && <Stat label="Pendientes" value={pendingCount} warn />}
          {gemList.length !== totalScanned && (
            <Stat label="En filtro" value={gemList.length} />
          )}
        </div>
      )}

      {/* ── Filtros ── */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input"
            placeholder="🔍 Buscar gema..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: '1 1 200px' }}
          />

          <select className="input input--short" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>
                {c}{c !== 'Todas' && CAT_COLORS[c] ? '' : ''}
              </option>
            ))}
          </select>

          <select className="input input--short" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="price_desc">💰 Mayor precio</option>
            <option value="price_asc">💰 Menor precio</option>
            <option value="name">🔤 Nombre A-Z</option>
            <option value="listings">📦 Más listados</option>
            <option value="updated">🕐 Más antiguas</option>
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={hideEmpty}
              onChange={e => setHideEmpty(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Solo con precio
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
                const nameEs     = GEM_TRANSLATIONS[gem.gem_type] || gem.gem_type
                const namesDiffer = nameEs !== gem.gem_type
                const hasPrice   = gem.cheapest_price !== null
                const rowStale   = isStaleDate(gem.fetched_at)
                const catColor   = CAT_COLORS[gem.category] || 'var(--text-secondary)'

                return (
                  <tr
                    key={gem.gem_type}
                    style={{ opacity: hasPrice ? 1 : 0.45 }}
                  >
                    {/* Nombre */}
                    <td>
                      <span
                        title={namesDiffer ? `EN: ${gem.gem_type}` : undefined}
                        style={namesDiffer
                          ? { cursor: 'help', borderBottom: '1px dotted var(--text-secondary)' }
                          : undefined
                        }
                      >
                        {nameEs}
                      </span>
                    </td>

                    {/* Categoría */}
                    <td>
                      <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: catColor,
                        background: catColor + '22',
                        border: `1px solid ${catColor}55`,
                        borderRadius: '4px',
                        padding: '0.1rem 0.4rem',
                        whiteSpace: 'nowrap',
                      }}>
                        {gem.category || '—'}
                      </span>
                    </td>

                    {/* Precio */}
                    <td>
                      {hasPrice ? (
                        <strong style={{ color: 'var(--accent)', fontSize: '1rem' }}>
                          {gem.cheapest_price}
                          <span style={{ fontSize: '0.75rem', fontWeight: 400, marginLeft: '0.3rem', color: 'var(--text-secondary)' }}>
                            {gem.currency}
                          </span>
                        </strong>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Sin oferta</span>
                      )}
                    </td>

                    {/* Listados activos */}
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {gem.total_listings > 0 ? gem.total_listings : '—'}
                    </td>

                    {/* Vendedor */}
                    <td style={{ fontSize: '0.82rem' }}>
                      {gem.seller ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{
                            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                            background: gem.seller_online ? '#22c55e' : '#4b5563',
                            boxShadow:  gem.seller_online ? '0 0 5px #22c55e88' : 'none',
                          }} />
                          {gem.seller}
                        </span>
                      ) : '—'}
                    </td>

                    {/* Última actualización */}
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

// ─── Componente stat pequeño ─────────────────────────────────────────────────
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