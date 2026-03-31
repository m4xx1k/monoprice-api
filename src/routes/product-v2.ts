import { Hono } from 'hono'
import { generateEmbedding } from '../services/embeddings.js'
import { searchListings, findCandidateIds, populateImageUrls } from '../services/search.js'
import { filterAnalogs, hasEnoughData, buildEnrichedResponse } from '../services/pricer-v2.js'
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
  const analogs = await populateImageUrls(rawAnalogs)
  const tSearch = Date.now()

  // Step 1c: Filter by similarity threshold
  const filtered = filterAnalogs(analogs)

  // Step 1d: Check minimum data requirement
  if (!hasEnoughData(filtered)) {
    console.log(`[pricing] id=${body.id} | insufficient data: ${filtered.length} analogs after filtering (${analogs.length} raw) | ${Date.now() - t0}ms`)
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
  const tTotal = Date.now()

  console.log(`[pricing] id=${body.id} | embedding: ${tEmbed - t0}ms | search+photos: ${tSearch - tEmbed}ms | total: ${tTotal - t0}ms | raw: ${analogs.length} | filtered: ${filtered.length} | candidates: ${candidates?.length ?? 'none (full search)'}`)
  console.log(`[pricing] confidence: ${result.market_arguments.confidence_score}% | fast: ${result.pricing.strategies.fast.expected_revenue} | balanced: ${result.pricing.strategies.balanced.expected_revenue} | profit: ${result.pricing.strategies.profit.expected_revenue}`)

  return c.json(result)
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
