import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import GEM_TRANSLATIONS from './gemTranslations'
import { useLeague } from './LeagueContext'
import { POLL_OPTIONS, formatCountdown, hablar, hablarTodo, repetirUltimoAviso} from './monitorUtils'

// Exportado como named export para que useMonitor.js pueda importarlo
export const MonitorContext = createContext(null)

export function MonitorProvider({ children }) {
  const [items, setItems]                 = useState([])
  const [results, setResults]             = useState([])
  const [loading, setLoading]             = useState(false)
  const [checkProgress, setCheckProgress] = useState(null)
  const [tips, setTips]                   = useState([])

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
  const tipsComputeFnRef = useRef(null)

  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('poe2_sound_enabled')
    return saved !== null ? saved === 'true' : true
  })
  function clearTips() { setTips([]) }
  const [toasts, setToasts] = useState([])
  const toastIdRef = useRef(0)

  useEffect(() => { loadingRef.current = loading },           [loading])
  useEffect(() => { itemsRef.current = items },               [items])
  useEffect(() => { soundEnabledRef.current = soundEnabled }, [soundEnabled])

  useEffect(() => {
    localStorage.setItem('poe2_poll_interval', String(pollInterval))
  }, [pollInterval])

  useEffect(() => {
    localStorage.setItem('poe2_sound_enabled', String(soundEnabled))
  }, [soundEnabled])

  useEffect(() => { loadItems() }, [])

  async function loadItems() {
    const res  = await fetch('/api/monitor/items')
    const data = await res.json()
    setItems(data)
  }

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

  function getGemType(item) {
    try {
      const q = typeof item.query === 'string' ? JSON.parse(item.query) : item.query
      return q?.query?.type ?? item.name
    } catch {
      return item.name
    }
  }

  function addToast(message, type = 'warn') {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }

  function procesarResultados(resultados, esAutomatico, currentItems, preSales = []) {
    if (!soundEnabledRef.current) return

    const porNombre = new Map()
    for (const r of resultados) {
      if (r.error) continue
      const existing = porNombre.get(r.item)
      if (!existing || r.myPrice < existing.myPrice) porNombre.set(r.item, r)
    }
    const representativos = Array.from(porNombre.values())

    const vendidosPorCheck = representativos.filter(r => r.noActiveListings)

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

    const nombresYaAnunciados = new Set(vendidosPorCheck.map(r => r.item))

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

      const nombresVendidosPorCheck = new Set(vendidosPorCheck.map(r => r.item))
      Promise.all(
        currentItems
          .filter(i => nombresVendidosPorCheck.has(i.name))
          .map(i => fetch(`/api/monitor/items/${i.id}`, { method: 'DELETE' }))
      ).then(() => loadItems())
    }

    const todasParciales = [
      ...parcialesPorCheck.map(r => {
        const item     = currentItems.find(i => i.name === r.item)
        const nombre   = item ? getDisplayName(item).display : r.item
        const vendidas = r.storedQuantity - r.myListingsCount
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

    if (partesVoz.length > 0) hablarTodo(partesVoz)
  }

  const { realm, league } = useLeague()
  const realmRef  = useRef(realm)
  const leagueRef = useRef(league)
  useEffect(() => { realmRef.current  = realm  }, [realm])
  useEffect(() => { leagueRef.current = league }, [league])

  useEffect(() => {
    tipsComputeFnRef.current = async function computeTips(resultados, currentItems) {
      try {
        const res      = await fetch(`/api/tracker/gems?realm=${realmRef.current}&league=${encodeURIComponent(leagueRef.current)}`)
        const data     = await res.json()
        const historical = data.gems ?? []

        const newTips = []
        const validos = resultados.filter(r => !r.error)

        console.log('[Tips] resultados válidos:', validos.length, '| histórico:', historical.length)

        const activos    = validos.filter(r => !r.noActiveListings)
        const baratos    = activos.filter(r => r.isMinPrice && !r.tied)
        const superados  = activos.filter(r => !r.isMinPrice)
        const empatados  = activos.filter(r => r.isMinPrice && r.tied)
        const vendidos   = validos.filter(r => r.noActiveListings)

        let resumenTexto = ''
        if (baratos.length === activos.length && activos.length > 0) {
          resumenTexto = `Eres el más barato en los ${activos.length} ítems activos. Sin competencia directa.`
        } else if (superados.length > 0 && baratos.length > 0) {
          resumenTexto = `${baratos.length} ítems dominados, ${superados.length} superados por la competencia.`
        } else if (superados.length > 0) {
          resumenTexto = `Te han bajado el precio en ${superados.length} ítem${superados.length > 1 ? 's' : ''}.`
        } else if (empatados.length > 0) {
          resumenTexto = `Empate en ${empatados.length} ítem${empatados.length > 1 ? 's' : ''}. Nadie ha movido ficha.`
        }
        if (resumenTexto) {
          newTips.push({
            key:      'resumen',
            severity: superados.length > 0 ? 'warn' : 'low',
            icon:     superados.length > 0 ? '⚠️' : '✅',
            gem:      'Resumen del chequeo',
            text:     resumenTexto,
          })
        }

        for (const r of validos) {
          const item = currentItems.find(i => i.name === r.item)
                    ?? currentItems.find(i => getGemType(i) === r.item)

          if (!item) {
            console.log('[Tips] item no encontrado para r.item:', r.item)
            continue
          }

          const { display } = getDisplayName(item)
          const gemType = getGemType(item)

          const hist = historical.find(g => g.gem_type === gemType)
                    ?? historical.find(g => g.gem_type === r.item)

          console.log(`[Tips] ${display} | marketTotal=${r.marketTotal} isMin=${r.isMinPrice} tied=${r.tied} hist=${hist?.cheapest_price ?? 'N/A'}`)

          if (!r.noActiveListings && r.marketTotal > 0 && r.marketTotal <= 6) {
            newTips.push({
              key:      `acap-${r.item}`,
              severity: r.marketTotal <= 3 ? 'high' : 'medium',
              icon:     '🎯',
              gem:      display,
              text:     `Solo ${r.marketTotal} listing${r.marketTotal > 1 ? 's' : ''} en el mercado. Poco stock: oportunidad de acaparamiento.`,
            })
          }

          if (hist?.cheapest_price && r.marketMin != null && !r.noActiveListings) {
            const ratio = r.marketMin / hist.cheapest_price
            if (ratio < 0.85) {
              const pct = Math.round((1 - ratio) * 100)
              newTips.push({
                key:      `dump-${r.item}`,
                severity: 'warn',
                icon:     '📉',
                gem:      display,
                text:     `Precio bajó un ${pct}% (antes ${hist.cheapest_price} ${hist.currency}, ahora ${r.marketMin} ${r.marketCurrency}). Alguien está dumpeando.`,
              })
            }
          }

          if (r.isMinPrice && !r.tied && !r.noActiveListings && r.marketMin != null && item.my_price) {
            const gap = r.marketMin - item.my_price
            if (gap > 1) {
              newTips.push({
                key:      `sube-${r.item}`,
                severity: 'medium',
                icon:     '💡',
                gem:      display,
                text:     `Eres el más barato y el siguiente vendedor está a ${r.marketMin} ${r.marketCurrency} (+${gap.toFixed(1)}d de margen). Puedes subir precio.`,
              })
            }
          }

          if (!r.isMinPrice && !r.noActiveListings && r.marketMin != null && item.my_price) {
            const gapPct = ((item.my_price - r.marketMin) / r.marketMin) * 100
            if (gapPct > 15) {
              newTips.push({
                key:      `gap-${r.item}`,
                severity: gapPct > 30 ? 'high' : 'warn',
                icon:     '✂️',
                gem:      display,
                text:     `Tu precio está un ${Math.round(gapPct)}% por encima del mínimo (${r.marketMin} ${r.marketCurrency}). Bajas o no vendes.`,
              })
            }
          }

          if (r.tied && r.marketTotal > 4) {
            newTips.push({
              key:      `guerra-${r.item}`,
              severity: 'low',
              icon:     '⚔️',
              gem:      display,
              text:     `${r.marketTotal} listings al mismo precio. Guerra activa, baja 1 chaos para desempatar.`,
            })
          }

          if (!r.isMinPrice && !r.noActiveListings && r.marketTotal <= 5 &&
              (r.cheapestOnline === 'offline' || r.cheapestOnline === 'unknown')) {
            newTips.push({
              key:      `offline-${r.item}`,
              severity: 'low',
              icon:     '😴',
              gem:      display,
              text:     `El vendedor más barato parece offline y hay poco mercado (${r.marketTotal}). Momento tranquilo.`,
            })
          }
        }

        console.log('[Tips] generados:', newTips.length)
        setTips(newTips)
      } catch (err) {
        console.warn('[Tips] Error:', err.message)
      }
    }
  })

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
        procesarResultados(data.results, esAutomatico, itemsRef.current, preSales)
        tipsComputeFnRef.current?.(data.results, itemsRef.current)
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
      tips,
      clearResults: () => setResults([]),
      loading,
      checkProgress,
      setCheckProgress,
      pollInterval, setPollInterval,
      countdown,
      isAutoCheckRef,
      autoCheckFnRef,
      soundEnabled, setSoundEnabled,
      toasts,
      addToast,
      checkPrices,
      getDisplayName,
      clearTips,
    }}>
      {children}
    </MonitorContext.Provider>
  )
}