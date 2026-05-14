import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useLeague } from './LeagueContext'

const API = 'http://localhost:3001'

const FRASES_OFFLINE = [
  (u) => `el chinofarmer ${u} se acaba de desconectar`,
  (u) => `${u} ha cerrado el chiringuito por hoy, ya puedes respirar tranquilo`,
  (u) => `${u} se ha ido a dormir, aprovecha antes de que vuelva`,
]

const FRASES_ONLINE = [
  (u) => `¡Alerta roja! El chinofarmer ${u} acaba de aparecer online, a ver qué trama ahora`,
  (u) => `¡Ojo al parche! ${u} se ha despertado y ya está online, prepárate para la guerra`,
  (u) => `${u} ha vuelto al mercado. Ya estamos otra vez, no te relajes ni un momento`,
  (u) => `¡Aquí viene ${u}! Se acaba de conectar, ese no descansa ni los domingos`,
]

function fraseRandom(arr, username) {
  return arr[Math.floor(Math.random() * arr.length)](username)
}

const ChinofarmersContext = createContext(null)

export function ChinofarmersProvider({ children }) {
  const { realm, league } = useLeague()

  const [users,   setUsers]   = useState([])
  const [polling, setPolling] = useState(false)
  const [muted,   setMuted]   = useState(() => localStorage.getItem('cf_muted') === 'true')

  const mutedRef = useRef(muted)
  const eventSrc = useRef(null)

  useEffect(() => {
    mutedRef.current = muted
    localStorage.setItem('cf_muted', muted)
  }, [muted])

  const speak = useCallback((text) => {
    if (mutedRef.current) return
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.lang = 'es-ES'
    utt.rate = 0.95
    window.speechSynthesis.speak(utt)
  }, [])

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
          speak(fraseRandom(FRASES_OFFLINE, msg.username))
          break

        case 'went_online':
          speak(fraseRandom(FRASES_ONLINE, msg.username))
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

    es.onerror = () => {
      // Reconectar automáticamente tras 5s si se cae
      setTimeout(() => {
        if (eventSrc.current === es) connectSSE()
      }, 5000)
    }
  }, [realm, league, speak])

  // Conectar al montar y reconectar si cambia realm/league
  useEffect(() => {
    connectSSE()
    return () => eventSrc.current?.close()
  }, [connectSSE])

  return (
    <ChinofarmersContext.Provider value={{ users, setUsers, polling, muted, setMuted, speak }}>
      {children}
    </ChinofarmersContext.Provider>
  )
}

export function useChinofarmers() {
  const ctx = useContext(ChinofarmersContext)
  if (!ctx) throw new Error('useChinofarmers debe usarse dentro de ChinofarmersProvider')
  return ctx
}