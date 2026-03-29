import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import { env } from './config/env.js'
import analyzeRoute from './routes/analyze.js'
import priceRoute from './routes/price.js'
import productRoute from './routes/product.js'

const app = new Hono()

app.use('*', cors())
app.use('*', logger())

app.get('/health', (c) => c.json({ status: 'ok' }))

app.route('/', analyzeRoute)
app.route('/', priceRoute)
app.route('/', productRoute)

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[monopricer] running on ${info.port}`)
})
