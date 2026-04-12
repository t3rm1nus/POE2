import { useState, useEffect } from 'react'

const CURRENCIES = ['chaos', 'divine', 'exalted', 'aug']

export default function Monitor() {
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(null)
  const [checkProgress, setCheckProgress] = useState(null)
  const [items, setItems] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', type: '', my_price: '', currency: 'chaos', category: 'item' })
  const [sortBy, setSortBy] = useState('price_desc')

  useEffect(() => { loadItems() }, [])

  async function loadItems() {
    const res = await fetch('/api/monitor/items')
    const data = await res.json()
    setItems(data)
  }

  async function checkPrices() {
    if (items.length === 0) return
    setLoading(true)
    setResults([])
    setCheckProgress({ message: 'Iniciando...', progress: 0, total: 0 })

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
  }

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

  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === 'price_desc') return b.my_price - a.my_price
    if (sortBy === 'price_asc') return a.my_price - b.my_price
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    return 0
  })

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

  return (
    <div className="monitor">
      <div className="page-header">
        <h1 className="page-heading">🔔 Monitor de Precio</h1>
        <button className="btn btn--primary" onClick={checkPrices} disabled={loading || items.length === 0}>
          {loading ? 'Comprobando...' : 'Comprobar ahora'}
        </button>
        <button className="btn btn--primary" onClick={importListings} disabled={importing}>
          {importing ? '⏳ Importando...' : '📥 Importar mis listings'}
        </button>
        <button className="btn btn--danger" onClick={clearAllItems} disabled={items.length === 0}>
          🗑️ Borrar lista
        </button>
      </div>

      {checkProgress && (
        <ProgressBar
          progress={checkProgress.progress}
          total={checkProgress.total}
          message={checkProgress.message}
        />
      )}

      {importProgress && (
        <ProgressBar
          progress={importProgress.progress}
          total={importProgress.total_chunks}
          message={importProgress.message}
        />
      )}

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
                return (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.my_price}</td>
                    <td><span className="badge">{item.currency}</span></td>
                    <td>
                      {result ? (
                        result.isMinPrice
                          ? result.tied
                            ? <span className="status status--warn">⚡ Empate — hay otro al mismo precio ({result.marketMin} {result.marketCurrency})</span>
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