const util = require('util')
const { DFConnection } = require('./df')
const df = new DFConnection()
const [, , method, arg] = process.argv
df.connect().then(async () => {
  console.log(util.inspect(await df[method](JSON.parse(arg || '{}')), {depth: Infinity, maxArrayLength: Infinity, colors: true}))
  df.close()
})
