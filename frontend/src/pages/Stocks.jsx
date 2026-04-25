import { useState, useEffect, useRef, useCallback } from 'react'
import { useLeague } from '../LeagueContext'
import GEM_TRANSLATIONS from '../gemTranslations'

const API = 'http://localhost:3001'

// Agrupa los stocks por tipo de gema y ordena listings por precio
function groupStocks(stocks) {
  const map = new Map()
  for (const s of stocks) {
    if (!map.has(s.gem_type)) {
      map.set(s.gem_type, {
        gem_type: s.gem_type,
        gem_name: s.gem_name || s.gem_type,
        listings: [],
      })
    }
    map.get(s.gem_type).listings.push({
      price:    s.price,
      currency: s.currency,
      id:       s.id,
    })
  }
  for (const g of map.values()) {
    g.listings.sort((a, b) => a.price - b.price)
  }
  return [...map.values()].sort((a, b) =>
    a.gem_name.localeCompare(b.gem_name, 'es')
  )
}
function getDisplayName(gemType, gemName) {
    const source = gemName || gemType
    const translated = GEM_TRANSLATIONS[source] ?? GEM_TRANSLATIONS[gemType]
    if (translated) return { display: translated, original: source }
    return { display: source, original: null }
  }
export default function Stocks({ user, onBack }) {
  const { realm, league } = useLeague()

  const [stocks,   setStocks]   = useState([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(null)   // { message, current, total }
  const [loaded,   setLoaded]   = useState(false)
  const [error,    setError]    = useState(null)

  const eventSrc = useRef(null)

  // ── SSE: progreso del escaneo de backend ───────────────────────────────────
  const connectSSE = useCallback(() => {
    if (eventSrc.current) eventSrc.current.close()

    const url = `${API}/api/chinofarmers/${encodeURIComponent(user.username)}/stocks/events`
    const es  = new EventSource(url)
    eventSrc.current = es

    es.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }

      switch (msg.type) {
        case 'connected':
          if (msg.isScanning) {
            setScanning(true)
            setProgress({ message: 'Escaneo en progreso (reiniciado)...', current: 0, total: 0 })
          }
          break

        case 'scan_start':
          setScanning(true)
          setProgress({ message: 'Buscando listings...', current: 0, total: 0 })
          break

        case 'found':
          setProgress(p => ({ ...p, message: `${msg.count} listings encontrados` }))
          break

        case 'fetching':
          setProgress({ message: msg.message, current: msg.progress, total: msg.total })
          break

        case 'scan_done':
          setScanning(false)
          setProgress(null)
          setStocks(msg.stocks || [])
          setLoaded(true)
          break

        case 'scan_error':
          setScanning(false)
          setProgress(null)
          setError(msg.error)
          break

        case 'stocks_cleared':
          setStocks([])
          break

        default: break
      }
    }

    es.onerror = () => {} // el navegador reconecta automáticamente

    return es
  }, [user.username])

  // ── Cargar datos existentes de la BBDD ─────────────────────────────────────
  const loadStocks = useCallback(async () => {
    try {
      const res  = await fetch(
        `${API}/api/chinofarmers/${encodeURIComponent(user.username)}/stocks` +
        `?realm=${realm}&league=${encodeURIComponent(league)}`
      )
      const data = await res.json()
      setStocks(data.stocks || [])
      if (data.isScanning) {
        setScanning(true)
        setProgress({ message: 'Escaneo en progreso...', current: 0, total: 0 })
      }
      return data
    } catch (err) {
      setError(err.message)
      return { stocks: [], isScanning: false }
    }
  }, [user.username, realm, league])

  // ── Disparar escaneo en el backend ─────────────────────────────────────────
  const triggerScan = useCallback(async () => {
    if (scanning) return
    setError(null)
    try {
      await fetch(
        `${API}/api/chinofarmers/${encodeURIComponent(user.username)}/stocks/scan`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ realm, league }),
        }
      )
    } catch (err) {
      setError(err.message)
    }
  }, [user.username, realm, league, scanning])

  // ── Borrar stocks de la BBDD ───────────────────────────────────────────────
  const clearStocks = async () => {
    if (!confirm(`¿Borrar los datos de stock de ${user.username}?`)) return
    try {
      await fetch(
        `${API}/api/chinofarmers/${encodeURIComponent(user.username)}/stocks` +
        `?realm=${realm}&league=${encodeURIComponent(league)}`,
        { method: 'DELETE' }
      )
      setStocks([])
    } catch (err) {
      setError(err.message)
    }
  }

  // ── Al montar: conectar SSE + cargar datos + auto-escaneo si no hay datos ──
  useEffect(() => {
    setLoaded(false)
    setStocks([])
    setError(null)
    setProgress(null)
    setScanning(false)

    const es = connectSSE()

    ;(async () => {
      const data = await loadStocks()
      setLoaded(true)
      // Primera visita: escanear automáticamente si no hay datos y no está escaneando
      if ((data.stocks || []).length === 0 && !data.isScanning) {
        await triggerScan()
      }
    })()

    return () => es.close()
  }, [user.username, realm, league]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Calcular agrupaciones ─────────────────────────────────────────────────
  const grouped    = groupStocks(stocks)
  const totalTypes = grouped.length
  const minPrice   = stocks.length > 0 ? Math.min(...stocks.map(s => s.price)) : null
  const maxPrice   = stocks.length > 0 ? Math.max(...stocks.map(s => s.price)) : null

  return (
    <div className="page-container">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn--ghost btn--sm" onClick={onBack}>
          ← Volver
        </button>

        <div>
          <h1 className="page-title" style={{ fontFamily: 'monospace' }}>
            📦 Stock de {user.username}
          </h1>
          <p className="page-subtitle">
            Gemas Nv.21 / 5 sockets · {league} · {realm.toUpperCase()}
          </p>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {scanning && (
            <span style={{ fontSize: 12, color: '#facc15', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="spinner" /> Escaneando...
            </span>
          )}
          <button
            className="btn btn--danger btn--sm"
            onClick={clearStocks}
            disabled={scanning || stocks.length === 0}
          >
            🗑️ Borrar
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={triggerScan}
            disabled={scanning}
          >
            {scanning ? '⏳ En curso...' : '🔄 Forzar escaneo'}
          </button>
        </div>
      </div>

      {/* ── Barra de progreso ────────────────────────────────────────────── */}
      {scanning && progress && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="spinner" />
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              {progress.message}
            </span>
            {progress.total > 0 && (
              <>
                <div style={{
                  flex: 1, background: 'var(--bg-elevated)',
                  borderRadius: 4, height: 6,
                }}>
                  <div style={{
                    width:      `${(progress.current / progress.total) * 100}%`,
                    background: 'var(--accent)',
                    height:     '100%',
                    borderRadius: 4,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <span style={{ color: 'var(--accent)', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {progress.current}/{progress.total}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: '#f87171' }}>
          <p style={{ color: '#f87171', margin: 0, fontSize: 13 }}>⚠️ {error}</p>
        </div>
      )}

      {/* ── Stats ───────────────────────────────────────────────────────── */}
      {stocks.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div className="stat-chip">
            <span className="stat-value">{totalTypes}</span>
            <span className="stat-label">Tipos de gema</span>
          </div>
          <div className="stat-chip">
            <span className="stat-value">{stocks.length}</span>
            <span className="stat-label">Listings totales</span>
          </div>
          {minPrice !== null && (
            <div className="stat-chip" style={{ borderColor: '#4ade8040' }}>
              <span className="stat-value" style={{ color: '#4ade80' }}>
                {minPrice.toFixed(1)} ◈
              </span>
              <span className="stat-label">Precio mínimo</span>
            </div>
          )}
          {maxPrice !== null && (
            <div className="stat-chip">
              <span className="stat-value">{maxPrice.toFixed(1)} ◈</span>
              <span className="stat-label">Precio máximo</span>
            </div>
          )}
        </div>
      )}

      {/* ── Tabla ───────────────────────────────────────────────────────── */}
      <div className="card">
        {!loaded && !scanning ? (
          <div className="empty-state">
            <span className="spinner" style={{ fontSize: 24 }} />
            <p>Cargando...</p>
          </div>
        ) : loaded && stocks.length === 0 && !scanning ? (
          <div className="empty-state">
            <span style={{ fontSize: 40 }}>📭</span>
            <p>
              No se encontraron gemas Nv.21 / 5 sockets en venta
              o el usuario no tiene listings activos.
            </p>
          </div>
        ) : grouped.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Gema</th>
                <th style={{ textAlign: 'center', width: 80 }}>Cantidad</th>
                <th style={{ width: 80, color: '#4ade80' }}>Mín ◈</th>
                <th style={{ width: 80 }}>Máx ◈</th>
                <th>Todos los precios</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(group => {
                const minL = group.listings[0]
                const maxL = group.listings[group.listings.length - 1]
                return (
                  <tr key={group.gem_type}>

                    {/* Nombre */}
                    <td style={{ fontWeight: 600, maxWidth: 200 }}>
                    {(() => {
                        const { display, original } = getDisplayName(group.gem_type, group.gem_name)
                        return (
                        <span
                            title={original ? `EN: ${original}` : group.gem_type}
                            style={original ? { cursor: 'help', borderBottom: '1px dotted var(--text-secondary)' } : undefined}
                        >
                            {display}
                        </span>
                        )
                    })()}
                    </td>

                    {/* Cantidad */}
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        display:      'inline-block',
                        background:   'var(--bg-elevated)',
                        border:       '1px solid var(--border)',
                        borderRadius: 4,
                        padding:      '2px 10px',
                        fontSize:     13,
                        fontWeight:   700,
                        color:        'var(--accent)',
                      }}>
                        ×{group.listings.length}
                      </span>
                    </td>

                    {/* Mínimo */}
                    <td style={{ color: '#4ade80', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {minL.price}
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 2 }}>
                        {minL.currency}
                      </span>
                    </td>

                    {/* Máximo */}
                    <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {maxL.price}
                      <span style={{ fontSize: 11, marginLeft: 2 }}>
                        {maxL.currency}
                      </span>
                    </td>

                    {/* Todos los precios */}
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {group.listings.map((l, i) => (
                          <span key={i} style={{
                            background:   i === 0 ? 'rgba(74,222,128,0.1)' : 'var(--bg-elevated)',
                            border:       `1px solid ${i === 0 ? '#4ade8060' : 'var(--border)'}`,
                            borderRadius: 4,
                            padding:      '2px 7px',
                            fontSize:     12,
                            fontWeight:   i === 0 ? 600 : 400,
                            color:        i === 0 ? '#4ade80' : 'var(--text-primary)',
                          }}>
                            {l.price}
                            <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 2 }}>
                              {l.currency}
                            </span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  )
}