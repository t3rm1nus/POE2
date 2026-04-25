// ✅ Así deben quedar las primeras líneas del archivo
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import GEM_TRANSLATIONS from './gemTranslations'
import { useLeague } from './LeagueContext'
import { POLL_OPTIONS, formatCountdown, hablar, hablarTodo, repetirUltimoAviso} from './monitorUtils'

const MonitorContext = createContext(null)

// ─── Provider ────────────────────────────────────────────────────────────────
export function MonitorProvider({ children }) {
  const [items, setItems]                   = useState([])
  const [results, setResults]               = useState([])
  const [loading, setLoading]               = useState(false)
  const [checkProgress, setCheckProgress]   = useState(null)

  const [pollInterval, setPollInterval] = useState(() => {
    const saved = localStorage.getItem('poe2_poll_interval')
    return saved !== null ? parseInt(saved) : 0
  })
  const [countdown, setCountdown] = useState(0)
  const countdownRef   = useRef(null)
  const isAutoCheckRef = useRef(false)
  const autoCheckFnRef = useRef(null)

  const loadingRef      = useRef(false)
  const itemsRef        = useRef([])
  const soundEnabledRef = useRef(true)

  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('poe2_sound_enabled')
    return saved !== null ? saved === 'true' : true
  })

  const [toasts, setToasts] = useState([])
  const toastIdRef = useRef(0)

  // ─── Sincronizar refs ──────────────────────────────────────────────────────
  useEffect(() => { loadingRef.current = loading },           [loading])
  useEffect(() => { itemsRef.current = items },               [items])
  useEffect(() => { soundEnabledRef.current = soundEnabled }, [soundEnabled])

  // ─── Persistencia ─────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('poe2_poll_interval', String(pollInterval))
  }, [pollInterval])

  useEffect(() => {
    localStorage.setItem('poe2_sound_enabled', String(soundEnabled))
  }, [soundEnabled])

  // ─── Carga inicial ─────────────────────────────────────────────────────────
  useEffect(() => { loadItems() }, [])

  async function loadItems() {
    const res  = await fetch('/api/monitor/items')
    const data = await res.json()
    setItems(data)
  }

  // ─── Nombre traducido ──────────────────────────────────────────────────────
  function getDisplayName(item) {
    let query
    try { query = typeof item.query === 'string' ? JSON.parse(item.query) : item.query }
    catch { query = null }
    const type       = query?.query?.type
    const translated = (type && GEM_TRANSLATIONS[type]) || GEM_TRANSLATIONS[item.name] || null
    return {
      display:  translated || item.name,
      original: translated && translated !== item.name ? item.name : null,
    }
  }

  // ─── Toasts ───────────────────────────────────────────────────────────────
  function addToast(message, type = 'warn') {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }

  // ─── Avisos sonoros ────────────────────────────────────────────────────────
  // preSales: ventas detectadas ANTES del check (auto-check: ítems que no
  //           volvieron tras el import). Formato: [{ name, display, partial, soldCount }]
  function procesarResultados(resultados, esAutomatico, currentItems, preSales = []) {
    if (!soundEnabledRef.current) return

    const porNombre = new Map()
    for (const r of resultados) {
      if (r.error) continue
      const existing = porNombre.get(r.item)
      if (!existing || r.myPrice < existing.myPrice) porNombre.set(r.item, r)
    }
    const representativos = Array.from(porNombre.values())

    // Ventas detectadas por el check (noActiveListings)
    const vendidosPorCheck = representativos.filter(r => r.noActiveListings)

    // ← CAMBIO: ventas parciales detectadas por el check
    //   (storedQuantity > myListingsCount y myListingsCount > 0)
    const parcialesPorCheck = representativos.filter(r =>
      !r.noActiveListings &&
      r.storedQuantity > 1 &&
      r.myListingsCount !== undefined &&
      r.myListingsCount < r.storedQuantity
    )

    const activos   = representativos.filter(r => !r.noActiveListings)
    const superados = activos.filter(r => !r.isMinPrice)
    const empates   = activos.filter(r => r.isMinPrice && r.tied)

    const partesVoz = []

    // ── 1. Estado de precios (primero, según petición) ──────────────────────
    if (superados.length > 0) {
      const nombres = superados.map(r => {
        const item = currentItems.find(i => i.name === r.item)
        return item ? getDisplayName(item).display : r.item
      })
      partesVoz.push(`los guarros chinofarmers han rebajado de precio: ${nombres.join(', ')}`)
      superados.forEach(r => {
        const item     = currentItems.find(i => i.name === r.item)
        const nombre   = item ? getDisplayName(item).display : r.item
        const vendedor = r.cheapestSeller || 'alguien'
        addToast(`⚠️ ${nombre} — ${vendedor} vende a ${r.marketMin} ${r.marketCurrency}`, 'warn')
      })
    } else if (empates.length > 0) {
      partesVoz.push('No hay chinofarmers a la vista, está to controlao')
      empates.forEach(r => {
        const item   = currentItems.find(i => i.name === r.item)
        const nombre = item ? getDisplayName(item).display : r.item
        addToast(`⚡ ${nombre} — empate a ${r.marketMin} ${r.marketCurrency}`, 'info')
      })
    } else if (activos.length > 0) {
      if (!esAutomatico) partesVoz.push('Todo controlado, eres el más barato')
    }

    // ── 2. Ventas completas (segundo) ───────────────────────────────────────
    // Unir ventas detectadas por check + ventas pre-check (auto-check),
    // evitando duplicados por nombre
    const nombresYaAnunciados = new Set(vendidosPorCheck.map(r => r.item))

    // Añadir las pre-detecadas que no solapan con las del check
    const todasVentasCompletas = [
      ...vendidosPorCheck,
      ...preSales
        .filter(ps => !ps.partial && !nombresYaAnunciados.has(ps.name))
        .map(ps => ({ item: ps.name, _display: ps.display }))
    ]

    if (todasVentasCompletas.length > 0) {
      const nombres = todasVentasCompletas.map(r => {
        if (r._display) return r._display
        const item = currentItems.find(i => i.name === r.item)
        return item ? getDisplayName(item).display : r.item
      })
      partesVoz.push(`has vendido: ${nombres.join(', ')}`)

      todasVentasCompletas.forEach(r => {
        const nombre = r._display || (() => {
          const item = currentItems.find(i => i.name === r.item)
          return item ? getDisplayName(item).display : r.item
        })()
        addToast(`✅ ${nombre} — ¡vendido!`, 'success')
      })

      // Borrar de la BD: vendidos por check (los pre-check ya se borraron al importar)
      const nombresVendidosPorCheck = new Set(vendidosPorCheck.map(r => r.item))
      Promise.all(
        currentItems
          .filter(i => nombresVendidosPorCheck.has(i.name))
          .map(i => fetch(`/api/monitor/items/${i.id}`, { method: 'DELETE' }))
      ).then(() => loadItems())
    }

    // ── 3. Ventas parciales (segundo también, tras completas) ───────────────
    // Unir parciales del check + parciales pre-check
    const todasParciales = [
      ...parcialesPorCheck.map(r => {
        const item      = currentItems.find(i => i.name === r.item)
        const nombre    = item ? getDisplayName(item).display : r.item
        const vendidas  = r.storedQuantity - r.myListingsCount
        return { nombre, vendidas, quedan: r.myListingsCount }
      }),
      ...preSales
        .filter(ps => ps.partial)
        .map(ps => ({ nombre: ps.display, vendidas: ps.soldCount, quedan: ps.remaining }))
    ]

    if (todasParciales.length > 0) {
      const frases = todasParciales.map(p =>
        `${p.vendidas} de ${p.vendidas + p.quedan} ${p.nombre}`
      )
      partesVoz.push(`has vendido ${frases.join(' y ')}`)

      todasParciales.forEach(p => {
        addToast(`🟡 ${p.nombre} — vendida${p.vendidas > 1 ? 's' : ''} ${p.vendidas}, quedan ${p.quedan}`, 'success')
      })
    }

    // ── 4. Hablar todo de una vez en el orden correcto ──────────────────────
    if (partesVoz.length > 0) hablarTodo(partesVoz)
  }

  const { realm, league } = useLeague()
  const realmRef  = useRef(realm)
  const leagueRef = useRef(league)
  useEffect(() => { realmRef.current  = realm  }, [realm])
  useEffect(() => { leagueRef.current = league }, [league])

  // ─── checkPrices ──────────────────────────────────────────────────────────
  // ← CAMBIO: acepta preSales (ventas detectadas antes del check en auto-check)
  const checkPrices = useCallback((esAutomatico = false, preSales = []) => {
    if (loadingRef.current) return
    setLoading(true)
    loadingRef.current = true
    setResults([])
    setCheckProgress({ message: 'Iniciando...', progress: 0, total: 0 })
    isAutoCheckRef.current = esAutomatico

    const evtSource = new EventSource(
      `/api/monitor/check?realm=${realmRef.current}&league=${encodeURIComponent(leagueRef.current)}`
    )

    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data)

      if (data.status === 'checking') setCheckProgress(data)

      if (data.status === 'done') {
        evtSource.close()
        setResults(data.results)
        setLoading(false)
        loadingRef.current = false
        setCheckProgress(null)
        // ← CAMBIO: pasar preSales a procesarResultados
        procesarResultados(data.results, esAutomatico, itemsRef.current, preSales)
        window.dispatchEvent(new CustomEvent('monitor:check-done'))
      }

      if (data.error) {
        evtSource.close()
        setLoading(false)
        loadingRef.current = false
        setCheckProgress({ message: `Error: ${data.error}` })
      }
    }

    evtSource.onerror = () => {
      evtSource.close()
      setLoading(false)
      loadingRef.current = false
      setCheckProgress({ message: 'Error de conexión' })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Polling + cuenta atrás ────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(countdownRef.current)
    setCountdown(0)
    if (pollInterval === 0) return

    let remaining = pollInterval

    function tick() {
      remaining -= 1
      setCountdown(remaining)
      if (remaining <= 0) {
        remaining = pollInterval
        if (!loadingRef.current) {
          const fn = autoCheckFnRef.current ?? (() => checkPrices(true))
          fn()
        }
      }
    }

    setCountdown(remaining)
    countdownRef.current = setInterval(tick, 1000)
    return () => clearInterval(countdownRef.current)
  }, [pollInterval, checkPrices])

  return (
    <MonitorContext.Provider value={{
      items, setItems, loadItems,
      results,
      clearResults: () => setResults([]),   // ← NUEVO
      loading,
      checkProgress,
      pollInterval, setPollInterval,
      countdown,
      isAutoCheckRef,
      autoCheckFnRef,
      soundEnabled, setSoundEnabled,
      toasts,
      addToast,
      checkPrices,
      getDisplayName,
    }}>
      {children}
    </MonitorContext.Provider>
  )
}

export function useMonitor() {
  const ctx = useContext(MonitorContext)
  if (!ctx) throw new Error('useMonitor debe usarse dentro de MonitorProvider')
  return ctx
}