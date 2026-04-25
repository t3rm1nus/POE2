import { useState, useEffect, useRef, useCallback } from 'react'
import { useLeague } from '../LeagueContext'

const API = 'http://localhost:3001'

const INTERVALS = [
  { label: 'Cada 2 min',  value: 2  },
  { label: 'Cada 5 min',  value: 5  },
  { label: 'Cada 30 min', value: 30 },
  { label: 'Cada 60 min', value: 60 },
]

function StatusLight({ status }) {
  const map = {
    online:  { color: '#4ade80', shadow: '0 0 8px #4ade80', title: 'Online'  },
    offline: { color: '#6b7280', shadow: 'none',            title: 'Offline' },
    unknown: { color: '#facc15', shadow: '0 0 8px #facc1580', title: 'Desconocido' },
  }
  const s = map[status] ?? map.unknown
  return (
    <span
      title={s.title}
      style={{
        display:      'inline-block',
        width:        10,
        height:       10,
        borderRadius: '50%',
        background:   s.color,
        boxShadow:    s.shadow,
        flexShrink:   0,
      }}
    />
  )
}

export default function Chinofarmers({ onViewStocks }) {
  const { realm, league } = useLeague()

  const [users,     setUsers]     = useState([])
  const [input,     setInput]     = useState('')
  const [interval,  setInterval2] = useState(5)
  const [muted,     setMuted]     = useState(() => localStorage.getItem('cf_muted') === 'true')
  const [error,     setError]     = useState(null)
  const [polling,   setPolling]   = useState(false)

  const mutedRef = useRef(muted)
  const eventSrc = useRef(null)

  useEffect(() => {
    mutedRef.current = muted
    localStorage.setItem('cf_muted', muted)
  }, [muted])

  // ── Voz ──────────────────────────────────────────────────────────────────
  const speak = useCallback((text) => {
    if (mutedRef.current) return
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.lang  = 'es-ES'
    utt.rate  = 0.95
    window.speechSynthesis.speak(utt)
  }, [])

  // ── Conectar SSE ─────────────────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (eventSrc.current) eventSrc.current.close()

    const url = `${API}/api/chinofarmers/events?realm=${realm}&league=${encodeURIComponent(league)}`
    const es  = new EventSource(url)
    eventSrc.current = es

    es.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }

      switch (msg.type) {
        case 'init':
          setUsers(msg.users)
          break
        case 'user_added':
          setUsers(prev => [...prev, msg.user])
          break
        case 'user_deleted':
          setUsers(prev => prev.filter(u => u.id !== msg.id))
          break
        case 'user_updated':
          setUsers(prev => prev.map(u => u.id === msg.user.id ? msg.user : u))
          break
        case 'status_update':
          setUsers(prev => prev.map(u =>
            u.id === msg.id
              ? { ...u, is_online: msg.is_online, last_checked: msg.last_checked, last_seen: msg.last_seen }
              : u
          ))
          break
        case 'went_offline':
          speak(`el chinofarmer ${msg.username} se acaba de desconectar`)
          break
        case 'poll_start':
          setPolling(true)
          break
        case 'poll_done':
          setPolling(false)
          break
        default: break
      }
    }

    es.onerror = () => {}
  }, [realm, league, speak])

  useEffect(() => {
    connectSSE()
    return () => eventSrc.current?.close()
  }, [connectSSE])

  // ── Sincronizar intervalo + realm/league al backend ───────────────────────
  useEffect(() => {
    fetch(`${API}/api/chinofarmers/interval`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ minutes: interval, realm, league }),
    }).catch(() => {})
  }, [interval, realm, league])

  // ── Añadir usuario ────────────────────────────────────────────────────────
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

  // ── Toggle activo ─────────────────────────────────────────────────────────
  const toggleActive = async (user) => {
    await fetch(`${API}/api/chinofarmers/${user.id}/active`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ active: !user.active }),
    })
  }

  // ── Eliminar ──────────────────────────────────────────────────────────────
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
          {/* Mute */}
          <button
            className={`btn btn--sm ${muted ? 'btn--danger' : 'btn--secondary'}`}
            onClick={() => setMuted(m => !m)}
            title={muted ? 'Sonido silenciado — clic para activar' : 'Sonido activo — clic para silenciar'}
          >
            {muted ? '🔇 Silenciado' : '🔊 Sonido'}
          </button>

          {/* Intervalo */}
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
                    {user.last_seen
                      ? new Date(user.last_seen).toLocaleString('es-ES')
                      : '—'}
                  </td>
                  <td style={{ fontSize: 12, color: '#9ca3af' }}>
                    {user.last_checked
                      ? new Date(user.last_checked).toLocaleString('es-ES')
                      : '—'}
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
                  {/* ── Botón Escanear Stock ── */}
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{
                        color:      'var(--accent)',
                        border:     '1px solid var(--accent)',
                        opacity:    0.85,
                        transition: 'opacity 0.15s',
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