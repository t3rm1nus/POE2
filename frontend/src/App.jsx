import { useState } from 'react'
import Monitor from './pages/Monitor'
import Tracker from './pages/Tracker'
import Ranking from './pages/Ranking'

const NAV = [
  { id: 'monitor', label: 'Monitor de Precio', icon: '🔔' },
  { id: 'tracker', label: 'Historial de Precios', icon: '📈' },
  { id: 'ranking', label: 'Ranking del Mercado', icon: '🏆' },
]

export default function App() {
  const [active, setActive] = useState('monitor')

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">⚗️</span>
          <div>
            <div className="sidebar-title">PoE2 Market</div>
            <div className="sidebar-sub">Standard League</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(item => (
            <button
              key={item.id}
              className={`nav-item ${active === item.id ? 'nav-item--active' : ''}`}
              onClick={() => setActive(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
          Backend conectado
        </div>
      </aside>

      <main className="main-content">
        {active === 'monitor' && <Monitor />}
        {active === 'tracker' && <Tracker />}
        {active === 'ranking' && <Ranking />}
      </main>
    </div>
  )
}