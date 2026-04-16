// ✅ Así deben quedar las primeras líneas del archivo
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import GEM_TRANSLATIONS from './gemTranslations'
import { useLeague } from './LeagueContext'
import { POLL_OPTIONS, formatCountdown, hablar, repetirUltimoAviso } from './monitorUtils'

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
  const autoCheckFnRef = useRef(null)   // ← nuevo


  // Refs para evitar closures rancias dentro del setInterval
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
  function procesarResultados(resultados, esAutomatico, currentItems) {
    if (!esAutomatico || !soundEnabledRef.current) return

    const porNombre = new Map()
    for (const r of resultados) {
      if (r.error) continue
      const existing = porNombre.get(r.item)
      if (!existing || r.myPrice < existing.myPrice) porNombre.set(r.item, r)
    }
    const representativos = Array.from(porNombre.values())
    const superados = representativos.filter(r => !r.isMinPrice)
    const empates   = representativos.filter(r => r.isMinPrice && r.tied)

    if (superados.length > 0) {
      superados.forEach((r, idx) => {
        const item     = currentItems.find(i => i.name === r.item)
        const nombre   = item ? getDisplayName(item).display : r.item
        const vendedor = r.cheapestSeller || 'alguien'
        const texto    = `El puto chinofarmer ${vendedor} ha rebajado los ${nombre} a ${r.marketMin} ${r.marketCurrency} el cacho guarro!`
        setTimeout(() => hablar(texto), idx * 4000)
        addToast(`⚠️ ${nombre} — ${vendedor} vende a ${r.marketMin} ${r.marketCurrency}`, 'warn')
      })
    } else if (empates.length > 0) {
      hablar('No hay chinofarmers a la vista, esta to controlao!')
      empates.forEach(r => {
        const item   = currentItems.find(i => i.name === r.item)
        const nombre = item ? getDisplayName(item).display : r.item
        addToast(`⚡ ${nombre} — empate a ${r.marketMin} ${r.marketCurrency}`, 'info')
      })
    }
  }
  const { realm, league } = useLeague()
  const realmRef  = useRef(realm)
  const leagueRef = useRef(league)
  useEffect(() => { realmRef.current  = realm  }, [realm])
  useEffect(() => { leagueRef.current = league }, [league])
  // ─── checkPrices ──────────────────────────────────────────────────────────
  const checkPrices = useCallback((esAutomatico = false) => {
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
        procesarResultados(data.results, esAutomatico, itemsRef.current)
        window.dispatchEvent(new CustomEvent('monitor:check-done'))  // ← debe estar aquí
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
      results, setResults,
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

