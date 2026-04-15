import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import GEM_TRANSLATIONS from '../gemTranslations'
import { useMonitor } from '../MonitorContext'

const CURRENCIES = ['chaos', 'divine', 'exalted', 'aug']
const POLL_OPTIONS = [
  { label: 'Desactivado', value: 0 },
  { label: '5 min', value: 5 * 60 },
  { label: '10 min', value: 10 * 60 },
  { label: '30 min', value: 30 * 60 },
]

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
  const vozEs = voces.find(v => v.lang.startsWith('es') && v.localService) || voces.find(v => v.lang.startsWith('es'))
  if (vozEs) msg.voice = vozEs
  window.speechSynthesis.speak(msg)
}

function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
function repetirUltimoAviso() {
  if (_lastSpokenText) hablar(_lastSpokenText)
}
export default function Monitor({ league = 'Standard' }) {
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(null)
  
  const [form, setForm] = useState({ name: '', type: '', my_price: '', currency: 'chaos', category: 'item' })
  const [sortBy, setSortBy] = useState('price_desc')
  const {
    items, setItems,
    results, setResults,
    loading, setLoading,
    checkProgress, setCheckProgress,
    pollInterval, setPollInterval,
    countdown,
    soundEnabled, setSoundEnabled,
    toasts,
    addToast,
    checkPrices,
    loadItems,
    isAutoCheckRef
  } = useMonitor()

  


  function getDisplayName(item) {
    let query
    try { query = typeof item.query === 'string' ? JSON.parse(item.query) : item.query } catch { query = null }
    const type = query?.query?.type
    const translated = (type && GEM_TRANSLATIONS[type]) || GEM_TRANSLATIONS[item.name] || null
    return {
      display: translated || item.name,
      original: translated && translated !== item.name ? item.name : null,
    }
  }

  async function addItem(e) {
    e.preventDefault()
    if (!form.name || !form.type || !form.my_price) {
      addToast('Completa todos los campos', 'error')
      return
    }

    const query = {
      query: {
        type: form.type,
        stats: [{ type: 'and', filters: [], disabled: true }],
        status: { option: 'any' },
        filters: {}
      },
      sort: { price: 'asc' }
    }

    if (form.category === 'gem') {
      query.query.filters = {
        misc_filters: { filters: { gem_level: { min: 21 }, gem_sockets: { min: 5 } }, disabled: false },
        trade_filters: { filters: { price: { option: form.currency } } }
      }
    }

    const res = await fetch('/api/monitor/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        category: form.category,
        query,
        my_price: parseFloat(form.my_price),
        currency: form.currency
      })
    })

    if (res.ok) {
      setForm({ name: '', type: '', my_price: '', currency: 'chaos', category: 'item' })
      loadItems()
      addToast('Ítem agregado correctamente', 'success')
    }
  }

  async function deleteItem(id) {
    await fetch(`/api/monitor/items/${id}`, { method: 'DELETE' })
    loadItems()
    addToast('Ítem eliminado', 'info')
  }

  async function clearAllItems() {
    if (confirm('¿Eliminar todos los ítems?')) {
      for (const item of items) {
        await fetch(`/api/monitor/items/${item.id}`, { method: 'DELETE' })
      }
      loadItems()
      addToast('Todos los ítems eliminados', 'info')
    }
  }

  async function importListings() {
    setImporting(true)
    setImportProgress({ message: 'Conectando...', progress: 0, total_chunks: 0 })

    const evtSource = new EventSource(`/api/import/listings?league=${league}`)

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
        addToast('Importación completada', 'success')
      }
      if (data.error) {
        evtSource.close()
        setImporting(false)
        setImportProgress({ message: `Error: ${data.error}` })
        addToast(`Error: ${data.error}`, 'error')
      }
    }
    evtSource.onerror = () => {
      evtSource.close()
      setImporting(false)
      setImportProgress({ message: 'Error de conexión' })
      addToast('Error de conexión con el servidor', 'error')
    }
  }



  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === 'price_desc') return b.my_price - a.my_price
    if (sortBy === 'price_asc') return a.my_price - b.my_price
    if (sortBy === 'name') return getDisplayName(a).display.localeCompare(getDisplayName(b).display)
    return 0
  })

  const groupedItems = useMemo(() => {
    const map = new Map()
    for (const item of sortedItems) {
      if (!map.has(item.name)) map.set(item.name, [])
      map.get(item.name).push(item)
    }
    for (const group of map.values()) group.sort((a, b) => b.my_price - a.my_price)
    return Array.from(map.values())
  }, [sortedItems])

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

  function renderStatus(group) {
    const result = results.find(r => r.item === group[0].name && r.myPrice === group[0].my_price)
      ?? results.find(r => r.item === group[0].name)
      ?? null
    if (!result) return <span className="status status--idle">— Sin comprobar</span>
    if (result.error) return <span className="status status--idle">— Error</span>
    if (result.isMinPrice) {
      if (result.tied)
        return <span className="status status--warn">⚡ Empate — otro al mismo precio ({result.marketMin} {result.marketCurrency})</span>
      if (result.cheaperOwnExists)
        return <span className="status status--warn">🔵 Tienes otro listing más barato ({result.myActiveMin} {result.myCurrency})</span>
      return <span className="status status--ok">✅ Eres el más barato</span>
    }
    return <span className="status status--warn">⚠️ Hay ofertas más baratas ({result.marketMin} {result.marketCurrency})</span>
  }

  return (
    <div className="monitor">
      {/* Toasts */}
      <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === 'warn' ? 'var(--status-warn-bg, #3a2800)' : 'var(--bg-elevated)',
            border: `1px solid ${t.type === 'warn' ? '#f59e0b' : 'var(--border)'}`,
            color: 'var(--text-primary)', padding: '0.65rem 1rem', borderRadius: '6px',
            fontSize: '0.85rem', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', maxWidth: '320px'
          }}>
            {t.message}
          </div>
        ))}
      </div>

      {/* Cabecera */}
      {/* Cabecera */}
      <div className="page-header">
        <h1 className="page-heading">🔔 Monitor de Precio</h1>

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

        <button
          className={`btn ${soundEnabled ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setSoundEnabled(s => !s)}
          title={soundEnabled ? 'Avisos sonoros activados' : 'Avisos sonoros desactivados'}
          style={{ minWidth: '2.5rem' }}
        >
          {soundEnabled ? '🔔' : '🔕'}
        </button>

        <button
          className="btn btn--secondary"
          onClick={repetirUltimoAviso}
          title="Repetir último aviso sonoro"
          style={{ minWidth: '2.5rem' }}
        >
          🔁
        </button>

        <button
          className="btn btn--primary"
          onClick={() => checkPrices(false)}
          disabled={loading || items.length === 0}
        >
          {loading && !isAutoCheckRef.current ? 'Comprobando...' : 'Comprobar ahora'}
        </button>

        <button
          className="btn btn--primary"
          onClick={importListings}
          disabled={importing}
        >
          {importing ? '⏳ Importando...' : '📥 Importar mis listings'}
        </button>

        <button
          className="btn btn--danger"
          onClick={clearAllItems}
          disabled={items.length === 0}
        >
          🗑️ Borrar lista
        </button>
      </div>

      {/* Barras de progreso */}
      {checkProgress && <ProgressBar {...checkProgress} />}
      {importProgress && (
        <ProgressBar 
          progress={importProgress.progress} 
          total={importProgress.total_chunks} 
          message={importProgress.message} 
        />
      )}

     

      

      {/* Tabla de ítems */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3>📋 Mi Lista de Venta ({items.length} ítems)</h3>
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value)} 
            className="input input--short"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              padding: '0.35rem 2rem 0.35rem 0.75rem',
              fontSize: '0.85rem',
              cursor: 'pointer',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.5rem center',
            }}
          >
            <option value="price_desc">💰 Mayor precio</option>
            <option value="price_asc">💰 Menor precio</option>
            <option value="name">🔤 Nombre</option>
          </select>
        </div>

        {groupedItems.length === 0 ? (
          <p className="empty-state">No hay ítems. Importa tus listings o agrega manualmente.</p>
        ) : (
          <div className="items-table">
            <table style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '44%' }} />
              </colgroup>
              <thead>
              <tr>
                <th style={{ whiteSpace: 'nowrap', textAlign: 'left' }}>Ítem</th>
                <th style={{ whiteSpace: 'nowrap', textAlign: 'left' }}>Mis precios</th>
                <th style={{ whiteSpace: 'nowrap', textAlign: 'left' }}>Divisa</th>
                <th style={{ whiteSpace: 'nowrap', textAlign: 'left' }}>Estado</th>
              </tr>
              </thead>
              <tbody>
                {groupedItems.map(group => {
                  const representative = group[0]
                  const { display, original } = getDisplayName(representative)
                  return (
                    <tr key={representative.name}>
                      <td>
                        <span
                          title={original ? `Nombre original: ${original}` : undefined}
                          style={original ? { cursor: 'help', borderBottom: '1px dotted var(--text-secondary)' } : undefined}
                        >
                          {display}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                          {group.map((item, idx) => {
                            const isMin = idx === group.length - 1 && group.length > 1
                            return (
                              <span key={item.id} style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                                background: 'var(--bg-elevated)',
                                border: `1px solid ${isMin ? 'var(--accent)' : 'var(--border)'}`,
                                borderRadius: '4px', padding: '0.1rem 0.35rem', fontSize: '0.85rem',
                                color: isMin ? 'var(--accent)' : 'inherit',
                              }}>
                                {item.my_price}
                                <button className="btn btn--danger btn--sm"
                                  onClick={() => deleteItem(item.id)}
                                  style={{ padding: '0 0.2rem', minWidth: 'unset', fontSize: '0.7rem', lineHeight: 1 }}>
                                  ✕
                                </button>
                              </span>
                            )
                          })}
                        </div>
                      </td>
                      <td><span className="badge">{representative.currency}</span></td>
                      <td>{renderStatus(group)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}