import { useState } from 'react'
import Monitor      from './pages/Monitor'
import Tracker      from './pages/Tracker'
import Ranking      from './pages/Ranking'
import Chinofarmers from './pages/Chinofarmers'
import Stocks       from './pages/Stocks'
import Dinerete     from './pages/Dinerete'
import { LeagueProvider, REALMS, LEAGUES, useLeague } from './LeagueContext'
import { MonitorProvider } from './MonitorContext'
import './App.css'

const NAV = [
  { id: 'monitor',      label: 'Monitor de Precio',    icon: '🔔' },
  { id: 'tracker',      label: 'Historial de Precios', icon: '📈' },
  { id: 'ranking',      label: 'Ranking del Mercado',  icon: '🏆' },
  { id: 'chinofarmers', label: 'ChInOfArMeRs',         icon: '👲' },
  { id: 'dinerete',     label: 'Dinerete',              icon: '💰' },
]

function SidebarSettings() {
  const { realm, league, setRealm, setLeague } = useLeague()

  return (
    <div className="sidebar-settings">
      <div className="settings-group">
        <label className="settings-label">Plataforma</label>
        <select
          className="input input--short"
          value={realm}
          onChange={e => setRealm(e.target.value)}
          style={{ width: '100%' }}
        >
          {REALMS.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      <div className="settings-group">
        <label className="settings-label">Liga</label>
        <div className="radio-group">
          {LEAGUES.map(l => (
            <label key={l.value} className="radio-item">
              <input
                type="radio"
                name="league"
                value={l.value}
                checked={league === l.value}
                onChange={() => setLeague(l.value)}
              />
              <span>{l.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

function AppShell() {
  const [active, setActive]         = useState('monitor')
  const [stocksUser, setStocksUser] = useState(null)
  const { realm, league }           = useLeague()

  function openStocks(user) {
    setStocksUser(user)
    setActive('stocks')
  }

  function backFromStocks() {
    setActive('chinofarmers')
    setStocksUser(null)
  }

  function handleNav(id) {
    setActive(id)
    if (id !== 'stocks') setStocksUser(null)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">⚗️</span>
          <div>
            <div className="sidebar-title">PoE2 Market</div>
            <div className="sidebar-sub">{league} · {realm.toUpperCase()}</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(item => (
            <button
              key={item.id}
              className={`nav-item ${
                active === item.id ||
                (active === 'stocks' && item.id === 'chinofarmers')
                  ? 'nav-item--active'
                  : ''
              }`}
              onClick={() => handleNav(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <SidebarSettings />

        <div className="sidebar-footer">
          <span className="status-dot" />
          Backend conectado
        </div>
      </aside>

      <main className="main-content">
        {active === 'monitor'      && <Monitor />}
        {active === 'tracker'      && <Tracker />}
        {active === 'ranking'      && <Ranking />}
        {active === 'dinerete'     && <Dinerete />}
        {active === 'chinofarmers' && (
          <Chinofarmers onViewStocks={openStocks} />
        )}
        {active === 'stocks' && stocksUser && (
          <Stocks user={stocksUser} onBack={backFromStocks} />
        )}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <LeagueProvider>
      <MonitorProvider>
        <AppShell />
      </MonitorProvider>
    </LeagueProvider>
  )
}