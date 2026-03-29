import { Hono } from 'hono'
import { generateEmbedding, buildSearchQuery } from '../services/embeddings.js'
import { searchListings, findCandidateIds, populateImageUrls } from '../services/search.js'
import { calculatePrice } from '../services/pricer.js'
import type { InitBody, DescriptionBody } from '../types/index.js'

// Pre-filtered candidate IDs, populated by /init and consumed by /description
const candidateCache = new Map<string, number[]>()

const product = new Hono()

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
  const query = buildSearchQuery([title, description].filter(Boolean).join(' '))
  return generateEmbedding(query)
}

/** Search for similar sold listings and populate their image URLs */
async function findAnalogs(embedding: number[], category?: number, candidateIds?: number[]) {
  const rawAnalogs = await searchListings({
    embedding,
    category_id: category,
    ...(candidateIds?.length ? { candidate_ids: candidateIds } : {}),
  })
  return populateImageUrls(rawAnalogs)
}

// ── POST /v1/product/init ──
// Accepts multipart form with photos. Finds candidate listing IDs
// by title+category and caches them for the subsequent /description call.

product.post('/v1/product/init', async (c) => {
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
// Pipeline: embed query → search analogs (narrowed by cached candidates) → calculate price

product.post('/v1/product/description', async (c) => {
  const body = await c.req.json<DescriptionBody>()
  if (!body.id || !body.description) {
    return c.json({ error: 'id and description are required' }, 400)
  }

  const t0 = Date.now()

  const embedding = await embedDescription(body.title, body.description)
  const tEmbed = Date.now()

  const candidates = candidateCache.get(body.id)
  const analogs = await findAnalogs(embedding, body.category, candidates)
  const tSearch = Date.now()

  if (!analogs.length) {
    return c.json({ error: 'Не знайдено схожих товарів' }, 422)
  }

  const result = calculatePrice(analogs)
  const tTotal = Date.now()

  console.log(`[pricing] id=${body.id} | embedding: ${tEmbed - t0}ms | search+photos: ${tSearch - tEmbed}ms | total: ${tTotal - t0}ms | analogs: ${analogs.length} | candidates: ${candidates?.length ?? 'none (full search)'}`)
  console.log(`[pricing] top match: "${analogs[0].title}" similarity=${analogs[0].similarity.toFixed(3)} sold=${analogs[0].sold_price}`)

  return c.json(result)
})

// ── POST /v1/product/cleanup ──
// Removes cached candidates for a given product ID

product.post('/v1/product/cleanup', async (c) => {
  const body = await c.req.json<{ id: string }>()
  if (!body.id) {
    return c.json({ error: 'id is required' }, 400)
  }

  candidateCache.delete(body.id)
  return c.body(null, 204)
})

export default product
