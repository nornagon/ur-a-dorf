const express = require('express')
const passport = require('passport')
const twitchStrategy = require('passport-twitch-new').Strategy;

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
    units = _units
  }, 500)
})
