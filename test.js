const net = require('net')
const util = require('util')
const debug = require('debug')('dfhack-rpc')
const promiseStream = require('promise-stream-reader')

const protobuf = require('protobufjs')

function qualifiedName(type) {
  let name = type.name
  let p = type
  while ((p = p.parent) && p && p.name) {
    name = `${p.name}.${name}`
  }
  return name
}

;(async () => {

const {dfproto, RemoteFortressReader} = (await protobuf.load([
  'proto/CoreProtocol.proto',
  'proto/Basic.proto',
  'proto/BasicApi.proto',
  'proto/RemoteFortressReader.proto',
])).nested

const s = net.createConnection({
  port: 5000
}, () => {
  const header = Buffer.alloc(12)
  header.write('DFHack?\n')
  header.writeInt32LE(1, 8)
  debug('handshake header:', header)
  s.write(header)
})

const reader = promiseStream()
s.pipe(reader)

const response = await reader.read(12)

function writeMessage(id, buf) {
  const header = Buffer.alloc(8)
  header.writeInt16LE(id)
  // NB. dfhack struct isn't packed.
  header.writeInt32LE(buf.length, 4)
  debug('write header:', header)
  s.write(header)
  if (buf.length > 0) {
    debug('write buf:', buf)
    s.write(buf)
  }
}

async function readMessage() {
  while (true) {
    const header = await reader.read(8)
    debug('read header:', header)
    const id = header.readInt16LE(0)
    // NB. dfhack struct isn't packed.
    const size = header.readInt32LE(4)
    debug(`           : id=${id} size=${size}`)
    if (id === -2 /* RPC_REPLY_FAIL */) {
      throw new Error(`failed: ${size}`)
    }
    const body = size > 0 ? await reader.read(size) : Buffer.alloc(0)
    debug('read body:', body)
    if (id === -1 /* RPC_REPLY_RESULT */) {
      return body
    } else if (id === -3 /* RPC_REPLY_TEXT */) {
      debug('reply text:', body.toString())
    }
  }
}

async function invokeById(id, body) {
  writeMessage(id, body)
  return await readMessage()
}

async function bindMethod({method, inputMsg, outputMsg, plugin}) {
  const obj = {method, inputMsg, outputMsg, plugin}
  const err = dfproto.CoreBindRequest.verify(obj)
  if (err)
    throw new Error(err)
  const message = dfproto.CoreBindRequest.create(obj)
  const payload = dfproto.CoreBindRequest.encode(message).finish()
  const replyPayload = await invokeById(0, payload)
  const reply = dfproto.CoreBindReply.decode(replyPayload)
  return reply.assignedId
}

const methods = {
  GetVersion: {in: dfproto.EmptyMessage, out: dfproto.StringMessage},
  GetDFVersion: {in: dfproto.EmptyMessage, out: dfproto.StringMessage},
  GetWorldInfo: {in: dfproto.EmptyMessage, out: dfproto.GetWorldInfoOut},
  ListEnums: {in: dfproto.EmptyMessage, out: dfproto.ListEnumsOut},
  ListUnits: {in: dfproto.ListUnitsIn, out: dfproto.ListUnitsOut},
  GetBlockList: {plugin: 'RemoteFortressReader', in: RemoteFortressReader.BlockRequest, out: RemoteFortressReader.BlockList},
  ResetMapHashes: {plugin: 'RemoteFortressReader', in: dfproto.EmptyMessage, out: dfproto.EmptyMessage},
}

const idTable = {}
async function invoke(method, params) {
  if (!(method in methods)) {
    throw new Error(`unknown method: '${method}'`)
  }
  const {in: inType, out: outType, plugin} = methods[method]

  if (!(method in idTable)) {
    debug('binding:', method)
    const inputMsg = qualifiedName(inType)
    const outputMsg = qualifiedName(outType)
    const id = await bindMethod({method, inputMsg, outputMsg, plugin})
    idTable[method] = id
  }

  debug('invoking:', method)
  const requestPayload = inType.encode(inType.fromObject(params)).finish()
  const responsePayload = await invokeById(idTable[method], requestPayload)
  return outType.decode(responsePayload)
}

try {
  //console.log(await invoke('GetVersion'))
  //console.log(await invoke('GetDFVersion'))
  //console.log(await invoke('GetWorldInfo'))
  //console.log(await invoke('ListEnums'))
  //console.log((await invoke('ListUnits', {scanAll: true, mask: { labors: true }})).value)
  await invoke('ResetMapHashes')
  console.log(util.inspect(await invoke('GetBlockList', {minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 10}), {depth:5}))

} finally {
  writeMessage(-4, Buffer.alloc(0))
  s.end()
}

})().then(() => {
  process.exit(0)
}, e => {
  console.error(e)
  process.exit(1)
})
