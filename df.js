const net = require('net')
const debug = require('debug')('dfhack-rpc')
const protobuf = require('protobufjs')

const {dfproto, RemoteFortressReader} = protobuf.loadSync([
  'proto/CoreProtocol.proto',
  'proto/Basic.proto',
  'proto/BasicApi.proto',
  'proto/RemoteFortressReader.proto',
]).nested

const methods = {
  BindMethod: {in: dfproto.CoreBindRequest, out: dfproto.CoreBindReply},
  RunCommand: {in: dfproto.CoreRunCommandRequest, out: dfproto.EmptyMessage},
  RunLua: {in: dfproto.CoreRunLuaRequest, out: dfproto.StringListMessage},

  GetVersion: {in: dfproto.EmptyMessage, out: dfproto.StringMessage},
  GetDFVersion: {in: dfproto.EmptyMessage, out: dfproto.StringMessage},
  GetWorldInfo: {in: dfproto.EmptyMessage, out: dfproto.GetWorldInfoOut},
  ListEnums: {in: dfproto.EmptyMessage, out: dfproto.ListEnumsOut},
  ListUnits: {in: dfproto.ListUnitsIn, out: dfproto.ListUnitsOut},
  SetUnitLabors: {in: dfproto.SetUnitLaborsIn, out: dfproto.EmptyMessage},

  GetMapInfo: {plugin: 'RemoteFortressReader', in: dfproto.EmptyMessage, out: RemoteFortressReader.MapInfo},
  GetBlockList: {plugin: 'RemoteFortressReader', in: RemoteFortressReader.BlockRequest, out: RemoteFortressReader.BlockList},
  ResetMapHashes: {plugin: 'RemoteFortressReader', in: dfproto.EmptyMessage, out: dfproto.EmptyMessage},
  GetCreatureRaws: {plugin: 'RemoteFortressReader', in: dfproto.EmptyMessage, out: RemoteFortressReader.CreatureRawList},
}

const makeReader = (s) => {
  let pending = Buffer.alloc(0)
  s.on('data', chunk => {
    debug(`read socket: length=${chunk.length}`)
    pending = Buffer.concat([pending, chunk])
  })
  return {
    read: (size) => {
      return new Promise((resolve, reject) => {
        if (pending.length >= size) {
          const ret = pending.slice(0, size)
          pending = size === 0 ? Buffer.alloc(0) : pending.slice(size)
          resolve(ret)
          return
        }
        function ondata() {
          if (pending.length >= size) {
            const ret = pending.slice(0, size)
            pending = size === 0 ? Buffer.alloc(0) : pending.slice(size)
            s.off('data', ondata)
            s.off('error', onerror)
            resolve(ret)
          }
        }
        function onerror(err) {
          s.off('data', ondata)
          s.off('error', onerror)
          reject(err)
        }
        s.on('data', ondata)
        s.on('error', onerror)
      })
    }
  }
}

function qualifiedName(type) {
  let name = type.name
  let p = type
  while ((p = p.parent) && p && p.name) {
    name = `${p.name}.${name}`
  }
  return name
}

class DFConnection {
  constructor() {
    this._idTable = {
      BindMethod: 0,
      RunCommand: 1
    }
  }

  async connect() {
    this._socket = net.createConnection({
      port: 5000
    }, () => {
      const header = Buffer.alloc(12)
      header.write('DFHack?\n')
      header.writeInt32LE(1, 8)
      debug('handshake header:', header)
      this._socket.write(header)
    })
    this._reader = makeReader(this._socket)
    const response = await this._reader.read(12)
    // TODO: validate response
  }


  _writeMessage(id, buf) {
    const header = Buffer.alloc(8)
    header.writeInt16LE(id)
    // NB. dfhack message header struct isn't packed.
    header.writeInt32LE(buf.length, 4)
    debug('write header:', header)
    this._socket.write(header)
    if (buf.length > 0) {
      debug('write buf:', buf)
      this._socket.write(buf)
    }
  }

  async _readMessage() {
    const reader = this._reader
    while (true) {
      const header = await reader.read(8)
      debug('read header:', header)
      const id = header.readInt16LE(0)
      // NB. dfhack message header struct isn't packed.
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
  async _invokeById(id, body) {
    this._writeMessage(id, body)
    return await this._readMessage()
  }

  async _invoke(method, params) {
    if (!(method in methods)) {
      throw new Error(`unknown method: '${method}'`)
    }
    const {in: inType, out: outType, plugin} = methods[method]

    if (!(method in this._idTable)) {
      debug('binding:', method)
      const inputMsg = qualifiedName(inType)
      const outputMsg = qualifiedName(outType)
      const {assignedId} = await this.BindMethod({method, inputMsg, outputMsg, plugin})
      this._idTable[method] = assignedId
    }

    debug('invoking:', method)
    const requestPayload = inType.encode(inType.fromObject(params)).finish()
    const responsePayload = await this._invokeById(this._idTable[method], requestPayload)
    return outType.toObject(outType.decode(responsePayload))
  }

  close() {
    this._writeMessage(-4 /* RPC_REQUEST_QUIT */, Buffer.alloc(0))
    this._socket.end()
  }
}

for (const k in methods) {
  DFConnection.prototype[k] = function (arg) { return this._invoke(k, arg) }
}

module.exports = { DFConnection }
