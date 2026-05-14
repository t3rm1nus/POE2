import { useState, useEffect } from 'react'
import { useLeague } from '../LeagueContext'
import { useChinofarmers } from '../ChinofarmersContext.jsx'

const API = 'http://localhost:3001'

const INTERVALS = [
  { label: 'Cada 2 min',  value: 2  },
  { label: 'Cada 5 min',  value: 5  },
  { label: 'Cada 30 min', value: 30 },
  { label: 'Cada 60 min', value: 60 },
]

function StatusLight({ status }) {
  const map = {
    online:  { color: '#4ade80', shadow: '0 0 8px #4ade80',   title: 'Online'      },
    offline: { color: '#6b7280', shadow: 'none',              title: 'Offline'     },
    unknown: { color: '#facc15', shadow: '0 0 8px #facc1580', title: 'Desconocido' },
  }
  const s = map[status] ?? map.unknown
  return (
    <span
      title={s.title}
      style={{
        display: 'inline-block', width: 10, height: 10,
        borderRadius: '50%', background: s.color, boxShadow: s.shadow, flexShrink: 0,
      }}
    />
  )
}

export default function Chinofarmers({ onViewStocks }) {
  const { realm, league } = useLeague()
  const { users, polling, muted, setMuted } = useChinofarmers()

  const [input,    setInput]     = useState('')
  const [interval, setInterval2] = useState(5)
  const [error,    setError]     = useState(null)

  // Sincronizar intervalo + realm/league al backend
  useEffect(() => {
    fetch(`${API}/api/chinofarmers/interval`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ minutes: interval, realm, league }),
    }).catch(() => {})
  }, [interval, realm, league])

  const addUser = async () => {
    const username = input.trim()
    if (!username) return
    setError(null)
    try {
      const res  = await fetch(`${API}/api/chinofarmers`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Error al añadir'); return }
      setInput('')
    } catch (e) {
      setError(e.message)
    }
  }

  const toggleActive = async (user) => {
    await fetch(`${API}/api/chinofarmers/${user.id}/active`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ active: !user.active }),
    })
  }

  const deleteUser = async (id) => {
    await fetch(`${API}/api/chinofarmers/${id}`, { method: 'DELETE' })
  }

  const onlineCount = users.filter(u => u.active && u.is_online === 'online').length
  const activeCount = users.filter(u => u.active).length

  return (
    <div className="page-container">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">ChInOfArMeRs</h1>
          <p className="page-subtitle">
            Monitoriza si los vendedores están online en {league} · {realm.toUpperCase()}
          </p>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className={`btn btn--sm ${muted ? 'btn--danger' : 'btn--secondary'}`}
            onClick={() => setMuted(m => !m)}
            title={muted ? 'Sonido silenciado — clic para activar' : 'Sonido activo — clic para silenciar'}
          >
            {muted ? '🔇 Silenciado' : '🔊 Sonido'}
          </button>

          <select
            className="input input--short"
            value={interval}
            onChange={e => setInterval2(Number(e.target.value))}
          >
            {INTERVALS.map(i => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>

          {polling && (
            <span style={{ fontSize: 12, color: '#facc15', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="spinner" /> Comprobando...
            </span>
          )}
        </div>
      </div>

      {/* ── Stats rápidas ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="stat-chip">
          <span className="stat-value">{users.length}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value">{activeCount}</span>
          <span className="stat-label">Activos</span>
        </div>
        <div className="stat-chip" style={{ borderColor: '#4ade8040' }}>
          <span className="stat-value" style={{ color: '#4ade80' }}>{onlineCount}</span>
          <span className="stat-label">Online ahora</span>
        </div>
      </div>

      {/* ── Añadir usuario ────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ marginBottom: 12 }}>Añadir chinofarmer</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Nombre de cuenta PoE2..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addUser()}
          />
          <button className="btn btn--primary" onClick={addUser}>
            + Añadir
          </button>
        </div>
        {error && (
          <p style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>{error}</p>
        )}
      </div>

      {/* ── Tabla de usuarios ─────────────────────────────────────────── */}
      <div className="card">
        {users.length === 0 ? (
          <div className="empty-state">
            <span style={{ fontSize: 40 }}>🥷</span>
            <p>No hay chinofarmers monitorizados todavía.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>Estado</th>
                <th>Usuario</th>
                <th>Última vez visto</th>
                <th>Comprobado</th>
                <th style={{ width: 90, textAlign: 'center' }}>Activo</th>
                <th style={{ width: 90, textAlign: 'center' }}>Stock</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} style={{ opacity: user.active ? 1 : 0.45 }}>
                  <td>
                    <StatusLight status={user.active ? (user.is_online ?? 'unknown') : 'offline'} />
                  </td>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>
                    {user.username}
                  </td>
                  <td style={{ fontSize: 12, color: '#9ca3af' }}>
                    {user.last_seen ? new Date(user.last_seen).toLocaleString('es-ES') : '—'}
                  </td>
                  <td style={{ fontSize: 12, color: '#9ca3af' }}>
                    {user.last_checked ? new Date(user.last_checked).toLocaleString('es-ES') : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={!!user.active}
                        onChange={() => toggleActive(user)}
                      />
                      <span className="switch-thumb" />
                    </label>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{
                        color: 'var(--accent)', border: '1px solid var(--accent)',
                        opacity: 0.85, transition: 'opacity 0.15s',
                      }}
                      title={`Ver stock de gemas de ${user.username}`}
                      onClick={() => onViewStocks?.(user)}
                    >
                      📦 Stock
                    </button>
                  </td>
                  <td>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{ color: '#f87171' }}
                      onClick={() => deleteUser(user.id)}
                      title="Eliminar"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}