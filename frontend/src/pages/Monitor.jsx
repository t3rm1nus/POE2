import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import GEM_TRANSLATIONS from '../gemTranslations'
import { useMonitor } from '../MonitorContext'
import { useLeague } from '../LeagueContext'
import { POLL_OPTIONS, formatCountdown, repetirUltimoAviso } from '../monitorUtils'

const CURRENCIES = ['chaos', 'divine', 'exalted', 'aug']

// ─── Inyectar keyframe de pulso una sola vez ──────────────────────────────────
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
  `
  document.head.appendChild(s)
}

// ─── Componente: punto de estado online ──────────────────────────────────────
function OnlineDot({ online, isOwn = false, size = 8 }) {
  injectPulseStyle()
  const active = isOwn || !!online
  return (
    <span
      title={isOwn ? 'Tu cuenta (siempre online)' : active ? 'Online' : 'Offline'}
      style={{
        display:         'inline-block',
        width:           `${size}px`,
        height:          `${size}px`,
        borderRadius:    '50%',
        flexShrink:      0,
        verticalAlign:   'middle',
        background:      active ? '#22c55e' : '#4b5563',
        animation:       active ? 'sellerPulse 2s ease-in-out infinite' : 'none',
        transition:      'background 0.3s',
      }}
    />
  )
}

// ─── Componente: badge de vendedor con icono online ───────────────────────────
function SellerBadge({ seller, online, isOwn = false, myAccount = '' }) {
  const own = isOwn || (myAccount && seller?.toLowerCase() === myAccount?.toLowerCase())
  return (
    <span style={{
      display:    'inline-flex',
      alignItems: 'center',
      gap:        '0.3rem',
      fontSize:   '0.8rem',
      color:      own ? 'var(--accent)' : 'var(--text-secondary)',
      fontWeight: own ? 600 : 400,
    }}>
      <OnlineDot online={online} isOwn={own} />
      {seller ?? '—'}
    </span>
  )
}

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
    clearResults,
    isAutoCheckRef,
    autoCheckFnRef,
    getDisplayName,
  } = useMonitor()

  function getResult(item) {
    return results.find(r => r.item === item.name && r.myPrice === item.my_price)
        ?? results.find(r => r.item === item.name)
        ?? null
  }

  // ─── Estado de la fila ────────────────────────────────────────────────────
  function renderStatus(item) {
    const r = getResult(item)
    if (!r)                 return <span className="status status--idle">— Sin comprobar</span>
    if (r.error)            return <span className="status status--idle">— Error</span>
    if (r.noActiveListings) return <span className="status status--sold">🔴 Sin listing activo (¿vendido?)</span>
    if (r.cheaperOwnExists) return <span className="status status--warn">🔵 Tienes otro más barato ({r.myActiveMin} {r.myCurrency})</span>

    if (r.isMinPrice) {
      if (r.tied) {
        // Vendedor del empate ya se ve en renderMercado — solo estado aquí
        return <span className="status status--warn">⚡ Empate ({r.marketMin} {r.marketCurrency})</span>
      }
      return <span className="status status--ok">✅ Eres el más barato</span>
    }

    // Hay más baratos
    const c = r.cheaper?.[0]
    return (
      <span className="status status--warn" style={{ color: '#ef4444', fontWeight: 700 }}>
        ⚠️ Más baratos ({r.marketMin} {r.marketCurrency})
      </span>
    )
  }

  // ─── Columna mercado ──────────────────────────────────────────────────────
  function renderMercado(item) {
    const r = getResult(item)
    if (!r || r.marketMin === null)
      return <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>—</span>

    const cheaper = r.cheaper?.[0]

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        {/* Precio mínimo del mercado */}
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

        {/* Vendedor más barato con estado online */}
        {cheaper?.seller && (
          <SellerBadge
            seller={cheaper.seller}
            online={cheaper.online}
          />
        )}

        {/* Si hay empate mostramos al rival también */}
        {!cheaper && r.tiedSeller?.seller && (
          <SellerBadge
            seller={r.tiedSeller.seller}
            online={r.tiedSeller.online}
          />
        )}
      </div>
    )
  }

  // ─── Importar listings ────────────────────────────────────────────────────
  // Fix 3: Emitir evento al Tracker cuando el import termina
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
        // DESPUÉS
        if (data.status === 'done') {
          evtSource.close()
          await loadItems()
          setImporting(false)
          setImportProgress(null)
          if (data.warn) {
            addToast(`⚠️ ${data.warn}`, 'warn')
          } else {
            addToast('Importación completada', 'success')
          }
          window.dispatchEvent(new CustomEvent('monitor:check-done'))
          resolve()
        }
        if (data.error) {
          evtSource.close()
          setImporting(false)
          setImportProgress({ message: `Error: ${data.error}` })
          addToast(`Error: ${data.error}`, 'error')
          reject(new Error(data.error))
        }
      }
      evtSource.onerror = () => {
        evtSource.close()
        setImporting(false)
        setImportProgress({ message: 'Error de conexión' })
        addToast('Error de conexión con el servidor', 'error')
        reject(new Error('Error de conexión'))
      }
    })
  }

  async function clearAllItemsSilent(currentItems) {
    await Promise.all(
      currentItems.map(item =>
        fetch(`/api/monitor/items/${item.id}`, { method: 'DELETE' })
      )
    )
    clearResults() 
    await loadItems()
  }

  useEffect(() => {
    autoCheckFnRef.current = async () => {
      const snapshotItems = [...items]

      if (snapshotItems.length > 0) {
        addToast('🔄 Auto-check: limpiando lista...', 'info')
        await clearAllItemsSilent(snapshotItems)
      }

      try {
        await importListings()
      } catch (err) {
        console.warn('Import falló en auto-check, continuando igualmente:', err.message)
      }

      let freshItems = []
      try {
        const res = await fetch('/api/monitor/items')
        freshItems = await res.json()
      } catch (err) {
        console.warn('No se pudo leer ítems frescos:', err.message)
      }

      const freshNames = new Map(freshItems.map(i => [i.name, i]))
      const preSales   = []

      for (const prev of snapshotItems) {
        const current = freshNames.get(prev.name)
        if (!current) {
          preSales.push({ name: prev.name, display: getDisplayName(prev).display, partial: false })
          // 👇 AÑADIR: registrar venta total
          fetch(`${import.meta.env.VITE_API ?? 'http://localhost:3001'}/api/sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              gem_name: getDisplayName(prev).display,
              gem_type: prev.name,
              price:    prev.my_price,
              currency: prev.currency,
              quantity: prev.quantity ?? 1,
              partial:  false,
              realm, league,
            }),
          }).then(() => window.dispatchEvent(new CustomEvent('dinerete:sale-added')))
        } else {
          const prevQty    = prev.quantity ?? 1
          const currentQty = current.quantity ?? 1
          if (prevQty > currentQty) {
            preSales.push({
              name: prev.name, display: getDisplayName(prev).display,
              partial: true, soldCount: prevQty - currentQty, remaining: currentQty,
            })
            // 👇 AÑADIR: registrar venta parcial
            fetch(`${import.meta.env.VITE_API ?? 'http://localhost:3001'}/api/sales`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                gem_name: getDisplayName(prev).display,
                gem_type: prev.name,
                price:    prev.my_price,
                currency: prev.currency,
                quantity: prevQty - currentQty,
                partial:  true,
                realm, league,
              }),
            }).then(() => window.dispatchEvent(new CustomEvent('dinerete:sale-added')))
          }
        }
      }

      checkPrices(true, preSales)
    }

    
  })

  // ─── CRUD ─────────────────────────────────────────────────────────────────
  async function addItem(e) {
    e.preventDefault()
    if (!form.name || !form.type || !form.my_price) { addToast('Completa todos los campos', 'error'); return }
    const query = {
      query: {
        type: form.type,
        stats:  [{ type: 'and', filters: [], disabled: true }],
        status: { option: 'online' },
        filters: {
          trade_filters: {
            filters: {
              sale_type: { option: 'priced' },
              price:     { option: form.currency },
            },
            disabled: false,
          },
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
    await clearAllItemsSilent(items)
    addToast('Lista borrada', 'info')
  }

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (sortBy === 'price_desc') return b.my_price - a.my_price
      if (sortBy === 'price_asc')  return a.my_price - b.my_price
      if (sortBy === 'name')       return getDisplayName(a).display.localeCompare(getDisplayName(b).display, 'es')
      return 0
    })
  }, [items, sortBy, results, getDisplayName])

  const rows = useMemo(() => {
    const groupMap = new Map()
    for (const item of sortedItems) {
      if (!groupMap.has(item.name)) groupMap.set(item.name, [])
      groupMap.get(item.name).push(item)
    }
    const out  = []
    const seen = new Set()
    for (const item of sortedItems) {
      if (seen.has(item.name)) continue
      seen.add(item.name)
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
              <col style={{ width: '8%'  }} />
              <col style={{ width: '32%' }} />
              <col style={{ width: '28%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Ítem</th>
                <th>Mi precio</th>
                <th>Divisa</th>
                <th>Estado</th>
                <th>Mercado (mín / vendedor)</th>
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
                        {item.quantity > 1 && (
                          <span style={{
                            marginLeft: '0.4rem', fontSize: '0.7rem', color: 'var(--text-secondary)',
                            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                            borderRadius: '3px', padding: '0 0.25rem',
                          }}>
                            ×{item.quantity}
                          </span>
                        )}
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