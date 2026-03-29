import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function main() {
  // 1. List all tables in public schema
  const { data: tables, error: tablesError } = await supabase
    .rpc('query', {
      sql: `
        select table_name
        from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name
      `
    })

  // Fallback: if no custom RPC, use raw query via pg
  // Since Supabase JS client doesn't expose raw SQL directly,
  // we use the REST approach below instead

  // 1. Check listings table exists by trying to select from it
  console.log('=== Tables (checking known ones) ===')

  const knownTables = ['listings', 'categories', 'users', 'products']
  for (const table of knownTables) {
    const { error, count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.log(`  ✗ ${table} — not found or no access`)
    } else {
      console.log(`  ✓ ${table} — ${count} rows`)
    }
  }

  // 2. Inspect listings table if it exists
  console.log('\n=== listings: sample row (first 1) ===')
  const { data: sample, error: sampleError } = await supabase
    .from('listings')
    .select('*')
    .limit(1)

  if (sampleError) {
    console.log('  Cannot read listings:', sampleError.message)
  } else if (sample?.length) {
    const row = sample[0]
    console.log('  Columns found:')
    for (const [key, val] of Object.entries(row)) {
      const type = val === null ? 'null' : typeof val
      const preview = val === null ? 'null' : String(val).slice(0, 60)
      console.log(`    ${key.padEnd(20)} ${type.padEnd(10)} ${preview}`)
    }
  } else {
    console.log('  Table exists but is empty')
  }

  // 3. Check if embeddings are populated
  console.log('\n=== listings: embedding coverage ===')
  const { count: total } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true })

  const { count: withEmbedding } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null)

  console.log(`  Total rows:         ${total ?? 0}`)
  console.log(`  With embedding:     ${withEmbedding ?? 0}`)
  console.log(`  Without embedding:  ${(total ?? 0) - (withEmbedding ?? 0)}`)

  // 4. Check status distribution
  console.log('\n=== listings: status breakdown ===')
  const { data: statuses } = await supabase
    .from('listings')
    .select('status')

  if (statuses?.length) {
    const counts: Record<string, number> = {}
    for (const row of statuses) {
      counts[row.status] = (counts[row.status] ?? 0) + 1
    }
    for (const [status, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status.padEnd(20)} ${count}`)
    }
  }

  // 5. Check match_listings RPC exists
  console.log('\n=== RPC: match_listings ===')
  const { error: rpcError } = await supabase.rpc('match_listings', {
    query_embedding: new Array(1536).fill(0),
    match_count: 1,
  })
  if (rpcError) {
    console.log('  ✗ Not found:', rpcError.message)
  } else {
    console.log('  ✓ Exists and callable')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
