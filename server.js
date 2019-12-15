require('dotenv').config()
const express = require('express')
const passport = require('passport')
const rfc6902 = require('rfc6902')
const { ensureLoggedIn } = require('connect-ensure-login')

const env = process.env.NODE_ENV || 'development'

const twitchStrategy = require('passport-twitch-new').Strategy
const {
  TWITCH_OAUTH_CLIENT_ID,
  TWITCH_OAUTH_CLIENT_SECRET,
  PUBLIC_URL = env === 'production' ? 'https://df.nornagon.net' : 'http://localhost:5050',
} = process.env

passport.use(new twitchStrategy({
  clientID: TWITCH_OAUTH_CLIENT_ID || 'not-set',
  clientSecret: TWITCH_OAUTH_CLIENT_SECRET || 'not-set',
  callbackURL: `${PUBLIC_URL}/auth/twitch/callback`,
  scope: 'user_read',
}, (accessToken, refreshToken, profile, done) => {
  console.log(profile)
  done(null, profile)
}))

if (env === 'development') {
  const fakeUser = {
    id: '1234',
    display_name: 'uristmcviewer',
  }
  class DummyStrategy extends passport.Strategy {
    constructor() {
      super()
      this.name = 'dummy'
    }
    authenticate(req) {
      return this.success(fakeUser)
    }
  }
  passport.use(new DummyStrategy())
}

passport.serializeUser(function(user, done) {
  done(null, JSON.stringify(user))
})

passport.deserializeUser(function(user, done) {
  done(null, JSON.parse(user))
})


const { DFConnection } = require('./df')
const store = require('./datastore')

const app = express()

app.use(express.static('static'))

if (env === 'development') {
  const webpack = require('webpack')
  const config = require('./webpack.config.js')
  const compiler = webpack(config)
  const webpackDevMiddleware = require('webpack-dev-middleware')(compiler, {
    publicPath: config.output.publicPath,
  })

  app.use(webpackDevMiddleware)
} else {
  app.use(express.static('dist'))
}

const df = new DFConnection()

app.use(require('body-parser').json())

app.use(require('cookie-session')({
  name: 'session',
  keys: ['keyboard cat'],
  maxAge: 24 * 60 * 60 * 1000,
}));
app.use(passport.initialize());
app.use(passport.session());

if (env === 'development') {
  app.get('/auth/dummy', passport.authenticate("dummy"), (req, res) => res.redirect('/'))
}
app.get('/auth/twitch', passport.authenticate("twitch"))
app.get('/auth/twitch/callback', passport.authenticate("twitch", { failureRedirect: '/' }), (req, res) => {
  res.redirect('/')
})


let units = []
let enums = null
let creatureRaws = null
let itemTypes = null
let worldInfo = null

app.get('/static-data', (req, res) => {
  res.json({enums})
})

app.post('/set-labor', (req, res) => {
  df.SetUnitLabors({change: [req.body]})
    .then(
      () => res.json({ok: true}),
      (e) => { res.json({ok: false}); console.error(e) }
    )
})

function isInactive(u) {
  return (u.flags1 & (1 << 1)) !== 0
}

function isVisitor(u) {
  return (u.flags2 & (1 << 23)) !== 0
}

function isResident(u) {
  return (u.flags2 & (1 << 19)) !== 0
}

function canBeClaimed(u) {
  return !isInactive(u) && !isVisitor(u) && isResident(u)
}

async function claimUnit(userId, unitId, nickname) {
  await store.createClaim(userId, unitId)
  await df.RenameUnit({ unitId, nickname })
}
async function getAvailableUnits() {
  const claims = await store.getAllClaims()
  const claimedUnits = new Set
  for (const c of claims) { claimedUnits.add(c.unitId) }
  return units.filter(u => !claimedUnits.has(u.unitId) && canBeClaimed(u))
}
async function getClaimedUnit(userId) {
  const existingClaims = await store.getClaims(userId)
  for (const claim of existingClaims) {
    for (const unit of units) {
      if (unit.unitId === claim.unitId) {
        return unit
      }
    }
  }
  return null
}

app.post('/claim-unit', ensureLoggedIn('/auth/twitch'), (req, res, next) => {
  (async () => {
    const existingClaimedUnit = await getClaimedUnit(req.user.id)
    if (existingClaimedUnit) {
      return res.json({ok: false, reason: 'You may only claim 1 unit at a time.'})
    }
    const available = await getAvailableUnits()
    if (available.length > 0) {
      const claimed = available.find(u => u.name.nickname === req.user.display_name) || available[0]
      await claimUnit(req.user.id, claimed.unitId, req.user.display_name)
      res.json({ok: true, claimed: claimed.unitId})
    } else {
      res.json({ok: false, reason: "no units"})
    }
  })().catch(next)
})

const watching = {}
const watchingEv = new (require('events').EventEmitter)()

app.get('/my-unit', ensureLoggedIn('/auth/twitch'), (req, res, next) => {
  if (!(req.user.id in watching)) {
    watching[req.user.id] = {count: 0, user: req.user}
  }
  watching[req.user.id].count++
  watchingEv.emit('changed')
  res.writeHead(200, {'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
  res.write('\n\n')
  let timeout = null
  req.on('close', () => {
    if (timeout != null)
      clearTimeout(timeout)
    if (req.user.id in watching) {
      watching[req.user.id].count--;
      if (watching[req.user.id].count === 0)
        delete watching[req.user.id]
    }
    watchingEv.emit('changed')
  })

  let lastData = null
  async function check() {
    try {
      const claimedUnit = await getClaimedUnit(req.user.id)
      if (claimedUnit) {
        let data
        if (lastData == null) {
          data = { replace: claimedUnit }
        } else {
          data = { patch: rfc6902.createPatch(lastData, claimedUnit) }
        }
        lastData = claimedUnit
        res.write(`data: ${JSON.stringify(data)}\n\n`)
      }
    } catch (e) {
      console.error(e.stack)
      res.end()
      return
    }
    timeout = setTimeout(check, 1000)
  }
  check()
})

app.get('/_watching', (req, res, next) => {
  res.writeHead(200, {'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
  res.write('\n\n')
  function handler() {
    res.write(`data: ${JSON.stringify(watching)}\n\n`)
  }
  watchingEv.on('changed', handler)
  req.on('close', () => {
    watchingEv.off('changed', handler)
  })
  handler()
})


df.connect().then(async () => {
  console.log('fetching static data...')
  creatureRaws = (await df.GetCreatureRaws()).creatureRaws
  itemTypes = (await df.GetItemList()).materialList
  worldInfo = await df.GetWorldInfo()
  enums = await df.ListEnums()

  app.listen(5050)
  console.log(`listening on http://localhost:5050`)

  setInterval(async () => {
    const claims = await store.getAllClaims()
    const { civId } = worldInfo
    const { value: _units } = await df.ListUnits({
      scanAll: true,
      civId,
      race: worldInfo.raceId, // TODO: not all members of the fortress are necessarily dwarves...
      mask: { labors: true, skills: true, profession: true, miscTraits: true }
    })
    const unitIds = claims.map(c => c.unitId)
    const { creatureList } = await df.GetUnits({unitIds})
    for (const creature of (creatureList || [])) {
      const unit = _units.find(u => u.unitId === creature.id)
      if (unit) {
        unit.creature = creature
      }
    }
    units = _units
  }, 500)
}).catch(e => {
  console.error(e)
  df.close()
  process.exit(1)
})
