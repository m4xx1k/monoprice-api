/**
 * Pricing runner — sends scraped OLX products through the /description endpoint.
 *
 * Usage:  npx tsx tests/run-pricing.ts <input.json> [api_base_url]
 *
 * Reads products from tests/data/<input>.json (output of olx-scraper),
 * calls POST /v1/product/description for each, and saves combined results
 * to tests/data/<input>-results.json.
 *
 * Also runs:
 *   - Price accuracy check (is OLX price within API range?)
 *   - Similarity score analysis (top-3 avg, low-confidence warnings)
 *   - Regression snapshot (compare with previous run, flag >15% price drift)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { EnrichedPriceResponse } from '../../src/types/index.js'

// ── Types ──

type OlxProduct = {
  title: string
  description: string
  price: number | null
  currency: string
  link: string
  photo: string | null
}

type PriceAccuracy = {
  olx_price: number
  in_range: boolean             // olx_price within [fast.expected_revenue, profit.expected_revenue]
  deviation_pct: number | null  // % distance from balanced.expected_revenue (negative = below)
}

type SimilarityAnalysis = {
  top3_avg: number | null
  low_confidence: boolean    // true if top3_avg < 0.7
  match_count: number
}

type PricingResult = {
  olx: OlxProduct
  api_response: unknown | null
  error: string | null
  latency_ms: number | null
  price_accuracy: PriceAccuracy | null
  similarity: SimilarityAnalysis | null
}

type RunSummary = {
  run_at: string
  source_url: string | null
  total: number
  ok: number
  fail: number
  in_range: number
  with_price: number
  low_similarity: number
  latency: { avg: number | null; min: number | null; max: number | null }
}

type RunReport = {
  summary: RunSummary
  results: PricingResult[]
}

type Snapshot = {
  run_at: string
  results: PricingResult[]
}

// ── Config ──

const DELAY_MS = 2000
const LOW_SIMILARITY_THRESHOLD = 0.7
const REGRESSION_DRIFT_THRESHOLD_PCT = 15  // flag if balanced price drifts more than this

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Analysis helpers ──

function checkPriceAccuracy(olxPrice: number, strategies: EnrichedPriceResponse['pricing']['strategies']): PriceAccuracy {
  const fast = strategies.fast.expected_revenue
  const balanced = strategies.balanced.expected_revenue
  const profit = strategies.profit.expected_revenue
  const in_range = olxPrice >= fast && olxPrice <= profit
  const deviation_pct = balanced > 0
    ? Math.round(((olxPrice - balanced) / balanced) * 100)
    : null
  return { olx_price: olxPrice, in_range, deviation_pct }
}

function analyzeSimilarity(evidence: EnrichedPriceResponse['evidence']): SimilarityAnalysis {
  const top3 = evidence.top_similar_products.slice(0, 3)
  const scores = top3.map((p) => p.similarity)
  const top3_avg = scores.length
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000
    : null
  return {
    top3_avg,
    low_confidence: top3_avg !== null && top3_avg < LOW_SIMILARITY_THRESHOLD,
    match_count: evidence.total_found,
  }
}

// ── Regression: compare current balanced prices against previous snapshot ──

function runRegression(current: PricingResult[], snapshotPath: string): void {
  if (!existsSync(snapshotPath)) {
    console.log('  (no previous snapshot found — skipping regression)')
    return
  }

  const prev: Snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
  const prevMap = new Map(
    prev.results
      .filter((r) => r.olx.link && r.api_response)
      .map((r) => [r.olx.link, (r.api_response as EnrichedPriceResponse)?.pricing?.strategies?.balanced?.expected_revenue])
  )

  let drifted = 0
  for (const result of current) {
    if (!result.api_response || result.error) continue
    const currentBalanced = (result.api_response as EnrichedPriceResponse)?.pricing?.strategies?.balanced?.expected_revenue
    const prevBalanced = prevMap.get(result.olx.link)
    if (!currentBalanced || !prevBalanced) continue

    const drift = Math.abs((currentBalanced - prevBalanced) / prevBalanced) * 100
    if (drift > REGRESSION_DRIFT_THRESHOLD_PCT) {
      console.log(
        `  ⚠ REGRESSION: "${result.olx.title.slice(0, 50)}" balanced ${prevBalanced} → ${currentBalanced} (${drift.toFixed(1)}% drift)`,
      )
      drifted++
    }
  }

  if (drifted === 0) {
    console.log(`  ✓ No regressions detected (threshold: ${REGRESSION_DRIFT_THRESHOLD_PCT}%)`)
  } else {
    console.log(`  ${drifted} product(s) exceeded drift threshold`)
  }
}

// ── Main ──
const CATEGORY_ID = 4;
async function main() {
  const inputName = process.argv[2]
  if (!inputName) {
    console.error('Usage: npx tsx tests/run-pricing.ts <input_name> [api_base_url]')
    console.error('  e.g.: npx tsx tests/run-pricing.ts olx-products http://localhost:4000')
    process.exit(1)
  }

  const apiBase = (process.argv[3] || 'http://localhost:4000').replace(/\/$/, '')
  const urlArg = process.argv.indexOf('--url')
  const sourceUrl = urlArg !== -1 ? (process.argv[urlArg + 1] ?? null) : null
  const baseName = inputName.replace(/\.json$/, '')
  const dataDir = resolve(import.meta.dirname!, 'data')

  const inputPath = inputName.includes('/')
    ? resolve(inputName.endsWith('.json') ? inputName : inputName + '.json')
    : resolve(dataDir, baseName + '.json')
  const outputPath = inputName.includes('/')
    ? resolve(inputName.replace(/\.json$/, '') + '-results.json')
    : resolve(dataDir, baseName + '-results.json')
  // Snapshot stores the previous run for regression comparison
  const snapshotPath = inputName.includes('/')
    ? resolve(inputName.replace(/\.json$/, '') + '-snapshot.json')
    : resolve(dataDir, baseName + '-snapshot.json')

  const products: OlxProduct[] = JSON.parse(readFileSync(inputPath, 'utf-8'))
  console.log(`Loaded ${products.length} products from ${inputPath}`)
  console.log(`API base: ${apiBase}\n`)

  const results: PricingResult[] = []

  for (let i = 0; i < products.length; i++) {
    const product = products[i]!
    const sessionId = randomUUID()

    console.log(`[${i + 1}/${products.length}] "${product.title.slice(0, 60)}"`)

    if (!product.description && !product.title) {
      console.log('  ⚠ Skipping — no title or description')
      results.push({ olx: product, api_response: null, error: 'no title or description', latency_ms: null, price_accuracy: null, similarity: null })
      continue
    }

    try {
      const t0 = Date.now()
      const res = await fetch(`${apiBase}/v2/product/description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sessionId,
          title: product.title,
          description: product.description,
          category: CATEGORY_ID,
        }),
      })
      const latency_ms = Date.now() - t0
      const body = await res.json() as EnrichedPriceResponse

      if (!res.ok) {
        console.log(`  ✗ ${res.status}: ${JSON.stringify(body)} (${latency_ms}ms)`)
        results.push({ olx: product, api_response: body, error: `HTTP ${res.status}`, latency_ms, price_accuracy: null, similarity: null })
      } else {
        const strategies = body.pricing.strategies
        const fast = strategies.fast.expected_revenue
        const balanced = strategies.balanced.expected_revenue
        const profit = strategies.profit.expected_revenue

        const price_accuracy = product.price !== null ? checkPriceAccuracy(product.price, strategies) : null
        const similarity = analyzeSimilarity(body.evidence)

        const inRangeTag = price_accuracy
          ? (price_accuracy.in_range ? '✓ in range' : `✗ out of range ${price_accuracy.deviation_pct! > 0 ? '+' : ''}${price_accuracy.deviation_pct}%`)
          : 'no olx price'
        const simTag = similarity.low_confidence
          ? `⚠ low sim ${similarity.top3_avg}`
          : `sim ${similarity.top3_avg}`

        console.log(
          `  ✓ fast=${fast} balanced=${balanced} profit=${profit} | olx=${product.price} ${inRangeTag} | ${simTag} | ${latency_ms}ms`,
        )

        results.push({ olx: product, api_response: body, error: null, latency_ms, price_accuracy, similarity })
      }
    } catch (err) {
      const msg = (err as Error).message
      console.log(`  ✗ ${msg}`)
      results.push({ olx: product, api_response: null, error: msg, latency_ms: null, price_accuracy: null, similarity: null })
    }

    if (i < products.length - 1) await sleep(DELAY_MS)
  }

  // ── Regression check ──
  console.log('\nRegression check:')
  runRegression(results, snapshotPath)

  // Save current run as the new snapshot for next time
  const snapshot: Snapshot = { run_at: new Date().toISOString(), results }
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8')

  // ── Summary ──
  const ok = results.filter((r) => !r.error).length
  const fail = results.length - ok

  const latencies = results.map((r) => r.latency_ms).filter((v): v is number => v !== null)
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null

  const withPrice = results.filter((r) => r.price_accuracy !== null)
  const inRange = withPrice.filter((r) => r.price_accuracy!.in_range).length
  const lowSim = results.filter((r) => r.similarity?.low_confidence).length

  const summary: RunSummary = {
    run_at: new Date().toISOString(),
    source_url: sourceUrl,
    total: results.length,
    ok,
    fail,
    in_range: inRange,
    with_price: withPrice.length,
    low_similarity: lowSim,
    latency: {
      avg: avgLatency,
      min: latencies.length ? Math.min(...latencies) : null,
      max: latencies.length ? Math.max(...latencies) : null,
    },
  }

  const report: RunReport = { summary, results }
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8')

  console.log(`\nDone! ${ok} success, ${fail} failed`)
  if (avgLatency !== null) {
    console.log(`Latency    — avg: ${avgLatency}ms | min: ${summary.latency.min}ms | max: ${summary.latency.max}ms`)
  }
  if (withPrice.length) {
    console.log(`Price acc  — ${inRange}/${withPrice.length} OLX prices within API range`)
  }
  if (results.some((r) => r.similarity)) {
    console.log(`Similarity — ${lowSim} product(s) with low confidence (< ${LOW_SIMILARITY_THRESHOLD})`)
  }
  console.log(`Results saved to ${outputPath}`)
  console.log(`Snapshot   → ${snapshotPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
