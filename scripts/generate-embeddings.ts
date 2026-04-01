import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
})

const MODEL = 'openai/text-embedding-3-small'
const DIMS = 1536
const BATCH_SIZE = 50
const RATE_DELAY_MS = 500
const MAX_RETRIES = 3

function buildText(row: { title: string | null; description: string | null }): string {
  return [row.title, row.description].filter(Boolean).join(' ').slice(0, 4000)
}

function isValidEmbedding(vec: number[]): boolean {
  return (
    Array.isArray(vec) &&
    vec.length === DIMS &&
    !vec.every((v) => v === 0) &&
    vec.every((v) => Number.isFinite(v))
  )
}

async function embed(texts: string[]): Promise<number[][]> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await openai.embeddings.create({ model: MODEL, input: texts })
      return res.data.map((d) => d.embedding)
    } catch (err: any) {
      const isLast = attempt === MAX_RETRIES
      const delay = (err?.status === 429 ? 5000 : 1000) * attempt
      console.error(`  API error (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`)
      if (isLast) throw err
      console.log(`  Retrying in ${delay / 1000}s...`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}

async function updateRow(id: number, embedding: number[]): Promise<boolean> {
  const { error } = await supabase
    .from('listings')
    .update({ embedding } as any)
    .eq('id', id)

  if (error) {
    console.error(`  DB update failed for row ${id}: ${error.message}`)
    return false
  }
  return true
}

// CLI arg: optional category_id filter
// Usage: npx tsx scripts/generate-embeddings.ts [category_id]
const CATEGORY_FILTER = process.argv[2] ? parseInt(process.argv[2], 10) : null

async function main() {
  if (CATEGORY_FILTER !== null) {
    console.log(`Filtering by category_id: ${CATEGORY_FILTER}\n`)
  }

  // --- stats ---
  let totalQuery = supabase.from('listings').select('*', { count: 'exact', head: true }).neq('status', 'DELETED')
  let doneQuery = supabase.from('listings').select('*', { count: 'exact', head: true }).neq('status', 'DELETED').not('embedding', 'is', null)

  if (CATEGORY_FILTER !== null) {
    totalQuery = totalQuery.eq('category_id', CATEGORY_FILTER)
    doneQuery = doneQuery.eq('category_id', CATEGORY_FILTER)
  }

  const { count: total, error: countErr } = await totalQuery
  if (countErr) {
    console.error('DB error:', countErr.message)
    process.exit(1)
  }

  const { count: done } = await doneQuery

  const remaining = (total ?? 0) - (done ?? 0)
  console.log(`Total: ${total}  |  With embedding: ${done}  |  Remaining: ${remaining}`)

  if (remaining === 0) {
    console.log('Nothing to do.')
    return
  }

  console.log(`\nModel: ${MODEL}  |  Batch: ${BATCH_SIZE}  |  Delay: ${RATE_DELAY_MS}ms\n`)

  let processed = 0
  let failed = 0
  let consecutiveErrors = 0
  const startTime = Date.now()

  while (true) {
    // Fetch rows without embeddings, ordered by id for stable pagination
    let fetchQuery = supabase
      .from('listings')
      .select('id, title, description')
      .neq('status', 'DELETED')
      .is('embedding', null)
      .order('id')
      .limit(BATCH_SIZE)

    if (CATEGORY_FILTER !== null) {
      fetchQuery = fetchQuery.eq('category_id', CATEGORY_FILTER)
    }

    const { data: rows, error: fetchErr } = await fetchQuery

    if (fetchErr) {
      console.error('\nFetch error:', fetchErr.message)
      break
    }
    if (!rows?.length) break

    const texts = rows.map(buildText)

    // Skip batch if all texts are empty
    const nonEmpty = texts.filter((t) => t.trim()).length
    if (nonEmpty === 0) {
      console.warn(`  Batch of ${rows.length} rows has no text content, skipping`)
      // Mark these with a zero-length marker so we don't loop forever?
      // No — better to break and let the user investigate.
      break
    }

    let embeddings: number[][]
    try {
      embeddings = await embed(texts)
      consecutiveErrors = 0
    } catch {
      consecutiveErrors++
      failed += rows.length
      if (consecutiveErrors >= 3) {
        console.error('\n3 consecutive API failures. Stopping.')
        break
      }
      continue
    }

    // Validate and write each row individually via update (not upsert)
    for (let i = 0; i < rows.length; i++) {
      const vec = embeddings[i]
      if (!isValidEmbedding(vec)) {
        console.error(`  Row ${rows[i].id}: invalid embedding (dims=${vec?.length}), skipped`)
        failed++
        continue
      }

      const ok = await updateRow(rows[i].id, vec)
      if (ok) {
        processed++
      } else {
        failed++
      }
    }

    // Progress
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
    const pct = ((processed / remaining) * 100).toFixed(1)
    const rps = (processed / ((Date.now() - startTime) / 1000)).toFixed(1)
    process.stdout.write(`\r${processed}/${remaining} (${pct}%) | failed: ${failed} | ${elapsed}s | ${rps} rows/s`)

    await new Promise((r) => setTimeout(r, RATE_DELAY_MS))
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n\n=== Done ===`)
  console.log(`  Processed: ${processed}`)
  console.log(`  Failed:    ${failed}`)
  console.log(`  Time:      ${elapsed}s`)
  if (failed > 0) console.log(`  Re-run to retry failed rows.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
