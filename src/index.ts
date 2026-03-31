import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import { env } from './config/env.js'
import { generateEmbedding } from './services/embeddings.js'
import { searchListings } from './services/search.js'
import productRoute from './routes/product.js'
import productV2Route from './routes/product-v2.js'

const app = new Hono()

app.use('*', cors())
app.use('*', logger())

app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err.message)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/health', (c) => c.json({ status: 'ok' }))

app.route('/v1/product', productRoute)
app.route('/v2/product', productV2Route)

serve({ fetch: app.fetch, port: env.PORT }, async (info) => {
  console.log(`[monopricer] running on ${info.port}`)

  // Warm up embedding API + DB cache so first real request is fast
  try {
    const t = Date.now()
    const vec = await generateEmbedding('warmup')
    await searchListings({ embedding: vec, limit: 1 })
    console.log(`[warmup] done in ${Date.now() - t}ms`)
  } catch (e: any) {
    console.warn(`[warmup] failed: ${e.message}`)
  }
})
