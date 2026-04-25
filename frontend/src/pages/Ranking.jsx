// frontend/src/pages/Ranking.jsx
import { useState, useMemo, useRef } from 'react'
import { useLeague } from '../LeagueContext'

const TYPE_LABELS = {
  weapon:    '⚔️ Arma única',
  armour:    '🛡️ Armadura única',
  accessory: '💍 Accesorio único',
  flask:     '⚗️ Frasco único',
  jewel:     '💎 Joya única',
  currency:  '💰 Divisa',
}

const TYPE_COLORS = {
  weapon:    '#c0a060',
  armour:    '#c0a060',
  accessory: '#c0a060',
  flask:     '#c0a060',
  jewel:     '#c0a060',
  currency:  '#1aa29b',
}

function changeBadge(pct) {
  if (pct == null) return null
  const up = pct >= 0
  return (
    <span style={{
      fontSize: '0.72rem', fontWeight: 600, padding: '0.1rem 0.3rem',
      borderRadius: '3px',
      background: up ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
      color: up ? '#22c55e' : '#ef4444',
    }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

const SORT_OPTIONS = [
  { value: 'divineValue_desc', label: '💰 Más caros (divine)' },
  { value: 'chaosValue_desc',  label: '🔴 Más caros (chaos)' },
  { value: 'change1d_desc',    label: '🔺 Mayor subida 24h' },
  { value: 'change1d_asc',     label: '🔻 Mayor bajada 24h' },
  { value: 'listings_desc',    label: '📦 Más listings' },
]

// ─── Componente ───────────────────────────────────────────────────────────────
export default function Ranking() {
  const { realm, league }         = useLeague()
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const [sortBy, setSortBy]       = useState('divineValue_desc')
  const [search, setSearch]       = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const cacheRef = useRef({})   // { leagueKey: { items, fetchedAt } }

  // ─── Fetch ─────────────────────────────────────────────────────────────────
  async function fetchTop100() {
    if (loading) return
    const key = `${league}::${realm}`

    // Caché de 5 minutos
    const cached = cacheRef.current[key]
    if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) {
      setItems(cached.items)
      setFetchedAt(cached.fetchedAt)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/ranking/top100?league=${encodeURIComponent(league)}&realm=${realm}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      cacheRef.current[key] = { items: data.items, fetchedAt: data.fetchedAt }
      setItems(data.items)
      setFetchedAt(data.fetchedAt)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── Filtrar + ordenar ─────────────────────────────────────────────────────
  const visible = useMemo(() => {
    let list = items
    if (typeFilter !== 'all') list = list.filter(i => i.type === typeFilter)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(i => i.name.toLowerCase().includes(q))

    const [field, dir] = sortBy.split('_')
    list = [...list].sort((a, b) => {
      let va = field === 'divineValue' ? a.divineValue
             : field === 'chaosValue'  ? a.chaosValue
             : field === 'change1d'    ? (a.change1d ?? -999)
             : a.listingCount
      let vb = field === 'divineValue' ? b.divineValue
             : field === 'chaosValue'  ? b.chaosValue
             : field === 'change1d'    ? (b.change1d ?? -999)
             : b.listingCount
      return dir === 'desc' ? vb - va : va - vb
    })
    return list
  }, [items, typeFilter, search, sortBy])

  // Categorías únicas presentes
  const presentTypes = useMemo(() => [...new Set(items.map(i => i.type))], [items])

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="monitor">

      {/* Cabecera */}
      <div className="page-header">
        <h1 className="page-heading">🏆 Top 100 del Mercado</h1>

        {/* Filtro tipo */}
        <select
          className="input input--short"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="all">Todas las categorías</option>
          {presentTypes.map(t => (
            <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
          ))}
        </select>

        {/* Ordenar */}
        <select
          className="input input--short"
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          style={{ minWidth: '190px' }}
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Buscar */}
        <input
          className="input"
          placeholder="🔍 Buscar ítem..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: '200px' }}
        />

        <button
          className="btn btn--primary"
          onClick={fetchTop100}
          disabled={loading}
        >
          {loading ? '⏳ Cargando...' : '🔄 Actualizar'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="card" style={{ background: 'rgba(239,68,68,0.1)', borderColor: '#ef4444', color: '#f87171', marginBottom: '1rem' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Meta */}
      {fetchedAt && !loading && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
          Fuente: poe2scout.com · Última actualización: {new Date(fetchedAt).toLocaleTimeString('es-ES')} ·
          {' '}{visible.length} ítems · <strong>{league}</strong> 
          {' '}· <span style={{ fontSize: '0.72rem' }}>caché 5 min</span>
        </p>
      )}

      {/* Estado vacío */}
      {!loading && items.length === 0 && !error && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>💸</div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Pulsa <strong>Actualizar</strong> para cargar los ítems más caros del mercado.
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
            Datos de poe2scout.com para <strong>{league}</strong>.
            La primera carga tarda ~1–2 s.
          </p>
        </div>
      )}

      {/* Tabla */}
      {visible.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: '4%'  }} />
              <col style={{ width: '4%'  }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'center' }}>#</th>
                <th></th>
                <th>Ítem</th>
                <th style={{ textAlign: 'right' }}>Divine</th>
                <th style={{ textAlign: 'right' }}>Chaos</th>
                <th style={{ textAlign: 'center' }}>Cambio 24h</th>
                <th style={{ textAlign: 'right' }}>Listings</th>
                <th>Categoría</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item, idx) => (
                <tr key={`${item.name}-${idx}`} style={{
                  background: idx === 0 ? 'rgba(255,215,0,0.08)'
                            : idx === 1 ? 'rgba(192,192,192,0.07)'
                            : idx === 2 ? 'rgba(205,127,50,0.07)'
                            : 'transparent',
                }}>
                  {/* Rank */}
                  <td style={{ textAlign: 'center', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {idx < 3
                      ? ['🥇','🥈','🥉'][idx]
                      : <span style={{ color: 'var(--text-secondary)' }}>#{idx + 1}</span>
                    }
                  </td>

                  {/* Icono */}
                  <td style={{ textAlign: 'center' }}>
                    {item.icon ? (
                      <img
                        src={item.icon}
                        alt=""
                        style={{ width: '28px', height: '28px', objectFit: 'contain', imageRendering: 'pixelated' }}
                        onError={e => { e.target.style.display = 'none' }}
                      />
                    ) : (
                      <span style={{ fontSize: '1.1rem' }}>
                        {item.type === 'currency' ? '💰' : '✨'}                      </span>
                    )}
                  </td>

                  {/* Nombre */}
                  <td>
                    <div style={{ fontWeight: 500, color: TYPE_COLORS[item.type] ?? 'var(--text-primary)', lineHeight: 1.2 }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                      {item.gemLevel ? `Nv.${item.gemLevel}` : ''}
                      {item.gemQuality ? ` / Q${item.gemQuality}` : ''}
                      {item.links ? ` · ${item.links}L` : ''}
                      {item.corrupted ? ' · 💀 Corrompida' : ''}
                    </div>
                  </td>

                  {/* Divine */}
                  <td style={{ textAlign: 'right' }}>
                    <strong style={{ color: '#f0c060', fontSize: '0.95rem' }}>
                      {item.divineValue >= 1
                        ? item.divineValue.toFixed(item.divineValue >= 10 ? 0 : 1)
                        : item.divineValue.toFixed(2)}
                    </strong>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', marginLeft: '0.2rem' }}>div</span>
                  </td>

                  {/* Chaos */}
                  <td style={{ textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {item.chaosValue?.toLocaleString('es-ES', { maximumFractionDigits: 0 })}c
                  </td>

                  {/* Cambio 24h */}
                  <td style={{ textAlign: 'center' }}>
                    {changeBadge(item.change1d) ?? <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>—</span>}
                  </td>

                  {/* Listings */}
                  <td style={{ textAlign: 'right', fontSize: '0.82rem' }}>
                    <span style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      borderRadius: '4px', padding: '0.1rem 0.3rem',
                    }}>
                      {item.listingCount?.toLocaleString('es-ES')}
                    </span>
                  </td>

                  {/* Categoría */}
                  <td style={{ fontSize: '0.75rem', color: TYPE_COLORS[item.type] ?? 'var(--text-secondary)' }}>
                    {TYPE_LABELS[item.type] ?? item.type}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}