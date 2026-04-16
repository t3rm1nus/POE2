// src/monitorUtils.js
export const POLL_OPTIONS = [
    { label: 'Desactivado', value: 0 },
    { label: '5 min',       value: 5  * 60 },
    { label: '10 min',      value: 10 * 60 },
    { label: '30 min',      value: 30 * 60 },
    { label: '1 Hora',      value: 60 * 60 },
]
  
export function formatCountdown(seconds) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

let _lastSpokenText = ''

export function hablar(texto) {
  if (!window.speechSynthesis) return
  _lastSpokenText = texto
  window.speechSynthesis.cancel()
  const msg = new SpeechSynthesisUtterance(texto)
  msg.lang = 'es-ES'; msg.rate = 1.1; msg.volume = 1
  const voces = window.speechSynthesis.getVoices()
  const vozEs = voces.find(v => v.lang.startsWith('es') && v.localService)
             || voces.find(v => v.lang.startsWith('es'))
  if (vozEs) msg.voice = vozEs
  window.speechSynthesis.speak(msg)
}

export function repetirUltimoAviso() {
  if (_lastSpokenText) hablar(_lastSpokenText)
}