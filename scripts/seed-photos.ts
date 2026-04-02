import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://resale-media.monobazar.com.ua/' // <-- встав сюди базовий URL, напр. 'https://cdn.example.com/'
const BATCH_SIZE = 100
const HEAD_TIMEOUT_MS = 5000

// ────────────────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

type PhotoEntry = {
  advertisement_id: string
  s3_key: string
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function err(msg: string) {
  console.error(`[${new Date().toISOString()}] ERROR: ${msg}`)
}

async function headOk(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS)
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

async function resolveImageUrl(keys: string[]): Promise<string | null> {
  for (const key of keys) {
    const url = `${BASE_URL}${key}`
    const ok = await headOk(url)
    if (ok) {
      return url
    }
    log(`  HEAD failed for key "${key}", trying next...`)
  }
  return null
}

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error('Usage: tsx scripts/seed-photos.ts <path-to-json>')
    process.exit(1)
  }

  if (!BASE_URL) {
    console.error('BASE_URL is not set in seed-photos.ts. Fill it in and re-run.')
    process.exit(1)
  }

  log(`Loading photos JSON from: ${resolve(filePath)}`)
  const raw: PhotoEntry[] = JSON.parse(readFileSync(resolve(filePath), 'utf-8'))
  log(`Loaded ${raw.length} entries`)

  // Build map: adv_id → [s3_key, ...]  (preserves order)
  const photoMap = new Map<string, string[]>()
  for (const entry of raw) {
    const list = photoMap.get(entry.advertisement_id) ?? []
    list.push(entry.s3_key)
    photoMap.set(entry.advertisement_id, list)
  }

  const advIds = [...photoMap.keys()]
  log(`Unique advertisement_ids: ${advIds.length}`)

  let updated = 0
  let skipped = 0
  let notFound = 0
  let noValidUrl = 0

  // Process in batches to avoid huge IN queries
  for (let i = 0; i < advIds.length; i += BATCH_SIZE) {
    const batch = advIds.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(advIds.length / BATCH_SIZE)

    log(`Batch ${batchNum}/${totalBatches}: fetching ${batch.length} listings from Supabase...`)

    const { data: listings, error } = await supabase
      .from('listings')
      .select('id, external_id, image_url')
      .in('external_id', batch)

    if (error) {
      err(`Supabase fetch failed for batch ${batchNum}: ${error.message}`)
      skipped += batch.length
      continue
    }

    // Index found listings by external_id
    const found = new Map(listings.map((l) => [l.external_id, l]))

    for (const advId of batch) {
      const listing = found.get(advId)
      if (!listing) {
        log(`  [SKIP] adv_id="${advId}" not found in DB`)
        notFound++
        continue
      }

      const keys = photoMap.get(advId)!
      const imageUrl = await resolveImageUrl(keys)

      if (!imageUrl) {
        err(`  [NO_URL] adv_id="${advId}" — all ${keys.length} key(s) returned non-OK HEAD`)
        noValidUrl++
        continue
      }

      const { error: updateErr } = await supabase
        .from('listings')
        .update({ image_url: imageUrl })
        .eq('id', listing.id)

      if (updateErr) {
        err(`  [FAIL] adv_id="${advId}" update error: ${updateErr.message}`)
        skipped++
      } else {
        log(`  [OK] adv_id="${advId}" → ${imageUrl}`)
        updated++
      }
    }

    log(`Batch ${batchNum}/${totalBatches} done. Progress: ${updated} updated so far.`)
  }

  console.log('\n── Summary ─────────────────────────────────')
  console.log(`  Updated:      ${updated}`)
  console.log(`  Not in DB:    ${notFound}`)
  console.log(`  No valid URL: ${noValidUrl}`)
  console.log(`  Errors:       ${skipped}`)
  console.log('────────────────────────────────────────────')
}

main().catch((e) => {
  err(String(e))
  process.exit(1)
})
