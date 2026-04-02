import { Hono } from 'hono'
import { generateEmbedding } from '../services/embeddings.js'
import { searchListings, populateImageUrls } from '../services/search.js'
import { filterAnalogs, hasEnoughData, buildEstimateResponse } from '../services/pricer-v2.js'
import { describePhotos } from '../services/vision.js'
import type { EstimateProductRequest } from '../types/index.js'

const productV2 = new Hono()

/** Build search query from title+description and generate its embedding vector */
async function embedDescription(title: string, description: string) {
  const query = [title, description].filter(Boolean).join(' ').slice(0, 2000)
  return generateEmbedding(query)
}

// ── POST /v2/product/estimate ──
// Stateless pricing: embed description → search → respond in contract format.
// No /init required.

productV2.post('/estimate', async (c) => {
  const body = await c.req.json<EstimateProductRequest>()
  if (!body.description) {
    return c.json({ error: 'description is required' }, 400)
  }

  const t0 = Date.now()

  const embedding = await embedDescription(body.title ?? '', body.description)
  const tEmbed = Date.now()

  const rawAnalogs = await searchListings({
    embedding,
    category_id: body.category,
    statuses: ['SOLD', 'ACTIVE'],
    limit: 20,
  })
  const tSearch = Date.now()

  const analogs = await populateImageUrls(rawAnalogs)
  const tPhotos = Date.now()

  const filtered = filterAnalogs(analogs)

  if (!hasEnoughData(filtered)) {
    console.log(`[estimate] insufficient data: ${filtered.length} analogs after filtering (${analogs.length} raw) | total: ${Date.now() - t0}ms`)
    return c.json({
      error: 'Недостатньо даних для точної оцінки',
      details: { total_found: analogs.length, after_filter: filtered.length, min_required: 3 },
    }, 422)
  }

  const result = buildEstimateResponse(filtered)
  const tDone = Date.now()

  console.log(
    `[estimate]` +
    ` | embedding: ${tEmbed - t0}ms` +
    ` | db_search: ${tSearch - tEmbed}ms` +
    ` | db_photos: ${tPhotos - tSearch}ms` +
    ` | total: ${tDone - t0}ms` +
    ` | raw: ${analogs.length} | filtered: ${filtered.length}`
  )

  return c.json(result)
})

// ── POST /v2/product/warmup ──
// Accepts photos, runs Gemini to extract a description, generates an embedding,
// and fires a DB search in the background to warm Postgres buffer cache
// before the user reaches the /description step.

productV2.post('/warmup', async (c) => {
  const raw = await c.req.parseBody({ all: true })
  const photos = (Array.isArray(raw['photos']) ? raw['photos'] : [raw['photos']]).filter(
    (p): p is File => p instanceof File
  )

  if (!photos.length) {
    return c.json({ error: 'at least one photo is required' }, 400)
  }

  // Respond immediately — warmup runs in background (like `go func(){}()` in Go)
  ;(async () => {
    try {
      const t0 = Date.now()
      const description = await describePhotos(photos)
      const tGemini = Date.now()

      if (!description) {
        console.warn('[warmup] vision returned empty description')
        return
      }

      console.log(`[warmup] description: "${description}"`)


      const embedding = await generateEmbedding(description)
      const tEmbed = Date.now()

      await searchListings({ embedding, limit: 20, statuses: ['SOLD', 'ACTIVE'] })
      const tDone = Date.now()

      console.log(`[warmup] gemini: ${tGemini - t0}ms | embed: ${tEmbed - tGemini}ms | db: ${tDone - tEmbed}ms | total: ${tDone - t0}ms`)
    } catch (e: any) {
      console.warn(`[warmup] failed: ${e.message}`)
    }
  })()

  return c.body(null, 204)
})

export default productV2
