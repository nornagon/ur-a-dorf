import React, { useState, useEffect, useContext } from 'react'
import ReactDOM from 'react-dom'
import './style.css'

const WorldDataContext = React.createContext(null)

const Json = ({data}) =>
  <div style={{whiteSpace: 'pre-wrap', fontFamily: 'monospace'}}>{JSON.stringify(data, null, 2)}</div>

const Unit = ({unit}) => {
  const worldData = useContext(WorldDataContext)
  return <div className="unit">
    <div className="name">
      {unit.name ? <>
        <span style={{textTransform: 'capitalize'}}>{unit.name.firstName}</span>{unit.name.nickname ? ` '${unit.name.nickname}'` : ''} {unit.name.lastName}
      </> : null}
    </div>
    <div className="description">
      {unit.creature.appearance.description || <em>(no description)</em>}
    </div>
    <details>
      <summary>Labors</summary>
      <div className="labors">
        {worldData.enums.unitLabor.filter(l => l.value >= 0)
            .map(l => <div key={l.value}><input type="checkbox" checked={unit.labors.includes(l.value)} onChange={(e) => {
              fetch('/set-labor', {
                method: 'POST',
                headers: {'Content-type': 'application/json'},
                body: JSON.stringify({
                  unitId: unit.unitId,
                  labor: l.value,
                  value: e.currentTarget.checked
                })
              })
            }}/> {l.name}</div>)}
      </div>
    </details>
  </div>
}

const ClaimButton = () => {
  const [loading, setLoading] = useState(false)
  function claimUnit() {
    setLoading(true)
    fetch('/claim-unit', { method: 'POST' })
      .then(res => {
        if (!res.ok) {
        }
      })
      .catch(() => {
        setLoading(false)
      })
  }
  return <button disabled={loading} onClick={claimUnit}>Claim a dwarf</button>
}

const Main = () => {
  const [myUnit, setMyUnit] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loggedIn, setLoggedIn] = useState(true)
  const worldData = useContext(WorldDataContext)
  useEffect(() => {
    const eventSource = new EventSource('/my-unit')
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setMyUnit(data)
    }
    eventSource.onerror = (event) => {
      if (eventSource.readyState === EventSource.CLOSED) {
        setLoading(false)
        setLoggedIn(false)
        // not logged in?
      }
    }
    eventSource.onopen = () => {
      setLoading(false)
      setLoggedIn(true)
    }
    return () => {
      eventSource.close()
    }
  }, [])
  if (!loggedIn) {
    return <div>
      <a href="/auth/twitch">login with twitch</a>
    </div>
  }
  return loading ? null : <div>
    {myUnit ? <Unit unit={myUnit} /> : <ClaimButton />}
    {/*<Json data={worldData} />*/}
  </div>
}

const App = () => {
  const [worldData, setWorldData] = useState(null)
  useEffect(() => {
    fetch('/static-data').then(r => r.json()).then(setWorldData)
  }, [])
  return <WorldDataContext.Provider value={worldData}>
    {worldData != null ? <Main /> : 'loading...'}
  </WorldDataContext.Provider>
}

ReactDOM.render(<App />, document.getElementById('main'))
