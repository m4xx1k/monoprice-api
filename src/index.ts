import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import { env } from './config/env.js'
import productV2Route from './routes/product-v2.js'

const app = new Hono()

app.use('*', cors())
app.use('*', logger())

app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err.message)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/health', (c) => c.json({ status: 'ok' }))

app.route('/v2/product', productV2Route)

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[monopricer] running on ${info.port}`)
})
