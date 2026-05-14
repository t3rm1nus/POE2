import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import GEM_TRANSLATIONS from './gemTranslations'
import { useLeague } from './LeagueContext'

export const TrackerContext = createContext(null)

export function useTracker() {
  const ctx = useContext(TrackerContext)
  if (!ctx) throw new Error('useTracker debe usarse dentro de <TrackerProvider>')
  return ctx
}

// Frases graciosas al terminar el escaneo (se elige una al azar)
const FRASES_FIN_SCAN = [
  '¡Toma ya! Escaneo completado, tío. Ya tienes todos los precios fresquitos del horno.',
  '¡Terminao! Ahora ya sabes quién cobra más caro por sus gemas de pacotilla.',
  'Misión cumplida, crack. El mercado está radiografiado, ya puedes espiar con dignidad.',
  '¡Escaneo listo! Si el mercado fuera tuyo estarías forrao, pero de momento solo lo vigilas.',
  'Todo escaneado. Ahora ya no tienes excusa para no saber cuánto vale cada gema, campeón.',
]

function speak(text) {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'es-ES'
  utt.rate = 0.95
  window.speechSynthesis.speak(utt)
}

function fraseAleatoria() {
  return FRASES_FIN_SCAN[Math.floor(Math.random() * FRASES_FIN_SCAN.length)]
}

export function TrackerProvider({ children }) {
  const { realm, league } = useLeague()

  // ── Estado del mercado ───────────────────────────────────────────────────
  const [gems,         setGems]         = useState({})
  const [meta,         setMeta]         = useState(null)
  const [staleCount,   setStaleCount]   = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [totalGems,    setTotalGems]    = useState(0)
  const [myAccount,    setMyAccount]    = useState('')

  // ── Estado del escaneo ───────────────────────────────────────────────────
  const [scanning,     setScanning]     = useState(false)
  const [scanProgress, setScanProgress] = useState(null)
  const [currentGem,   setCurrentGem]   = useState(null)

  // Refs para no perder la conexión al navegar entre páginas
  const evtSourceRef = useRef(null)
  const realmRef     = useRef(realm)
  const leagueRef    = useRef(league)

  useEffect(() => { realmRef.current  = realm  }, [realm])
  useEffect(() => { leagueRef.current = league }, [league])

  // ── Cargar caché ─────────────────────────────────────────────────────────
  const loadCachedGems = useCallback(async () => {
    try {
      const res  = await fetch(`/api/tracker/gems?realm=${realmRef.current}&league=${encodeURIComponent(leagueRef.current)}`)
      const data = await res.json()
      const map  = {}
      for (const g of data.gems) map[g.gem_type] = g
      setGems(map)
      setMeta(data.meta)
      setStaleCount(data.stale_count    ?? 0)
      setPendingCount(data.pending_count ?? 0)
      setTotalGems(data.total_gems       ?? 0)
      if (data.my_account) setMyAccount(data.my_account)
    } catch (err) {
      console.error('[TrackerContext] Error cargando caché:', err)
    }
  }, []) // usa refs internamente → estable

  // Carga inicial y cuando cambia liga/realm
  useEffect(() => { loadCachedGems() }, [realm, league]) // eslint-disable-line

  // Escuchar evento del Monitor para refrescar el historial
  useEffect(() => {
    window.addEventListener('monitor:check-done', loadCachedGems)
    return () => window.removeEventListener('monitor:check-done', loadCachedGems)
  }, [loadCachedGems])

  // ── Escaneo ──────────────────────────────────────────────────────────────
  function startScan(force = false) {
    // Si ya hay un escaneo activo no lo reiniciamos
    if (evtSourceRef.current) return

    setScanning(true)
    setCurrentGem(null)
    setScanProgress({ message: 'Conectando...', progress: 0, total: 0 })

    const params = new URLSearchParams({
      realm:  realmRef.current,
      league: leagueRef.current,
      ...(force ? { force: 'true' } : {}),
    })
    const evtSource = new EventSource(`/api/tracker/scan?${params}`)
    evtSourceRef.current = evtSource

    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data)

      if (data.status === 'start') {
        setScanProgress({
          message:  `Escaneando ${data.total} gemas pendientes...`,
          progress: 0,
          total:    data.total,
        })
      }

      if (data.status === 'scanning') {
        const nameEs = GEM_TRANSLATIONS[data.gem_type] || data.gem_type
        setCurrentGem({ name: nameEs, cat: data.category })
        setScanProgress(prev => ({
          ...prev,
          message:  `Consultando: ${nameEs}`,
          progress: data.progress,
        }))
      }

      if (data.status === 'gem_done') {
        const { gem_type, category, price, currency, seller, seller_online, total_listings, progress, total } = data
        setScanProgress(prev => ({ ...prev, progress, total }))
        setGems(prev => ({
          ...prev,
          [gem_type]: {
            gem_type,
            category,
            cheapest_price:  price          ?? null,
            currency:        currency       ?? 'divine',
            seller:          seller         ?? null,
            seller_online:   seller_online != null ? seller_online : 'unknown',
            total_listings:  total_listings ?? 0,
            fetched_at:      new Date().toISOString(),
          },
        }))
      }

      if (data.status === 'done') {
        evtSource.close()
        evtSourceRef.current = null
        setScanning(false)
        setScanProgress(null)
        setCurrentGem(null)
        loadCachedGems()
        // 🔊 Aviso de voz graciosete al terminar
        speak(fraseAleatoria())
      }
    }

    evtSource.onerror = () => {
      evtSource.close()
      evtSourceRef.current = null
      setScanning(false)
      setScanProgress({ message: 'Error de conexión — escaneo interrumpido' })
      setCurrentGem(null)
    }
  }

  function stopScan() {
    evtSourceRef.current?.close()
    evtSourceRef.current = null
    setScanning(false)
    setScanProgress(null)
    setCurrentGem(null)
  }

  async function clearAllGems() {
    if (!confirm(
      '¿Borrar todos los datos del mercado de gemas para esta liga?\nTendrás que volver a escanear desde cero.'
    )) return
    await fetch(
      `/api/tracker/gems?realm=${realmRef.current}&league=${encodeURIComponent(leagueRef.current)}`,
      { method: 'DELETE' }
    )
    setGems({})
    setMeta(null)
    setStaleCount(0)
    setPendingCount(0)
  }

  return (
    <TrackerContext.Provider value={{
      // datos de mercado
      gems, meta, staleCount, pendingCount, totalGems, myAccount,
      // estado del escaneo
      scanning, scanProgress, currentGem, evtSourceRef,
      // acciones
      loadCachedGems, startScan, stopScan, clearAllGems,
    }}>
      {children}
    </TrackerContext.Provider>
  )
}