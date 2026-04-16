import { createContext, useContext, useState } from 'react'

const LeagueContext = createContext(null)

export const REALMS = [
  { value: 'pc',   label: 'PC' },
  { value: 'sony', label: 'PlayStation' },
]

export const LEAGUES = [
  { value: 'Standard',                   label: 'Standard' },
  { value: 'Hardcore',                   label: 'Hardcore' },
  { value: 'Fate of the Vaal',           label: 'Fate of the Vaal' },
  { value: 'Hardcore Fate of the Vaal',  label: 'HC Fate of the Vaal' },
]

export function LeagueProvider({ children }) {
  const [realm, setRealmState]   = useState(
    () => localStorage.getItem('poe2_realm')  || 'pc'
  )
  const [league, setLeagueState] = useState(
    () => localStorage.getItem('poe2_league') || 'Standard'
  )

  function setRealm(v)  { setRealmState(v);  localStorage.setItem('poe2_realm',  v) }
  function setLeague(v) { setLeagueState(v); localStorage.setItem('poe2_league', v) }

  return (
    <LeagueContext.Provider value={{ realm, league, setRealm, setLeague }}>
      {children}
    </LeagueContext.Provider>
  )
}

export function useLeague() {
  const ctx = useContext(LeagueContext)
  if (!ctx) throw new Error('useLeague must be used inside LeagueProvider')
  return ctx
}