// Separado de MonitorContext.jsx para cumplir con el requisito de Fast Refresh de Vite:
// un archivo no puede exportar mezclados componentes React y hooks/funciones normales.
import { useContext } from 'react'
import { MonitorContext } from './MonitorContext'

export function useMonitor() {
  const ctx = useContext(MonitorContext)
  if (!ctx) throw new Error('useMonitor debe usarse dentro de MonitorProvider')
  return ctx
}