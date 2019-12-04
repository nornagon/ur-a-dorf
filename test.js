const net = require('net')
const util = require('util')
const debug = require('debug')('dfhack-rpc')

const protobuf = require('protobufjs')

const { DFConnection } = require('./df')

;(async () => {

const df = new DFConnection()

await df.connect()

const invoke = df._invoke.bind(df)

try {
  console.log(await invoke('GetVersion'))
  const worldInfo = await invoke('GetWorldInfo')
  const civId = worldInfo.civId
  const { creatureRaws } = await invoke('GetCreatureRaws') // TODO: could be cached...
  const enums = await invoke('ListEnums')
  const laborsByName = {}
  const laborsByValue = {}
  for (const {name, value} of enums.unitLabor) {
    laborsByName[name] = value
    laborsByValue[value] = name
  }

  const { value: units } = await invoke('ListUnits', {
    scanAll: true,
    civId,
    race: worldInfo.raceId, // TODO: not all members of the fortress are necessarily dwarves...
    mask: { labors: true, skills: true, profession: true, miscTraits: true }
  })
  for (const u of units) {
    const name = u.name ? `${u.name.firstName} ${u.name.lastName} ("${u.name.englishName}")` : creatureRaws.find(x => x.index === u.race).name[0]
    console.log(`${name} labors: ${u.labors.map(l => laborsByValue[l])}`)
  }

  await invoke('SetUnitLabors', {change: [
    {unitId: units[0].unitId, labor: laborsByName.MINE, value: true}
  ]})

  /*
  await invoke('ResetMapHashes')
  const mapInfo = await invoke('GetMapInfo')
  console.log(mapInfo)
  while (true) {
    const blockList = await invoke('GetBlockList', {blocksNeeded: 50, minX: 0, minY: 0, minZ: 0, maxX: mapInfo.blockSizeX, maxY: mapInfo.blockSizeY, maxZ: mapInfo.blockSizeZ})
    const mapBlocks = blockList.mapBlocks
    for (const block of blockList.mapBlocks) {
      console.log({x: block.mapX, y: block.mapY, z: block.mapZ})
    }
    if (mapBlocks.length < 50) break
  }
  */

} finally {
  df.close()
}

})().then(() => {
  process.exit(0)
}, e => {
  console.error(e)
  process.exit(1)
})
