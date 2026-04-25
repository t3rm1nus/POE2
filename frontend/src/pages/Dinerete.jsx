import { useState, useEffect, useCallback } from 'react'
import { useLeague } from '../LeagueContext'

const API = 'http://localhost:3001'

const CURRENCY_SYMBOL = {
  divine:  '◈',
  chaos:   '⚡',
  exalted: '♦',
  aug:     '+',
}

function currencySymbol(c) {
  return CURRENCY_SYMBOL[c] ?? c
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', {
    day:    '2-digit',
    month:  '2-digit',
    year:   '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
  })
}

export default function Dinerete() {
  const { realm, league } = useLeague()

  const [sales,   setSales]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // ── Cargar ventas ──────────────────────────────────────────────────────────
  const loadSales = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/sales`)
      const data = await res.json()
      setSales(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSales()
    const handler = () => loadSales()
    window.addEventListener('dinerete:sale-added', handler)
    return () => window.removeEventListener('dinerete:sale-added', handler)
  }, [loadSales])

  // ── Borrar venta ───────────────────────────────────────────────────────────
  const deleteSale = async (id) => {
    try {
      await fetch(`${API}/api/sales/${id}`, { method: 'DELETE' })
      setSales(prev => prev.filter(s => s.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalDivine = sales
    .filter(s => s.currency === 'divine')
    .reduce((acc, s) => acc + s.price * s.quantity, 0)

  const totalChaos = sales
    .filter(s => s.currency === 'chaos')
    .reduce((acc, s) => acc + s.price * s.quantity, 0)

  const totalSold = sales.reduce((acc, s) => acc + s.quantity, 0)

  return (
    <div className="page-container">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">💰 Dinerete</h1>
          <p className="page-subtitle">
            Registro de ventas detectadas · {league} · {realm.toUpperCase()}
          </p>
        </div>
      </div>

      {/* ── Stats ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="stat-chip">
          <span className="stat-value">{sales.length}</span>
          <span className="stat-label">Ventas registradas</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value">{totalSold}</span>
          <span className="stat-label">Gemas vendidas</span>
        </div>
        {totalDivine > 0 && (
          <div className="stat-chip" style={{ borderColor: '#a78bfa40' }}>
            <span className="stat-value" style={{ color: '#a78bfa' }}>
              {totalDivine.toFixed(1)} ◈
            </span>
            <span className="stat-label">Divine ingresados</span>
          </div>
        )}
        {totalChaos > 0 && (
          <div className="stat-chip" style={{ borderColor: '#fb923c40' }}>
            <span className="stat-value" style={{ color: '#fb923c' }}>
              {totalChaos.toFixed(0)} ⚡
            </span>
            <span className="stat-label">Chaos ingresados</span>
          </div>
        )}
      </div>

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: '#f87171' }}>
          <p style={{ color: '#f87171', margin: 0, fontSize: 13 }}>⚠️ {error}</p>
        </div>
      )}

      {/* ── Tabla ───────────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="empty-state">
            <span className="spinner" style={{ fontSize: 24 }} />
            <p>Cargando ventas...</p>
          </div>
        ) : sales.length === 0 ? (
          <div className="empty-state">
            <span style={{ fontSize: 40 }}>💸</span>
            <p>Todavía no hay ventas detectadas.</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
              Las ventas se registran automáticamente cuando el Monitor detecta
              que un listing desaparece o su cantidad baja entre chequeos.
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Fecha</th>
                <th>Gema</th>
                <th style={{ width: 60, textAlign: 'center' }}>Cant.</th>
                <th style={{ width: 100 }}>Precio unit.</th>
                <th style={{ width: 110 }}>Total</th>
                <th style={{ width: 80 }}>Tipo</th>
                <th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {sales.map(sale => {
                const total = sale.price * sale.quantity
                const sym   = currencySymbol(sale.currency)
                return (
                  <tr key={sale.id}>

                    {/* Fecha */}
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {formatDate(sale.sold_at)}
                    </td>

                    {/* Nombre */}
                    <td style={{ fontWeight: 600 }}>
                      <span
                        title={sale.gem_type !== sale.gem_name ? `EN: ${sale.gem_type}` : undefined}
                        style={sale.gem_type !== sale.gem_name
                          ? { cursor: 'help', borderBottom: '1px dotted var(--text-secondary)' }
                          : undefined}
                      >
                        {sale.gem_name}
                      </span>
                    </td>

                    {/* Cantidad */}
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        display:      'inline-block',
                        background:   'var(--bg-elevated)',
                        border:       '1px solid var(--border)',
                        borderRadius: 4,
                        padding:      '1px 8px',
                        fontSize:     13,
                        fontWeight:   700,
                        color:        'var(--accent)',
                      }}>
                        x{sale.quantity}
                      </span>
                    </td>

                    {/* Precio unitario */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 600 }}>{sale.price}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 3 }}>
                        {sym} {sale.currency}
                      </span>
                    </td>

                    {/* Total */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{
                        color:      sale.currency === 'divine' ? '#a78bfa' : '#fb923c',
                        fontWeight: 700,
                        fontSize:   15,
                      }}>
                        {total % 1 === 0 ? total : total.toFixed(1)} {sym}
                      </span>
                    </td>

                    {/* Tipo */}
                    <td>
                      {sale.partial ? (
                        <span style={{
                          background:   'rgba(251,146,60,0.12)',
                          border:       '1px solid #fb923c50',
                          color:        '#fb923c',
                          borderRadius: 4,
                          padding:      '2px 7px',
                          fontSize:     11,
                          fontWeight:   600,
                        }}>
                          parcial
                        </span>
                      ) : (
                        <span style={{
                          background:   'rgba(74,222,128,0.1)',
                          border:       '1px solid #4ade8050',
                          color:        '#4ade80',
                          borderRadius: 4,
                          padding:      '2px 7px',
                          fontSize:     11,
                          fontWeight:   600,
                        }}>
                          total
                        </span>
                      )}
                    </td>

                    {/* Borrar */}
                    <td>
                      <button
                        className="btn btn--ghost btn--sm"
                        style={{ color: '#f87171' }}
                        onClick={() => deleteSale(sale.id)}
                        title="Borrar entrada (ya repusiste la gema)"
                      >
                        ✕
                      </button>
                    </td>

                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {sales.length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10, textAlign: 'right' }}>
          Pulsa ✕ en una entrada para eliminarla cuando hayas repuesto la gema.
        </p>
      )}
    </div>
  )
}