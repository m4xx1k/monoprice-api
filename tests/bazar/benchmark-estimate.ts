/**
 * Benchmark script for the /v2/product/estimate endpoint.
 *
 * Usage:
 *   npx tsx scripts/benchmark-estimate.ts [input.json] [options]
 *
 * Options:
 *   --url   Base URL of the API  (default: http://localhost:3000)
 *   --delay Delay between requests in ms (default: 0)
 *
 * Example:
 *   npx tsx scripts/benchmark-estimate.ts data/monobazar_test.json --url http://localhost:3000
 *
 * Output: benchmark-results-<timestamp>.json
 *
 * Potential additional metrics:
 *   - similarity_score_avg: avg top-1 similarity from evidence (needs API change to expose it)
 *   - price_spread_pct: (p80-p20)/p50*100 — how wide the market range is per item
 *   - analog_count: how many analogs were found (needs API change)
 *   - category_coverage: % of DB categories represented in test set
 *   - confidence_score: if enriched endpoint used, track confidence vs accuracy correlation
 */

import { readFileSync, writeFileSync } from 'fs'

// ── Types ──

interface TestItem {
  test_id: string
  category_name: string
  title: string
  description: string
  price: string
}

interface EstimateResponse {
  price: { min: number; balanced: number; profit: number }
  days_to_sell: { min: number; max: number }
  statistics: { bargain_percentage: number }
  similar_products: { sold: unknown[]; active: unknown[] }
}

interface ApiError {
  error: string
  details?: { total_found: number; after_filter: number; min_required: number }
}

type RequestStatus = 200 | 422 | 'error'

interface ItemResult {
  test_id: string
  category_name: string
  title: string
  actual_price: number
  status: RequestStatus
  latency_ms: number
  // Populated only on status === 200
  price_min?: number
  price_balanced?: number
  price_profit?: number
  in_range?: boolean
  relative_error_pct?: number
  signed_error_pct?: number   // positive = we overestimated, negative = underestimated
  days_to_sell?: { min: number; max: number }
  analogs_sold?: number
  analogs_active?: number
  // Populated only on status === 422
  insufficient_details?: ApiError['details']
  // Populated only on status === 'error'
  error_message?: string
}

// ── Category ID mapping ──

const CATEGORY_MAP: Record<string, number> = {
  'Смартфони Apple': 4,
  'Кросівки': 512,
  'Конструктори': 743,
  'Книги та журнали': 795,
  'Колекційні фігурки': 1677,
  'Шини диски і колеса': 1261,
  'Меблі та стільці': 1320,
}

// ── Statistics helpers ──

function pct(arr: number[], p: number): number {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function latencyStats(ms: number[]) {
  if (!ms.length) return null
  return {
    avg_ms: round2(avg(ms)),
    median_ms: round2(pct(ms, 50)),
    p95_ms: round2(pct(ms, 95)),
    min_ms: Math.min(...ms),
    max_ms: Math.max(...ms),
  }
}

interface CategoryStats {
  total: number
  success_count: number
  success_rate_pct: number
  insufficient_data_count: number
  error_count: number
  latency: ReturnType<typeof latencyStats>
  // Accuracy metrics (only for successful requests)
  in_range_pct: number | null
  mean_abs_error_pct: number | null   // avg |actual - balanced| / actual * 100
  median_abs_error_pct: number | null
  bias_pct: number | null             // avg signed error: positive = we overshoot
  items: ItemResult[]
}

function computeStats(items: ItemResult[]): Omit<CategoryStats, 'items'> {
  const total = items.length
  const successful = items.filter((r) => r.status === 200)
  const success_count = successful.length
  const insufficient_data_count = items.filter((r) => r.status === 422).length
  const error_count = items.filter((r) => r.status === 'error').length

  const latency = latencyStats(items.map((r) => r.latency_ms))

  const withPrice = successful.filter((r) => r.relative_error_pct !== undefined)

  const in_range_pct = withPrice.length
    ? round2((withPrice.filter((r) => r.in_range).length / withPrice.length) * 100)
    : null

  const absErrors = withPrice.map((r) => r.relative_error_pct!)
  const signedErrors = withPrice.map((r) => r.signed_error_pct!)

  return {
    total,
    success_count,
    success_rate_pct: round2((success_count / total) * 100),
    insufficient_data_count,
    error_count,
    latency,
    in_range_pct,
    mean_abs_error_pct: absErrors.length ? round2(avg(absErrors)) : null,
    median_abs_error_pct: absErrors.length ? round2(pct(absErrors, 50)) : null,
    bias_pct: signedErrors.length ? round2(avg(signedErrors)) : null,
  }
}

// ── Core request ──

async function callEstimate(
  baseUrl: string,
  item: TestItem,
): Promise<ItemResult> {
  const actual_price = parseFloat(item.price)
  const category = CATEGORY_MAP[item.category_name]

  const t0 = Date.now()
  let status: RequestStatus = 'error'
  let result: Partial<ItemResult> = {}

  try {
    const res = await fetch(`${baseUrl}/v2/product/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: item.title,
        description: item.description,
        ...(category ? { category } : {}),
      }),
    })

    const latency_ms = Date.now() - t0

    if (res.ok) {
      const data = (await res.json()) as EstimateResponse
      status = 200

      const { min: price_min, balanced: price_balanced, profit: price_profit } = data.price
      const in_range = actual_price >= price_min && actual_price <= price_profit
      const relative_error_pct = round2(
        (Math.abs(actual_price - price_balanced) / actual_price) * 100,
      )
      const signed_error_pct = round2(
        ((price_balanced - actual_price) / actual_price) * 100,
      )

      result = {
        latency_ms,
        price_min,
        price_balanced,
        price_profit,
        in_range,
        relative_error_pct,
        signed_error_pct,
        days_to_sell: data.days_to_sell,
        analogs_sold: data.similar_products.sold.length,
        analogs_active: data.similar_products.active.length,
      }
    } else if (res.status === 422) {
      const data = (await res.json()) as ApiError
      status = 422
      result = { latency_ms, insufficient_details: data.details }
    } else {
      const text = await res.text()
      result = { latency_ms, error_message: `HTTP ${res.status}: ${text.slice(0, 200)}` }
    }
  } catch (e: any) {
    result = { latency_ms: Date.now() - t0, error_message: e.message }
  }

  return {
    test_id: item.test_id,
    category_name: item.category_name,
    title: item.title,
    actual_price,
    status,
    ...result,
  } as ItemResult
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2)
  const inputFile = args.find((a) => !a.startsWith('--')) ?? 'data/monobazar_test.json'
  const urlFlag = args.indexOf('--url')
  const baseUrl = urlFlag !== -1 ? args[urlFlag + 1] : 'http://localhost:3000'
  const delayFlag = args.indexOf('--delay')
  const delay = delayFlag !== -1 ? parseInt(args[delayFlag + 1], 10) : 0

  const items: TestItem[] = JSON.parse(readFileSync(inputFile, 'utf-8'))
  console.log(`\n▶ Benchmark: ${items.length} items → ${baseUrl}/v2/product/estimate\n`)

  const allResults: ItemResult[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    process.stdout.write(`[${String(i + 1).padStart(3)}/${items.length}] ${item.test_id} ${item.title.slice(0, 40).padEnd(40)} `)

    const result = await callEstimate(baseUrl, item)
    allResults.push(result)

    if (result.status === 200) {
      const inRange = result.in_range ? '✓' : '✗'
      console.log(`${result.latency_ms}ms  ${inRange} actual=${result.actual_price} balanced=${result.price_balanced} err=${result.relative_error_pct}%`)
    } else if (result.status === 422) {
      console.log(`${result.latency_ms}ms  — insufficient data`)
    } else {
      console.log(`${result.latency_ms}ms  ✗ error: ${result.error_message}`)
    }

    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
  }

  // ── Aggregate ──

  const byCategory = new Map<string, ItemResult[]>()
  for (const r of allResults) {
    const bucket = byCategory.get(r.category_name) ?? []
    bucket.push(r)
    byCategory.set(r.category_name, bucket)
  }

  const categories: Record<string, CategoryStats> = {}
  for (const [name, items] of Array.from(byCategory)) {
    categories[name] = { ...computeStats(items), items }
  }

  const overall = { ...computeStats(allResults), items: allResults }

  const output = {
    meta: {
      input_file: inputFile,
      base_url: baseUrl,
      total_items: items.length,
      ran_at: new Date().toISOString(),
    },
    overall,
    categories,
  }

  const outFile = `benchmark-results-${Date.now()}.json`
  writeFileSync(outFile, JSON.stringify(output, null, 2))

  // ── Summary ──
  console.log('\n── Overall ──────────────────────────────────────────')
  console.log(`  Items:           ${overall.total}`)
  console.log(`  Success rate:    ${overall.success_rate_pct}%  (${overall.success_count}/${overall.total})`)
  console.log(`  Insufficient:    ${overall.insufficient_data_count}`)
  console.log(`  Errors:          ${overall.error_count}`)
  console.log(`  In range [p20–p80]: ${overall.in_range_pct ?? 'n/a'}%`)
  console.log(`  Balanced MAE:    ${overall.mean_abs_error_pct ?? 'n/a'}%`)
  console.log(`  Bias:            ${overall.bias_pct ?? 'n/a'}%  (+= overestimate)`)
  if (overall.latency) {
    console.log(`  Latency avg/p95: ${overall.latency.avg_ms}ms / ${overall.latency.p95_ms}ms`)
  }
  console.log('\n── Per category ─────────────────────────────────────')
  for (const [name, stats] of Object.entries(categories)) {
    console.log(`  ${name.padEnd(28)} success=${stats.success_rate_pct}%  in_range=${stats.in_range_pct ?? 'n/a'}%  MAE=${stats.mean_abs_error_pct ?? 'n/a'}%  p95=${stats.latency?.p95_ms ?? '-'}ms`)
  }
  console.log(`\n✓ Full results saved to ${outFile}\n`)
}

main().catch((e) => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
