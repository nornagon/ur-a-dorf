const express = require('express')
const { DFConnection } = require('./df')

const app = express()

const df = new DFConnection()

app.use(express.static('static'))

let units = []

app.get('/dwarves', (req, res) => {
  res.json(units)
})


df.connect().then(async () => {
  console.log('fetching static data...')
  const { creatureRaws } = await df.GetCreatureRaws()
  const worldInfo = await df.GetWorldInfo()
  const enums = await df.ListEnums()
  const laborsByName = {}
  const laborsByValue = {}
  for (const {name, value} of enums.unitLabor) {
    laborsByName[name] = value
    laborsByValue[value] = name
  }

  app.listen(5050)
  console.log('listening on http://localhost:5050')

  setInterval(async () => {
    const { civId } = worldInfo
    const { value: _units } = await df.ListUnits({
      scanAll: true,
      civId,
      race: worldInfo.raceId, // TODO: not all members of the fortress are necessarily dwarves...
      mask: { labors: true, skills: true, profession: true, miscTraits: true }
    })
    units = _units
  }, 500)
})
