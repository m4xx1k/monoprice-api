import { Hono } from 'hono'
import { generateEmbedding, buildSearchQuery } from '../services/embeddings.js'
import { searchListings, findCandidateIds, populateImageUrls } from '../services/search.js'
import { calculatePrice } from '../services/pricer.js'

// In-memory store: product id → pre-filtered candidate listing IDs
const candidateCache = new Map<string, number[]>()

const product = new Hono()

product.post('/v1/product/init', async (c) => {
  const body = await c.req.parseBody({ all: true })

  const id = body['id'] as string
  const title = body['title'] as string
  const category = body['category'] as string
  const photos = body['photos']

  if (!id || !title || !category || !photos) {
    return c.json({ error: 'id, title, category and at least one photo are required' }, 400)
  }

  const t0 = Date.now()
  const candidates = await findCandidateIds(title, parseInt(category, 10))
  candidateCache.set(id, candidates)

  console.log(`[init] id=${id} | title="${title}" | category=${category} | candidates: ${candidates.length} | ${Date.now() - t0}ms`)

  return c.body(null, 204)
})

product.post('/v1/product/description', async (c) => {
  const body = await c.req.json<{
    id: string
    title: string
    description: string
    category?: number
  }>()

  if (!body.id || !body.description) {
    return c.json({ error: 'id and description are required' }, 400)
  }

  const t0 = Date.now()

  const query = buildSearchQuery(
    [body.title, body.description].filter(Boolean).join(' ')
  )
  const embedding = await generateEmbedding(query)
  const tEmbed = Date.now()

  const candidates = candidateCache.get(body.id)

  const rawAnalogs = await searchListings({
    embedding,
    category_id: body.category,
    ...(candidates?.length ? { candidate_ids: candidates } : {}),
  })
  const tSearch = Date.now()

  const analogs = await populateImageUrls(rawAnalogs)
  const tPhotos = Date.now()

  // Clean up cache after use
  candidateCache.delete(body.id)

  if (!analogs.length) {
    return c.json({ error: 'Не знайдено схожих товарів' }, 422)
  }

  const result = calculatePrice(analogs, body.description)
  const tTotal = Date.now()

  console.log(`[pricing] id=${body.id} | embedding: ${tEmbed - t0}ms | search: ${tSearch - tEmbed}ms | photos: ${tPhotos - tSearch}ms | total: ${tTotal - t0}ms | analogs: ${analogs.length} | candidates: ${candidates?.length ?? 'none (full search)'}`)
  console.log(`[pricing] top match: "${analogs[0].title}" similarity=${analogs[0].similarity.toFixed(3)} sold=${analogs[0].sold_price}`)

  return c.json(result)
})

export default product
