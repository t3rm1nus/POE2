export const POLL_OPTIONS = [
  { label: 'Desactivado', value: 0 },
  { label: '5 min',       value: 5  * 60 },
  { label: '10 min',      value: 10 * 60 },
  { label: '30 min',      value: 30 * 60 },
  { label: '1 Hora',      value: 60 * 60 },
  { label: '3 Horas',     value: 180 * 60 },
]

export function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

let _lastSpokenText = ''

function getVozEs() {
  const voces = window.speechSynthesis.getVoices()
  return voces.find(v => v.lang.startsWith('es') && v.localService)
      || voces.find(v => v.lang.startsWith('es'))
      || null
}

function _doSpeak(texto) {
  // Cancel primero, pero dar tiempo a que Chrome lo procese antes del speak
  window.speechSynthesis.cancel()
  setTimeout(() => {
    // Chrome bug: si speechSynthesis está paused, no habla
    if (window.speechSynthesis.paused) window.speechSynthesis.resume()

    const msg = new SpeechSynthesisUtterance(texto)
    msg.lang   = 'es-ES'
    msg.rate   = 1.1
    msg.volume = 1
    const voz  = getVozEs()
    if (voz) msg.voice = voz
    window.speechSynthesis.speak(msg)
  }, 150)  // ← 150ms es suficiente para que cancel() limpie la cola en Chrome
}

export function hablar(texto) {
  if (!window.speechSynthesis) return
  _lastSpokenText = texto

  const voces = window.speechSynthesis.getVoices()
  if (voces.length > 0) {
    // Voces ya cargadas → hablar directamente
    _doSpeak(texto)
  } else {
    // Voces aún no cargadas → esperar evento, con fallback por si no llega
    let fired = false
    const onReady = () => {
      if (fired) return
      fired = true
      _doSpeak(texto)
    }
    window.speechSynthesis.addEventListener('voiceschanged', onReady, { once: true })
    setTimeout(onReady, 800) // fallback: si voiceschanged no llega en 800ms, hablar igual
  }
}

export function hablarTodo(partes) {
  if (!window.speechSynthesis || partes.length === 0) return
  hablar(partes.join('. '))
}

export function repetirUltimoAviso() {
  if (_lastSpokenText) hablar(_lastSpokenText)
}