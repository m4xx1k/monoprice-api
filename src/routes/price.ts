import { Hono } from 'hono'
import { generateEmbedding, buildSearchQuery } from '../services/embeddings.js'
import { searchListings } from '../services/search.js'
import { calculatePrice } from '../services/pricer.js'
import type { PriceRequest } from '../types/index.js'

const price = new Hono()

price.post('/api/price', async (c) => {
  const body = await c.req.json<PriceRequest>()

  if (!body.description) {
    return c.json({ error: 'description is required' }, 400)
  }

  const query = buildSearchQuery(
    body.description,
    body.vision_result?.details ?? undefined
  )
  const embedding = await generateEmbedding(query)
  const analogs = await searchListings({ embedding, category_id: body.category_id })

  if (!analogs.length) {
    return c.json({ error: 'No similar listings found' }, 422)
  }

  const result = calculatePrice(analogs, body.description)
  return c.json(result)
})

export default price
