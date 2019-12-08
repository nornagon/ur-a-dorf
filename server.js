const express = require('express')
const passport = require('passport')
const twitchStrategy = require('passport-twitch-new').Strategy
const { ensureLoggedIn } = require('connect-ensure-login')

const {
  TWITCH_OAUTH_CLIENT_ID,
  TWITCH_OAUTH_CLIENT_SECRET
} = process.env

passport.use(new twitchStrategy({
  clientID: TWITCH_OAUTH_CLIENT_ID || 'aoeu',
  clientSecret: TWITCH_OAUTH_CLIENT_SECRET || 'aoeu',
  callbackURL: 'http://localhost:5050/auth/twitch/callback',
  scope: 'user_read',
}, (accessToken, refreshToken, profile, done) => {
  console.log(profile)
  done(null, profile)
}))

passport.serializeUser(function(user, done) {
  done(null, JSON.stringify(user))
})

passport.deserializeUser(function(user, done) {
  done(null, JSON.parse(user))
})


const { DFConnection } = require('./df')
const store = require('./datastore')

const webpack = require('webpack')
const webpackDevMiddleware = require('webpack-dev-middleware')
const config = require('./webpack.config.js')
const compiler = webpack(config)

const app = express()

app.use(webpackDevMiddleware(compiler, {
  publicPath: config.output.publicPath,
}))

const df = new DFConnection()

app.use(require('body-parser').json())

app.use(express.static('static'))
app.use(express.static('dist'))

app.use(require('express-session')({ secret: 'keyboard cat' }));
app.use(passport.initialize());
app.use(passport.session());



let units = []
let enums = null
let creatureRaws = null
let worldInfo = null

app.get('/dwarves', (req, res) => {
  res.json(units)
})

app.get('/static-data', (req, res) => {
  res.json({enums, worldInfo})
})

app.post('/set-labor', (req, res) => {
  df.SetUnitLabors({change: [req.body]})
    .then(
      () => res.json({ok: true}),
      (e) => { res.json({ok: false}); console.error(e) }
    )
})

app.get('/auth/twitch', passport.authenticate("twitch"))
app.get('/auth/twitch/callback', passport.authenticate("twitch", { failureRedirect: '/' }), (req, res) => {
  res.redirect('/')
})

async function claimUnit(userId, unitId, nickname) {
  await store.createClaim(userId, unitId)
  await df.RenameUnit({ unitId, nickname })
}
async function getAvailableUnits() {
  const claims = await store.getAllClaims()
  const claimedUnits = new Set
  for (const c of claims) { claimedUnits.add(c.unitId) }
  return units.filter(u => !claimedUnits.has(u.unitId))
}

app.post('/claim-unit', ensureLoggedIn('/auth/twitch'), (req, res, next) => {
  (async () => {
    const existingClaims = await store.getClaims(req.user.id)
    for (const claim of existingClaims) {
      if (units.some(u => u.unitId === claim.unitId)) { // the unit is alive
        return res.json({ok: false, reason: 'You may only claim 1 unit at a time.'})
      }
    }
    const available = await getAvailableUnits()
    if (available.length > 0) {
      const claimed = available.find(u => u.name.nickname === req.user.display_name) || available[0]
      await claimUnit(req.user.id, claimed.unitId, req.user.display_name)
      res.json({ok: true, claimed: claimed.unitId})
    }
  })().catch(next)
})


df.connect().then(async () => {
  console.log('fetching static data...')
  creatureRaws = (await df.GetCreatureRaws()).creatureRaws
  worldInfo = await df.GetWorldInfo()
  enums = await df.ListEnums()

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
    const { creatureList } = await df.GetUnitList()
    for (const creature of creatureList) {
      const unit = _units.find(u => u.unitId === creature.id)
      if (unit)
        unit.creature = creature
    }
    units = _units
  }, 500)
})
