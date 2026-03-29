import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

type RawListing = {
  advertisement_id: string
  status: string
  title: string
  description: string
  original_price: string
  sold_price: string
  sold_via_bargain: string
  created_at: string
  modified_at: string
  category_id: string
}

const BATCH_SIZE = 100

function load<T>(filename: string): T {
  return JSON.parse(readFileSync(resolve('data', filename), 'utf-8'))
}

function toNumber(val: string): number | null {
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

async function main() {
  const raw = load<RawListing[]>('hackaton_advertisements_with_id.json')
  const categories = load<Record<string, string>>('category_dictionary.json')

  const rows = raw.map((r) => ({
    external_id: r.advertisement_id,
    status: r.status,
    title: r.title,
    description: r.description,
    original_price: toNumber(r.original_price),
    sold_price: toNumber(r.sold_price),
    sold_via_bargain: r.sold_via_bargain === 'true',
    category_id: parseInt(r.category_id, 10) || null,
    category_name: categories[r.category_id] ?? null,
    created_at: r.created_at,
    modified_at: r.modified_at,
    image_url: null,
    embedding: null,
  }))

  console.log(`Seeding ${rows.length} listings in batches of ${BATCH_SIZE}...`)

  let inserted = 0
  let skipped = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    const { error } = await supabase
      .from('listings')
      .upsert(batch, { onConflict: 'external_id' })

    if (error) {
      console.error(`Batch ${i / BATCH_SIZE + 1} error:`, error.message)
      skipped += batch.length
    } else {
      inserted += batch.length
      process.stdout.write(`\r${inserted} / ${rows.length}`)
    }
  }

  console.log(`\nDone. Inserted/updated: ${inserted}, failed: ${skipped}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
