import { useState, useEffect, useRef, useCallback } from 'react'
import GEM_TRANSLATIONS from '../gemTranslations'

const CURRENCIES = ['chaos', 'divine', 'exalted', 'aug']
const POLL_OPTIONS = [
  { label: 'Desactivado', value: 0 },
  { label: '5 min', value: 5 * 60 },
  { label: '10 min', value: 10 * 60 },
  { label: '30 min', value: 30 * 60 },
]

// ─── Síntesis de voz ────────────────────────────────────────────────────────
let _lastSpokenText = ''

function hablar(texto) {
  if (!window.speechSynthesis) return
  _lastSpokenText = texto
  window.speechSynthesis.cancel()
  const msg = new SpeechSynthesisUtterance(texto)
  msg.lang = 'es-ES'
  msg.rate = 1.1
  msg.volume = 1
  const voces = window.speechSynthesis.getVoices()
  const vozEs = voces.find(v => v.lang.startsWith('es') && v.localService)
    || voces.find(v => v.lang.startsWith('es'))
  if (vozEs) msg.voice = vozEs
  window.speechSynthesis.speak(msg)
}

function repetirUltimoAviso() {
  if (_lastSpokenText) hablar(_lastSpokenText)
}

// ─── Formato de cuenta atrás ────────────────────────────────────────────────
function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function Monitor() {
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(null)
  const [checkProgress, setCheckProgress] = useState(null)
  const [items, setItems] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', type: '', my_price: '', currency: 'chaos', category: 'item' })
  const [sortBy, setSortBy] = useState('price_desc')

  // Polling
  const [pollInterval, setPollInterval] = useState(() => {
    const saved = localStorage.getItem('poe2_poll_interval')
    return saved !== null ? parseInt(saved) : 0
  })
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef(null)
  const pollTimeoutRef = useRef(null)
  const isAutoCheckRef = useRef(false)

  // Sonido
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('poe2_sound_enabled')
    return saved !== null ? saved === 'true' : true
  })

  // Toasts
  const [toasts, setToasts] = useState([])
  const toastIdRef = useRef(0)

  // ─── Toast helpers ──────────────────────────────────────────────────────────
  function addToast(message, type = 'warn') {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }

  // ─── Persistencia ───────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('poe2_poll_interval', String(pollInterval))
  }, [pollInterval])

  useEffect(() => {
    localStorage.setItem('poe2_sound_enabled', String(soundEnabled))
  }, [soundEnabled])

  // ─── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadItems()
  }, [])

  async function loadItems() {
    const res = await fetch('/api/monitor/items')
    const data = await res.json()
    setItems(data)
  }

  // ─── Nombre traducido ────────────────────────────────────────────────────────
  function getDisplayName(item) {
    let query
    try {
      query = typeof item.query === 'string' ? JSON.parse(item.query) : item.query
    } catch {
      query = null
    }
    const type = query?.query?.type
    const translated = (type && GEM_TRANSLATIONS[type]) || GEM_TRANSLATIONS[item.name] || null
    return {
      display: translated || item.name,
      original: translated && translated !== item.name ? item.name : null,
    }
  }

  // ─── Lógica de sonido/avisos tras comprobar ──────────────────────────────────
  function procesarResultados(resultados, esAutomatico) {
    if (!esAutomatico || !soundEnabled) return

    const superados = resultados.filter(r => !r.error && !r.isMinPrice)
    const empates   = resultados.filter(r => !r.error && r.isMinPrice && r.tied)

    if (superados.length > 0) {
      const nombres = superados.map(r => {
        const item = items.find(i => i.name === r.item)
        return item ? getDisplayName(item).display : r.item
      })
      hablar(
        `Atención. ${superados.length === 1 ? 'Un ítem' : `${superados.length} ítems`} con precio superado: ${nombres.join(', ')}`
      )
      superados.forEach(r => {
        const item = items.find(i => i.name === r.item)
        const nombre = item ? getDisplayName(item).display : r.item
        addToast(`⚠️ ${nombre} — hay ofertas a ${r.marketMin} ${r.marketCurrency}`, 'warn')
      })
    } else if (empates.length > 0) {
      hablar('Empate de precio detectado.')
      empates.forEach(r => {
        const item = items.find(i => i.name === r.item)
        const nombre = item ? getDisplayName(item).display : r.item
        addToast(`⚡ ${nombre} — empate a ${r.marketMin} ${r.marketCurrency}`, 'info')
      })
    }
  }

  // ─── checkPrices ────────────────────────────────────────────────────────────
  const checkPrices = useCallback((esAutomatico = false) => {
    if (loading) return
    setLoading(true)
    setResults([])
    setCheckProgress({ message: 'Iniciando...', progress: 0, total: 0 })
    isAutoCheckRef.current = esAutomatico

    const evtSource = new EventSource('/api/monitor/check')

    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data)

      if (data.status === 'checking') {
        setCheckProgress(data)
      }

      if (data.status === 'done') {
        evtSource.close()
        setResults(data.results)
        setLoading(false)
        setCheckProgress(null)
        procesarResultados(data.results, esAutomatico)
      }

      if (data.error) {
        evtSource.close()
        setLoading(false)
        setCheckProgress({ message: `Error: ${data.error}` })
      }
    }

    evtSource.onerror = () => {
      evtSource.close()
      setLoading(false)
      setCheckProgress({ message: 'Error de conexión' })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, soundEnabled, items])

  // ─── Polling + cuenta atrás ──────────────────────────────────────────────────
  useEffect(() => {
    // Limpiar timers anteriores
    clearInterval(countdownRef.current)
    clearTimeout(pollTimeoutRef.current)
    setCountdown(0)

    if (pollInterval === 0) return

    let remaining = pollInterval

    function tick() {
      remaining -= 1
      setCountdown(remaining)

      if (remaining <= 0) {
        remaining = pollInterval
        // No lanzar si ya hay una comprobación en curso
        if (!loading) {
          checkPrices(true)
        }
      }
    }

    setCountdown(remaining)
    countdownRef.current = setInterval(tick, 1000)

    return () => clearInterval(countdownRef.current)
  // Solo relanzar cuando cambia el intervalo configurado
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollInterval])

  // Pausar la cuenta atrás mientras se comprueba manualmente
  useEffect(() => {
    if (loading && !isAutoCheckRef.current) {
      clearInterval(countdownRef.current)
    }
  }, [loading])

  // ─── Importar listings ───────────────────────────────────────────────────────
  async function importListings() {
    setImporting(true)
    setImportProgress({ message: 'Conectando...' })

    const evtSource = new EventSource('/api/import/listings')

    evtSource.onmessage = async (e) => {
      const data = JSON.parse(e.data)

      if (data.status === 'fetching' || data.status === 'found' || data.status === 'searching') {
        setImportProgress(data)
      }

      if (data.status === 'done') {
        evtSource.close()
        await loadItems()
        setImporting(false)
        setImportProgress(null)
      }

      if (data.error) {
        evtSource.close()
        setImporting(false)
        setImportProgress({ message: `Error: ${data.error}` })
      }
    }

    evtSource.onerror = () => {
      evtSource.close()
      setImporting(false)
      setImportProgress({ message: 'Error de conexión' })
    }
  }

  // ─── Añadir ítem manual ──────────────────────────────────────────────────────
  async function addItem(e) {
    e.preventDefault()
    if (!form.name || !form.type || !form.my_price) return

    let query
    if (form.category === 'gem') {
      query = {
        query: {
          type: form.type,
          stats: [{ type: 'and', filters: [], disabled: true }],
          status: { option: 'any' },
          filters: {
            misc_filters: {
              filters: { gem_level: { min: 21 }, gem_sockets: { min: 5 } },
              disabled: false
            }
          }
        },
        sort: { price: 'asc' }
      }
    } else {
      query = { query: { filters: {}, type: form.type }, sort: { price: 'asc' } }
    }

    await fetch('/api/monitor/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, query, my_price: parseFloat(form.my_price), currency: form.currency })
    })
    setForm({ name: '', type: '', my_price: '', currency: 'chaos', category: 'item' })
    loadItems()
  }

  async function deleteItem(id) {
    await fetch(`/api/monitor/items/${id}`, { method: 'DELETE' })
    loadItems()
  }

  async function clearAllItems() {
    if (!confirm('¿Borrar todos los ítems de la lista?')) return
    await Promise.all(items.map(item => fetch(`/api/monitor/items/${item.id}`, { method: 'DELETE' })))
    setItems([])
    setResults([])
  }

  // ─── Sorted items ────────────────────────────────────────────────────────────
  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === 'price_desc') return b.my_price - a.my_price
    if (sortBy === 'price_asc') return a.my_price - b.my_price
    if (sortBy === 'name') {
      return getDisplayName(a).display.localeCompare(getDisplayName(b).display)
    }
    return 0
  })

  // ─── Sub-componentes ─────────────────────────────────────────────────────────
  const ProgressBar = ({ progress, total, message }) => (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{message}</span>
        {total > 0 && (
          <>
            <div style={{ flex: 1, background: 'var(--bg-elevated)', borderRadius: '4px', height: '6px' }}>
              <div style={{
                width: `${(progress / total) * 100}%`,
                background: 'var(--accent)',
                height: '100%',
                borderRadius: '4px',
                transition: 'width 0.3s ease'
              }} />
            </div>
            <span style={{ color: 'var(--accent)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
              {progress}/{total}
            </span>
          </>
        )}
      </div>
    </div>
  )

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="monitor">

      {/* ── Toasts ── */}
      <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === 'warn' ? 'var(--status-warn-bg, #3a2800)' : 'var(--bg-elevated)',
            border: `1px solid ${t.type === 'warn' ? '#f59e0b' : 'var(--border)'}`,
            color: 'var(--text-primary)',
            padding: '0.65rem 1rem',
            borderRadius: '6px',
            fontSize: '0.85rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            animation: 'fadeIn 0.2s ease',
            maxWidth: '320px'
          }}>
            {t.message}
          </div>
        ))}
      </div>

      {/* ── Cabecera ── */}
      <div className="page-header">
        <h1 className="page-heading">🔔 Monitor de Precio</h1>

        {/* Polling selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            Auto-check:
          </label>
          <select
            className="input input--short"
            value={pollInterval}
            onChange={e => setPollInterval(parseInt(e.target.value))}
          >
            {POLL_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Cuenta atrás */}
        {pollInterval > 0 && (
          <span style={{
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
            minWidth: '120px'
          }}>
            {loading && isAutoCheckRef.current
              ? '⏳ Comprobando...'
              : `⏱ Próxima: ${formatCountdown(countdown)}`}
          </span>
        )}

        {/* Sonido toggle */}
        <button
          className={`btn ${soundEnabled ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setSoundEnabled(s => !s)}
          title={soundEnabled ? 'Avisos sonoros activados' : 'Avisos sonoros desactivados'}
          style={{ minWidth: '2.5rem' }}
        >
          {soundEnabled ? '🔔' : '🔕'}
        </button>

        {/* Repetir último aviso */}
        <button
          className="btn btn--secondary"
          onClick={repetirUltimoAviso}
          title="Repetir último aviso sonoro"
          style={{ minWidth: '2.5rem' }}
        >
          🔁
        </button>

        <button className="btn btn--primary" onClick={() => checkPrices(false)} disabled={loading || items.length === 0}>
          {loading && !isAutoCheckRef.current ? 'Comprobando...' : 'Comprobar ahora'}
        </button>
        <button className="btn btn--primary" onClick={importListings} disabled={importing}>
          {importing ? '⏳ Importando...' : '📥 Importar mis listings'}
        </button>
        <button className="btn btn--danger" onClick={clearAllItems} disabled={items.length === 0}>
          🗑️ Borrar lista
        </button>
      </div>

      {checkProgress && (
        <ProgressBar progress={checkProgress.progress} total={checkProgress.total} message={checkProgress.message} />
      )}

      {importProgress && (
        <ProgressBar progress={importProgress.progress} total={importProgress.total_chunks} message={importProgress.message} />
      )}

      {/* ── Formulario añadir ── */}
      <div className="card">
        <div className="card-title">Añadir ítem a vigilar</div>
        <form className="add-form" onSubmit={addItem}>
          <select className="input input--short" value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            <option value="item">Ítem</option>
            <option value="gem">Gema</option>
          </select>
          <input className="input" placeholder="Nombre (ej: Chaos Orb)"
            value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input className="input" placeholder="Type exacto de la API (ej: Chaos Orb)"
            value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} />
          <input className="input input--short" type="number" placeholder="Mi precio"
            value={form.my_price} onChange={e => setForm(f => ({ ...f, my_price: e.target.value }))} />
          <select className="input input--short" value={form.currency}
            onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <button className="btn btn--primary" type="submit">Añadir</button>
        </form>
      </div>

      {/* ── Tabla ── */}
      {items.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Mi lista de venta</span>
            <select className="input input--short" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="price_desc">💰 Mayor precio</option>
              <option value="price_asc">💰 Menor precio</option>
              <option value="name">🔤 Nombre</option>
            </select>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Ítem</th><th>Mi precio</th><th>Divisa</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map(item => {
                const result = results.find(r => r.item === item.name)
                const { display, original } = getDisplayName(item)
                return (
                  <tr key={item.id}>
                    <td>
                      <span
                        title={original ? `Nombre original: ${original}` : undefined}
                        style={original ? { cursor: 'help', borderBottom: '1px dotted var(--text-secondary)' } : undefined}
                      >
                        {display}
                      </span>
                    </td>
                    <td>{item.my_price}</td>
                    <td><span className="badge">{item.currency}</span></td>
                    <td>
                      {result ? (
                        result.isMinPrice
                          ? result.tied
                            ? <span className="status status--warn">⚡ Empate — otro al mismo precio ({result.marketMin} {result.marketCurrency})</span>
                            : result.cheaperOwnExists
                              ? <span className="status status--warn">🔵 Tienes otro listing más barato ({result.myActiveMin} {result.myCurrency})</span>
                              : <span className="status status--ok">✅ Eres el más barato</span>
                          : <span className="status status--warn">⚠️ Hay ofertas más baratas ({result.marketMin} {result.marketCurrency})</span>
                      ) : <span className="status status--idle">— Sin comprobar</span>}
                    </td>
                    <td>
                      <button className="btn btn--danger btn--sm" onClick={() => deleteItem(item.id)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {items.length === 0 && (
        <div className="empty-state">Añade ítems para empezar a monitorizar</div>
      )}
    </div>
  )
}