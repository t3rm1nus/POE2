import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import GEM_TRANSLATIONS from '../gemTranslations'
import { useMonitor } from '../MonitorContext'
import { useLeague } from '../LeagueContext'
import { POLL_OPTIONS, formatCountdown, repetirUltimoAviso } from '../monitorUtils'

const CURRENCIES = ['chaos', 'divine', 'exalted', 'aug']


export default function Monitor() {
  const { realm, league } = useLeague()
  const [importing, setImporting]           = useState(false)
  const [importProgress, setImportProgress] = useState(null)
  const [form, setForm] = useState({ name: '', type: '', my_price: '', currency: 'chaos', category: 'item' })
  const [sortBy, setSortBy] = useState('price_desc')

  const {
    items, results, loading,
    checkProgress, setCheckProgress,
    pollInterval, setPollInterval,
    countdown,
    soundEnabled, setSoundEnabled,
    toasts, addToast,
    checkPrices, loadItems,
    isAutoCheckRef,
    autoCheckFnRef,
  } = useMonitor()

  function getDisplayName(item) {
    let query
    try { query = typeof item.query === 'string' ? JSON.parse(item.query) : item.query } catch { query = null }
    const type = query?.query?.type
    const translated = (type && GEM_TRANSLATIONS[type]) || GEM_TRANSLATIONS[item.name] || null
    return {
      display:  translated || item.name,
      original: translated && translated !== item.name ? item.name : null,
    }
  }

  function getResult(item) {
    return results.find(r => r.item === item.name && r.myPrice === item.my_price)
        ?? results.find(r => r.item === item.name)
        ?? null
  }

  function renderStatus(item) {
    const r = getResult(item)
    if (!r)      return <span className="status status--idle">— Sin comprobar</span>
    if (r.error) return <span className="status status--idle">— Error</span>

    if (r.cheaperOwnExists)
      return <span className="status status--warn">🔵 Tienes otro más barato ({r.myActiveMin} {r.myCurrency})</span>

    if (r.isMinPrice) {
      if (r.tied)
        return <span className="status status--warn">⚡ Empate ({r.marketMin} {r.marketCurrency})</span>
      return <span className="status status--ok">✅ Eres el más barato</span>
    }

    return <span className="status status--warn">⚠️ Hay más baratos ({r.marketMin} {r.marketCurrency})</span>
  }

  function renderMercado(item) {
    const r = getResult(item)
    if (!r || r.marketMin === null) return <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>—</span>
    return (
      <span style={{ fontSize: '0.85rem' }}>
        <strong style={{ color: 'var(--accent)' }}>{r.marketMin}</strong>
        <span style={{ color: 'var(--text-secondary)', marginLeft: '0.2rem', fontSize: '0.75rem' }}>
          {r.marketCurrency}
        </span>
        {r.marketTotal > 0 && (
          <span style={{ color: 'var(--text-secondary)', marginLeft: '0.4rem', fontSize: '0.72rem' }}>
            ({r.marketTotal})
          </span>
        )}
      </span>
    )
  }

  // ─── Sonido (usa procesarResultados del contexto, aquí solo notificamos toasts extra) ──
  function procesarResultados(resultados, esAutomatico) {
    if (!esAutomatico || !soundEnabled) return
    const porNombre = new Map()
    for (const r of resultados) {
      if (r.error) continue
      const ex = porNombre.get(r.item)
      if (!ex || r.myPrice < ex.myPrice) porNombre.set(r.item, r)
    }
    const representativos = Array.from(porNombre.values())
    const superados = representativos.filter(r => !r.isMinPrice)
    const empates   = representativos.filter(r => r.isMinPrice && r.tied)
    if (superados.length > 0) {
      superados.forEach(r => {
        const it = items.find(i => i.name === r.item)
        addToast(`⚠️ ${it ? getDisplayName(it).display : r.item} — hay ofertas a ${r.marketMin} ${r.marketCurrency}`, 'warn')
      })
    } else if (empates.length > 0) {
      empates.forEach(r => {
        const it = items.find(i => i.name === r.item)
        addToast(`⚡ ${it ? getDisplayName(it).display : r.item} — empate a ${r.marketMin} ${r.marketCurrency}`, 'info')
      })
    }
  }

  // ─── Importar listings ───────────────────────────────────────────────────────
  function importListings() {
    return new Promise((resolve, reject) => {
      setImporting(true)
      setImportProgress({ message: 'Conectando...', progress: 0, total_chunks: 0 })
      const evtSource = new EventSource(
        `/api/import/listings?realm=${realm}&league=${encodeURIComponent(league)}`
      )
      evtSource.onmessage = async (e) => {
        const data = JSON.parse(e.data)
        if (data.status === 'fetching' || data.status === 'found' || data.status === 'searching') {
          setImportProgress(data)
        }
        if (data.status === 'done') {
          evtSource.close(); await loadItems()
          setImporting(false); setImportProgress(null)
          addToast('Importación completada', 'success')
          resolve()
        }
        if (data.error) {
          evtSource.close(); setImporting(false)
          setImportProgress({ message: `Error: ${data.error}` })
          addToast(`Error: ${data.error}`, 'error')
          reject(new Error(data.error))
        }
      }
      evtSource.onerror = () => {
        evtSource.close(); setImporting(false)
        setImportProgress({ message: 'Error de conexión' })
        addToast('Error de conexión con el servidor', 'error')
        reject(new Error('Error de conexión'))
      }
    })
  }

  // ─── Secuencia auto-check: importar → comprobar ──────────────────────────────
  useEffect(() => {
    autoCheckFnRef.current = async () => {
      try {
        await importListings()
      } catch (err) {
        console.warn('Import falló en auto-check, continuando igualmente:', err.message)
      }
      checkPrices(true)
    }
    return () => { autoCheckFnRef.current = null }
  }) // sin deps: re-registra cada render para capturar realm/league frescos

  // ─── CRUD ────────────────────────────────────────────────────────────────────
  async function addItem(e) {
    e.preventDefault()
    if (!form.name || !form.type || !form.my_price) { addToast('Completa todos los campos', 'error'); return }
    const query = {
      query: {
        type: form.type,
        stats:  [{ type: 'and', filters: [], disabled: true }],
        status: { option: 'online' },   // ✅ solo vendedores online
        filters: {
          // ✅ instant buyout en todos los ítems
          trade_filters: {
            filters: {
              sale_type: { option: 'priced' },         // solo precio fijo
              price:     { option: form.currency },    // filtro de divisa
            },
            disabled: false,
          },
          // ✅ filtros de gema solo si es gema
          ...(form.category === 'gem' && {
            misc_filters: {
              filters: {
                gem_level:   { min: 21 },
                gem_sockets: { min: 5  },
              },
              disabled: false,
            },
          }),
        },
      },
      sort: { price: 'asc' }
    }
    if (form.category === 'gem') {
      query.query.filters = {
        misc_filters:  { filters: { gem_level: { min: 21 }, gem_sockets: { min: 5 } }, disabled: false },
        trade_filters: { filters: { price: { option: form.currency } } }
      }
    }
    const res = await fetch('/api/monitor/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name, category: form.category, query,
        my_price: parseFloat(form.my_price), currency: form.currency
      })
    })
    if (res.ok) {
      setForm({ name: '', type: '', my_price: '', currency: 'chaos', category: 'item' })
      loadItems(); addToast('Ítem agregado', 'success')
    }
  }

  async function deleteItem(id) {
    await fetch(`/api/monitor/items/${id}`, { method: 'DELETE' })
    loadItems(); addToast('Ítem eliminado', 'info')
  }

  async function clearAllItems() {
    if (!confirm('¿Eliminar todos los ítems?')) return
    for (const item of items) await fetch(`/api/monitor/items/${item.id}`, { method: 'DELETE' })
    loadItems(); addToast('Lista borrada', 'info')
  }

  // ─── Tabla ordenada ──────────────────────────────────────────────────────────
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (sortBy === 'price_desc') return b.my_price - a.my_price
      if (sortBy === 'price_asc')  return a.my_price - b.my_price
      if (sortBy === 'name')       return getDisplayName(a).display.localeCompare(getDisplayName(b).display, 'es')
      return 0
    })
  }, [items, sortBy, results])

  // ─── Agrupar filas por nombre (FIX: agrupa aunque el sort las separe) ────────
  const rows = useMemo(() => {
    // 1. Construir grupos por nombre
    const groupMap = new Map()
    for (const item of sortedItems) {
      if (!groupMap.has(item.name)) groupMap.set(item.name, [])
      groupMap.get(item.name).push(item)
    }

    // 2. Respetar el orden del sort para los grupos, emitiendo el grupo completo
    //    la primera vez que aparece el nombre
    const out  = []
    const seen = new Set()
    for (const item of sortedItems) {
      if (seen.has(item.name)) continue
      seen.add(item.name)

      // Dentro de cada grupo: siempre de mayor a menor precio
      const group = groupMap.get(item.name).sort((a, b) => b.my_price - a.my_price)
      group.forEach((it, idx) =>
        out.push({ item: it, showName: idx === 0, nameRowSpan: idx === 0 ? group.length : 0 })
      )
    }
    return out
  }, [sortedItems])

  const ProgressBar = ({ progress, total, message }) => (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{message}</span>
        {total > 0 && (
          <>
            <div style={{ flex: 1, background: 'var(--bg-elevated)', borderRadius: '4px', height: '6px' }}>
              <div style={{ width: `${(progress / total) * 100}%`, background: 'var(--accent)', height: '100%', borderRadius: '4px', transition: 'width 0.3s ease' }} />
            </div>
            <span style={{ color: 'var(--accent)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{progress}/{total}</span>
          </>
        )}
      </div>
    </div>
  )

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="monitor">

      {/* Toasts */}
      <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === 'warn' ? '#3a2800' : 'var(--bg-elevated)',
            border: `1px solid ${t.type === 'warn' ? '#f59e0b' : 'var(--border)'}`,
            color: 'var(--text-primary)', padding: '0.65rem 1rem', borderRadius: '6px',
            fontSize: '0.85rem', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', maxWidth: '320px'
          }}>
            {t.message}
          </div>
        ))}
      </div>

      {/* Cabecera */}
      <div className="page-header">
        <h1 className="page-heading">🔔 Monitor de Precio</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Auto-check:</label>
          <select className="input input--short" value={pollInterval} onChange={e => setPollInterval(parseInt(e.target.value))}>
            {POLL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {pollInterval > 0 && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', minWidth: '120px' }}>
            {loading && isAutoCheckRef.current ? '⏳ Comprobando...' : `⏱ Próxima: ${formatCountdown(countdown)}`}
          </span>
        )}

        <button
          className={`btn ${soundEnabled ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setSoundEnabled(s => !s)}
          style={{ minWidth: '2.5rem' }}
        >
          {soundEnabled ? '🔔' : '🔕'}
        </button>

        <button
          className="btn btn--secondary"
          onClick={repetirUltimoAviso}
          style={{ minWidth: '2.5rem' }}
          title="Repetir último aviso"
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

      {checkProgress  && <ProgressBar progress={checkProgress.progress  ?? 0} total={checkProgress.total   ?? 0} message={checkProgress.message}  />}
      {importProgress && <ProgressBar progress={importProgress.progress ?? 0} total={importProgress.total_chunks ?? 0} message={importProgress.message} />}

      {/* Formulario */}
      <div className="card">
        <div className="card-title">Añadir ítem a vigilar</div>
        <form className="add-form" onSubmit={addItem}>
          <select className="input input--short" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            <option value="item">Ítem</option>
            <option value="gem">Gema</option>
          </select>
          <input className="input" placeholder="Nombre (ej: Tornado Shot)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input className="input" placeholder="Type exacto de la API" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} />
          <input className="input input--short" type="number" placeholder="Mi precio" value={form.my_price} onChange={e => setForm(f => ({ ...f, my_price: e.target.value }))} />
          <select className="input input--short" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <button className="btn btn--primary" type="submit">Añadir</button>
        </form>
      </div>

      {/* Tabla */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1rem 0.75rem' }}>
          <h3 style={{ margin: 0 }}>📋 Mi Lista de Venta ({items.length} ítems)</h3>
          <select className="input input--short" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="price_desc">💰 Mayor precio</option>
            <option value="price_asc">💰 Menor precio</option>
            <option value="name">🔤 Nombre</option>
          </select>
        </div>

        {rows.length === 0 ? (
          <p className="empty-state">No hay ítems. Importa tus listings o agrega manualmente.</p>
        ) : (
          <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '8%' }}  />
              <col style={{ width: '36%' }} />
              <col style={{ width: '24%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Ítem</th>
                <th>Mi precio</th>
                <th>Divisa</th>
                <th>Estado</th>
                <th>Mercado (ofertas)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, showName, nameRowSpan }, idx) => {
                const { display, original } = getDisplayName(item)
                const isFirstOfGroup = showName && idx > 0
                return (
                  <tr key={item.id} style={{ borderTop: isFirstOfGroup ? '2px solid var(--border)' : undefined }}>

                    {showName && (
                      <td rowSpan={nameRowSpan} style={{ verticalAlign: 'middle', fontWeight: 500 }}>
                        <span
                          title={original ? `EN: ${original}` : undefined}
                          style={original ? { cursor: 'help', borderBottom: '1px dotted var(--text-secondary)' } : undefined}
                        >
                          {display}
                        </span>
                      </td>
                    )}

                    <td>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                        borderRadius: '4px', padding: '0.1rem 0.35rem', fontSize: '0.85rem'
                      }}>
                        {item.my_price}
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => deleteItem(item.id)}
                          style={{ padding: '0 0.2rem', minWidth: 'unset', fontSize: '0.7rem', lineHeight: 1 }}
                        >
                          ✕
                        </button>
                      </span>
                    </td>

                    <td><span className="badge">{item.currency}</span></td>
                    <td>{renderStatus(item)}</td>
                    <td>{renderMercado(item)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}