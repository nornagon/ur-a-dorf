import React, { useState, useEffect, useContext } from 'react'
import ReactDOM from 'react-dom'
import './style.css'
import { jobSkillById, jobTypeById, laborName, professionById, skillLevel } from './enums'
import { applyPatch } from 'rfc6902'

const WorldDataContext = React.createContext(null)

const Json = ({data}) =>
  <div style={{whiteSpace: 'pre-wrap', fontFamily: 'monospace'}}>{JSON.stringify(data, null, 2)}</div>

const df_color = {
  black: 0,
  blue: 1,
  green: 2,
  cyan: 3,
  red: 4,
  magenta: 5,
  brown: 6,
  lgray: 7,
  dgray: 8,
  lblue: 9,
  lgreen: 10,
  lcyan: 11,
  lred: 12,
  lmagenta: 13,
  yellow: 14,
  white: 15,
}
const df_color_to_css = {
  '0:0:0': { color: 'lightgray' },
  '0:0:1': { color: 'lightgray' }, // ?
  '1:0:0': { color: 'navy' },
  '1:0:1': { color: '#4b4bff' /* blue */ },
  '2:0:0': { color: 'green' },
  '2:0:1': { color: 'lightgreen' },
  '3:0:0': { color: 'teal' },
  '3:0:1': { color: 'cyan' },
  '4:0:0': { color: 'maroon' },
  '4:0:1': { color: 'red' },
  '5:0:0': { color: 'purple' },
  '5:0:1': { color: 'fuchsia' },
  '6:0:0': { color: 'olive' },
  '6:0:1': { color: '#f9e747' /* yellow */ },
  '7:0:0': { color: 'gray' },
  '7:0:1': { color: 'white' },
}

const DFText = ({text}) => {
  const re = /\[(P|B|C:(\d:\d:\d))\]/g
  let out = []
  let idx = 0
  let lastColor = { color: 'black' }
  let m
  while (m = re.exec(text)) {
    const snippet = text.slice(idx, m.index)
    if (snippet.length) out.push(<span style={lastColor} key={out.length}>{snippet}</span>)
    idx = m.index + m[0].length
    switch (m[1][0]) {
      case 'P':
        out.push(<br key={out.length}/>)
        break;
      case 'B':
        out.push(<br key={out.length}/>)
        out.push(<br key={out.length}/>)
        break;
      case 'C':
        lastColor = df_color_to_css[m[2]] || { color: 'black' }
        break;
    }
  }
  out.push(<span key={out.length} style={{color: lastColor}}>{text.slice(idx)}</span>)
  return out
}

const wrap = (str, left, right) => {
  right = right || left
  if (!right && !left) return str
  return `${left}${str}${right}`
}

const qualityMarker = [ '', '-', '+', '*', '≡', '☼' ]

const Item = ({item}) => {
  const foreign = !!(item.flags1 & (1 << 14))
  const {quality, isImproved, improvementQuality, description} = item
  let name = description
  if (foreign) name = wrap(description, '(', ')')
  name = wrap(name, qualityMarker[quality])
  if (isImproved) {
    name = wrap(name, '«', '»')
    name = wrap(name, qualityMarker[improvementQuality])
  }
  return <span>{name}{item.stackSize > 1 ? ` [${item.stackSize}]` : null}</span>
}

const Job = ({job}) => {
  if (!job) {
    return <span>No Job</span>
  }
  const jobType = jobTypeById[job.type]
  return <span>{jobType.caption}</span>
}

const modeName = {
  0: 'Hauled',
  1: 'Weapon',
  2: 'Worn',
  3: 'Piercing',
  4: 'Flask',
  5: 'WrappedAround',
  6: 'StuckIn',
  7: 'InMouth',
  8: 'Pet',
  9: 'SewnInto',
  10: 'Strapped',
}

const Unit = ({unit}) => {
  const worldData = useContext(WorldDataContext)
  const profession = unit.customProfession || professionById[unit.profession].caption
  return <div className="unit">
    <div className="name">
      {unit.name ? <>
        <span style={{textTransform: 'capitalize'}}>{unit.name.firstName}</span>{unit.name.nickname ? ` '${unit.name.nickname}'` : ''} {unit.name.lastName}
      </> : null}, {profession}
    </div>
    <div className="job">
      {unit.creature ? <Job job={unit.creature.currentJob} /> : null}
    </div>
    {unit.creature ?
      <div className="environment">
        {unit.creature.outside ? <span style={df_color_to_css['3:0:1']}>Outside</span> : <span style={df_color_to_css['6:0:0']}>Inside</span>}
        {" "}
        {unit.creature.light ? <span style={df_color_to_css['6:0:1']}>Light</span> : <span style={df_color_to_css['7:0:0']}>Dark</span>}
        {" "}
        {unit.creature.light ? <span style={df_color_to_css['2:0:1']}>Above Ground</span> : <span style={df_color_to_css['7:0:0']}>Subterranean</span>}
      </div> : null}
    <div className="description">
      {unit.creature ? <DFText text={unit.creature.appearance.description} /> : null}
    </div>
    <details>
      <summary>Skills</summary>
      <ul className="skills">
        {(unit.skills || []).map(skill =>
          <li key={skill.id}>{skillLevel(skill.level)} {jobSkillById[skill.id].caption_noun}</li>
        )}
      </ul>
    </details>
    <details>
      <summary>Labors</summary>
      <div className="labors">
        {worldData.enums.unitLabor.filter(l => l.value >= 0)
            .map(l => <div key={l.value}><input type="checkbox" checked={(unit.labors || []).includes(l.value)} onChange={(e) => {
              fetch('/set-labor', {
                method: 'POST',
                headers: {'Content-type': 'application/json'},
                body: JSON.stringify({
                  unitId: unit.unitId,
                  labor: l.value,
                  value: e.currentTarget.checked
                })
              })
            }}/> {laborName(l.value)}</div>)}
      </div>
    </details>
    <details>
      <summary>Inventory</summary>
      <ul>
        {(unit.creature && unit.creature.inventory ? unit.creature.inventory : []).map(({item, mode}) => {
          return <li key={item.id}><Item item={item} />, {modeName[mode]}</li>
        })}
      </ul>
    </details>
    <details>
      <summary>Raw JSON</summary>
      <Json data={unit} />
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
    let lastData = null
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.replace) {
        lastData = data.replace
        setMyUnit(lastData)
      } else if (data.patch && data.patch.length) {
        applyPatch(lastData, data.patch)
        setMyUnit({...lastData}) // spread to force new object
      }
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
