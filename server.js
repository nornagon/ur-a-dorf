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


let units = {}
let enums = null
let worldInfo = null

app.get('/static-data', (req, res) => {
  res.json({enums})
})

app.post('/set-labor', (req, res) => {
  df.SetUnitLabors({change: [req.body]})
    .then(
      () => {
        res.json({ok: true})
        triggerUpdate([req.body.unitId])
      },
      (e) => { res.json({ok: false}); console.error(e) }
    )
})

function isInactive(u) {
  return (u.flags1 & (1 << 1)) !== 0
}

function isMarauder(u) {
  return (u.flags1 & (1 << 4)) !== 0
}

function isMerchant(u) {
  return (u.flags1 & (1 << 6)) !== 0
}

function isForest(u) {
  return (u.flags1 & (1 << 7)) !== 0
}

function isDiplomat(u) {
  return (u.flags1 & (1 << 11)) !== 0
}

function isInvader(u) {
  return (u.flags1 & (1 << 17)) !== 0 || (u.flags1 & (1 << 19)) !== 0
}

function isUnderworld(u) {
  return (u.flags2 & (1 << 18)) !== 0
}

function isResident(u) {
  return (u.flags2 & (1 << 19)) !== 0
}

function isUninvitedVisitor(u) {
  return (u.flags2 & (1 << 22)) !== 0
}

function isVisitor(u) {
  return (u.flags2 & (1 << 23)) !== 0
}

function isGhostly(u) {
  return (u.flags3 & (1 << 12)) !== 0
}

const nonLaboringProfessions = new Set([
  103, // CHILD
  104, // BABY
  105, // DRUNK
  106, // MONSTER_SLAYER
  107, // SCOUT
  108, // BEAST_HUNTER
  109, // SNATCHER
  110, // MERCENARY
])
function canAssignLabor(u) {
  return !nonLaboringProfessions.has(u.profession)
}

function isDwarf(u) {
  // TODO: allow claiming non-dwarf laborable units
  return u.race === 572
}

function canBeClaimed(u) {
  return !isInactive(u) && !isVisitor(u) && !isGhostly(u) && canAssignLabor(u)
    && !isMarauder(u) && !isInvader(u) && !isForest(u) && !isMerchant(u) &&
    !isDiplomat(u) && !isUninvitedVisitor(u) && !isUnderworld(u) &&
    !isResident(u) && isDwarf(u)
  // TODO: isOwnGroup
}

async function getClaimableUnits() {
  const { civId } = worldInfo
  const { value: allUnits } = await df.ListUnits({ scanAll: true, civId })
  return allUnits.filter(canBeClaimed)
}

async function getAvailableUnits() {
  const [claims, allUnits] = await Promise.all([
    store.getAllClaims(),
    getClaimableUnits()
  ])
  const claimedUnits = new Set(claims.map(c => c.unitId))
  return allUnits.filter(u => !claimedUnits.has(u.unitId))
}

async function claimUnit(userId, unitId, nickname) {
  await store.createClaim(userId, unitId)
  await df.RenameUnit({ unitId, nickname })
}

async function getClaimedUnit(userId) {
  const existingClaims = await store.getClaims(userId)
  for (const claim of existingClaims) {
    if (claim.unitId in units) {
      return units[claim.unitId]
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
    const sortValue = u => {
      if (u.name.nickname === req.user.display_name) return -100
      if (u.name.nickname) return 10 // deprioritize nicknamed units
      return 0
    }
    available.sort((a, b) => {
      return sortValue(a) - sortValue(b)
    })
    if (available.length > 0) {
      const claimed = available[0]
      await claimUnit(req.user.id, claimed.unitId, req.user.display_name)
      await triggerUpdate([claimed.unitId])
      res.json({ok: true, claimed: claimed.unitId})
    } else {
      res.json({ok: false, reason: "no units"})
    }
  })().catch(next)
})

const watching = {}
const watchingEv = new (require('events').EventEmitter)()
const unitChanges = new (require('events').EventEmitter)()

app.get('/my-unit', ensureLoggedIn('/auth/twitch'), (req, res, next) => {
  if (!(req.user.id in watching)) {
    watching[req.user.id] = {count: 0, user: req.user}
  }
  watching[req.user.id].count++
  watchingEv.emit('changed')
  res.writeHead(200, {'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
  res.write('\n\n')
  let watchingUnit = null
  req.on('close', () => {
    if (watchingUnit != null)
      unitChanges.off(watchingUnit, check)
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
        unitChanges.once(claimedUnit.unitId, check)
        watchingUnit = claimedUnit.unitId
      } else {
        res.end() // eh, come back later.
      }
    } catch (e) {
      console.error(e.stack)
      res.end()
      return
    }
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

async function updateAllWatchedUnits() {
  const claims = await store.getAllClaims()
  const watchingUserIds = Object.values(watching).map(u => u.user.id)
  const watchedClaims = claims.filter(c => watchingUserIds.includes(c.userId))
  const watchedUnitIds = watchedClaims.map(c => c.unitId)
  await triggerUpdate(watchedUnitIds)
}

async function triggerUpdate(unitIds) {
  if (!unitIds.length) return
  const { value: _units } = await df.ListUnits({
    idList: unitIds,
    mask: { labors: true, skills: true, profession: true, miscTraits: true }
  })
  const { creatureList } = await df.GetUnits({ unitIds })
  for (const creature of (creatureList || [])) {
    const unit = _units.find(u => u.unitId === creature.id)
    if (unit) {
      unit.creature = creature
    }
  }
  _units.forEach(u => {
    units[u.unitId] = u
    unitChanges.emit(u.unitId)
  })
}

df.connect().then(async () => {
  console.log('fetching static data...')
  worldInfo = await df.GetWorldInfo()
  enums = await df.ListEnums()

  app.listen(5050)
  console.log(`listening on http://localhost:5050`)

  setInterval(updateAllWatchedUnits, 1000)
  updateAllWatchedUnits()
}).catch(e => {
  console.error(e)
  df.close()
  process.exit(1)
})
