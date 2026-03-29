import { Hono } from 'hono'
import { generateEmbedding, buildSearchQuery } from '../services/embeddings.js'
import { searchListings } from '../services/search.js'

const search = new Hono()

search.post('/api/search', async (c) => {
  const body = await c.req.json<{
    query: string
    category_id?: number
    limit?: number
  }>()

  if (!body.query?.trim()) {
    return c.json({ error: 'query is required' }, 400)
  }

  const limit = Math.min(body.limit ?? 20, 50)

  const embedding = await generateEmbedding(buildSearchQuery(body.query))
  const results = await searchListings({
    embedding,
    category_id: body.category_id,
    limit,
  })

  return c.json({
    count: results.length,
    query: body.query,
    results: results.map((r) => ({
      id: r.id,
      title: r.title,
      image_url: r.image_url,
      sold_price: r.sold_price,
      original_price: r.original_price,
      similarity: Math.round(r.similarity * 1000) / 1000,
      created_at: r.created_at,
      modified_at: r.modified_at,
    })),
  })
})

export default search
