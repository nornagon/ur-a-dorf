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
        <span style={{textTransform: 'capitalize'}}>{unit.name.firstName} {unit.name.lastName}</span>
      </> : null}
    </div>
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
  </div>
}

const Main = () => {
  const [dwarves, setDwarves] = useState([])
  const worldData = useContext(WorldDataContext)
  useEffect(() => {
    let timerId = null
    let cancelled = false
    function doFetch() {
      fetch('/dwarves').then(x => x.json()).then(json => {
        if (cancelled) return
        setDwarves(json)
        setTimeout(doFetch, 1000)
      })
    }
    doFetch()
    return () => {
      cancelled = true
      if (timerId != null)
        clearTimeout(timerId)
    }
  }, [])
  return <div>
    {dwarves.map(d => <Unit key={d.unitId} unit={d} />)}
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
