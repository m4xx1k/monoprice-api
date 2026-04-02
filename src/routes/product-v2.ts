import { Hono } from 'hono'
import { generateEmbedding } from '../services/embeddings.js'
import { searchListings, findCandidateIds, populateImageUrls } from '../services/search.js'
import { filterAnalogs, hasEnoughData, buildEnrichedResponse, buildEstimateResponse } from '../services/pricer-v2.js'
import { describePhotos } from '../services/vision.js'
import type { InitBody, DescriptionBody } from '../types/index.js'

// Pre-filtered candidate IDs, populated by /init and consumed by /description
const candidateCache = new Map<string, number[]>()

const productV2 = new Hono()

// ── Helpers ──

/** Validate multipart init body — returns null if any required field is missing */
function parseInitBody(body: Record<string, unknown>): InitBody | null {
  const id = body['id'] as string
  const title = body['title'] as string
  const category = body['category'] as string
  const photos = body['photos']
  if (!id || !title || !category || !photos) return null
  return { id, title, category, photos }
}

/** Build search query from title+description and generate its embedding vector */
async function embedDescription(title: string, description: string) {
  const query = [title, description].filter(Boolean).join(' ').slice(0, 2000)
  return generateEmbedding(query)
}

// ── POST /v1/product/init ──
// Accepts multipart form with photos. Finds candidate listing IDs
// by title+category and caches them for the subsequent /description call.

productV2.post('/init', async (c) => {
  const raw = await c.req.parseBody({ all: true })
  const body = parseInitBody(raw)
  if (!body) {
    return c.json({ error: 'id, title, category and at least one photo are required' }, 400)
  }

  const t0 = Date.now()
  const categoryId = parseInt(body.category, 10)
  const candidates = await findCandidateIds(body.title, categoryId)
  candidateCache.set(body.id, candidates)

  console.log(`[init] id=${body.id} | title="${body.title}" | category=${body.category} | candidates: ${candidates.length} | ${Date.now() - t0}ms`)

  return c.body(null, 204)
})

// ── POST /v1/product/description ──
// Pipeline: embed → search → filter (similarity threshold) → compute metrics → respond

productV2.post('/description', async (c) => {
  const body = await c.req.json<DescriptionBody>()
  if (!body.id || !body.description) {
    return c.json({ error: 'id and description are required' }, 400)
  }

  const t0 = Date.now()

  // Step 1a: Generate embedding
  const embedding = await embedDescription(body.title, body.description)
  const tEmbed = Date.now()

  // Step 1b: Search analogs (narrowed by cached candidates if /init was called)
  const candidates = candidateCache.get(body.id)
  const rawAnalogs = await searchListings({
    embedding,
    category_id: body.category,
    statuses: ['SOLD', 'ACTIVE'],
    limit: 20,
    ...(candidates?.length ? { candidate_ids: candidates } : {}),
  })
  const tSearch = Date.now()

  const analogs = await populateImageUrls(rawAnalogs)
  const tPhotos = Date.now()

  // Step 1c: Filter by similarity threshold
  const filtered = filterAnalogs(analogs)

  // Step 1d: Check minimum data requirement
  if (!hasEnoughData(filtered)) {
    console.log(`[description] id=${body.id} | insufficient data: ${filtered.length} analogs after filtering (${analogs.length} raw) | total: ${Date.now() - t0}ms`)
    return c.json({
      error: 'Недостатньо даних для точної оцінки',
      details: {
        total_found: analogs.length,
        after_filter: filtered.length,
        threshold: 0.75,
        min_required: 3,
      },
    }, 422)
  }

  // Steps 2-4: Compute metrics, generate templates, build response
  const result = buildEnrichedResponse(filtered)
  const tCompute = Date.now()

  console.log(
    `[description] id=${body.id}` +
    ` | embedding: ${tEmbed - t0}ms` +
    ` | db_search: ${tSearch - tEmbed}ms` +
    ` | db_photos: ${tPhotos - tSearch}ms` +
    ` | compute: ${tCompute - tPhotos}ms` +
    ` | total: ${tCompute - t0}ms` +
    ` | raw: ${analogs.length} | filtered: ${filtered.length}` +
    ` | candidates: ${candidates?.length ?? 'none (full search)'}`
  )
  console.log(`[description] confidence: ${result.market_arguments.confidence_score}% | fast: ${result.pricing.strategies.fast.expected_revenue} | balanced: ${result.pricing.strategies.balanced.expected_revenue} | profit: ${result.pricing.strategies.profit.expected_revenue}`)

  return c.json(result)
})

// ── POST /v2/product/estimate ──
// Stateless pricing: embed description → search → respond in contract format.
// No /init required.

productV2.post('/estimate', async (c) => {
  const body = await c.req.json<{ title?: string; description: string; category?: number }>()
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

// ── POST /v1/product/cleanup ──
// Removes cached candidates for a given product ID

productV2.post('/cleanup', async (c) => {
  const body = await c.req.json<{ id: string }>()
  if (!body.id) {
    return c.json({ error: 'id is required' }, 400)
  }

  candidateCache.delete(body.id)
  return c.body(null, 204)
})

export default productV2
