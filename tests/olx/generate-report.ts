/**
 * Generates an HTML report from a run-pricing results JSON.
 *
 * Usage:  npx tsx tests/generate-report.ts <results.json>
 *   e.g.: npx tsx tests/generate-report.ts tests/data/kolesa-results.json
 *
 * Output: same path but .html
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import type { EnrichedPriceResponse } from '../../src/types/index.js'

// ── Local types (mirror run-pricing.ts) ──

type OlxProduct = { title: string; price: number | null; currency: string; link: string; photo: string | null }
type PriceAccuracy = { in_range: boolean; deviation_pct: number | null }
type SimilarityAnalysis = { top3_avg: number | null; low_confidence: boolean; match_count: number }

type PricingResult = {
  olx: OlxProduct
  api_response: EnrichedPriceResponse | null
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

type RunReport = { summary: RunSummary; results: PricingResult[] }

// ── Helpers ──

function pct(n: number | null) {
  if (n === null) return '—'
  return (n > 0 ? '+' : '') + n + '%'
}

function buildPriceSection(olx: number | null, fast: number, balanced: number, profit: number, devPct: number | null): string {
  const allVals = olx ? [fast, balanced, profit, olx] : [fast, balanced, profit]
  const min = Math.min(...allVals) * 0.88
  const max = Math.max(...allVals) * 1.12
  const range = max - min
  const pos = (v: number) => Math.round(((v - min) / range) * 100)

  const olxMarker = olx !== null ? `
    <div class="marker-olx" style="left:${pos(olx)}%">
      <div class="marker-olx-val">${olx} ₴${devPct !== null ? `<span class="dev">${devPct > 0 ? '+' : ''}${devPct}%</span>` : ''}</div>
      <div class="marker-olx-pin"></div>
    </div>` : ''

  return `
  <div class="price-scale">
    <div class="scale-track">
      <div class="scale-range" style="left:${pos(fast)}%;width:${pos(profit) - pos(fast)}%"></div>
      <div class="scale-mark" style="left:${pos(fast)}%"><span class="scale-val">${fast}</span><span class="scale-lbl">швидко</span></div>
      <div class="scale-mark scale-mark-bal" style="left:${pos(balanced)}%"><span class="scale-val">${balanced} ₴</span><span class="scale-lbl">баланс</span></div>
      <div class="scale-mark" style="left:${pos(profit)}%"><span class="scale-val">${profit}</span><span class="scale-lbl">максимум</span></div>
      ${olxMarker}
    </div>
  </div>`
}

function resultCard(r: PricingResult, i: number): string {
  const api = r.api_response
  const s   = api?.pricing?.strategies

  const fast      = s?.fast?.expected_revenue ?? null
  const balanced  = s?.balanced?.expected_revenue ?? null
  const profit    = s?.profit?.expected_revenue ?? null
  const confidence      = api?.market_arguments?.confidence_score ?? null
  const confidenceLabel = api?.market_arguments?.confidence_label ?? ''
  const matchCount      = api?.evidence?.total_found ?? null
  const top3Sim         = r.similarity?.top3_avg ?? null

  const olxPrice = r.olx.price
  const inRange  = r.price_accuracy?.in_range
  const devPct   = r.price_accuracy?.deviation_pct ?? null

  let statusClass = 'status-neutral'
  let statusText  = 'немає ціни'
  if (r.error)       { statusClass = 'status-error';   statusText = 'помилка' }
  else if (inRange)  { statusClass = 'status-ok';      statusText = 'в діапазоні' }
  else if (olxPrice) { statusClass = 'status-warn';    statusText = 'поза діапазоном' }

  const photo = r.olx.photo
    ? `<img src="${r.olx.photo}" alt="" loading="lazy">`
    : `<div class="no-photo">${(i + 1)}</div>`

  const priceSection = (fast && balanced && profit)
    ? buildPriceSection(olxPrice, fast, balanced, profit, devPct)
    : ''

  const simColor = r.similarity?.low_confidence ? 'var(--warn)' : 'var(--ok)'

  return `
<div class="card ${r.error ? 'card-error' : ''}">
  <div class="card-photo">${photo}</div>
  <div class="card-body">
    <div class="card-top">
      <a class="card-title" href="${r.olx.link}" target="_blank">${r.olx.title || '—'}</a>
      <span class="status-badge ${statusClass}">${statusText}</span>
    </div>

    ${r.error ? `<div class="error-msg">${r.error}</div>` : `
    ${priceSection}
    <div class="card-meta">
      ${top3Sim !== null ? `<span style="color:${simColor}">схожість ${top3Sim}</span>` : ''}
      ${matchCount !== null ? `<span>${matchCount} аналогів</span>` : ''}
      ${confidence !== null ? `<span>${confidence}% — ${confidenceLabel}</span>` : ''}
      ${r.latency_ms !== null ? `<span class="lat">${r.latency_ms}ms</span>` : ''}
    </div>
    `}
  </div>
</div>`
}

function buildHtml({ summary, results }: RunReport, sourceFile: string): string {
  const { ok, fail, in_range: inRange, with_price: withPrice, low_similarity: lowSim, latency } = summary
  const avgLat = latency.avg

  const cards = results.map((r, i) => resultCard(r, i)).join('\n')

  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>Monopricer — ${basename(sourceFile)}</title>
<style>
  :root {
    --bg:       #0f1117;
    --surface:  #1a1d27;
    --border:   #2a2d3a;
    --text:     #e2e8f0;
    --muted:    #64748b;
    --ok:       #4ade80;
    --warn:     #fb923c;
    --error:    #f87171;
    --accent:   #818cf8;
    --bar-bg:   #2a2d3a;
    --bar-fill: #312e81;
    --bar-bal:  #818cf8;
    --bar-olx:  #f87171;
  }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: system-ui, -apple-system, sans-serif; font-size: 13px; background: var(--bg); color: var(--text); min-height: 100vh }
  a { color: var(--accent); text-decoration: none }
  a:hover { text-decoration: underline }

  /* ── Header ── */
  .header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 20px 32px;
    display: flex;
    align-items: center;
    gap: 32px;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .header-title { flex: 1 }
  .header-title h1 { font-size: 15px; font-weight: 600; color: var(--text) }
  .header-title p  { font-size: 11px; color: var(--muted); margin-top: 2px }

  .stat { text-align: center; min-width: 56px }
  .stat .val { font-size: 20px; font-weight: 700; line-height: 1 }
  .stat .lbl { font-size: 10px; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: .05em }

  /* ── List ── */
  .list { max-width: 860px; margin: 0 auto; padding: 24px 16px; display: flex; flex-direction: column; gap: 12px }

  /* ── Card ── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    display: flex;
    gap: 16px;
    padding: 16px;
    transition: border-color .15s;
  }
  .card:hover { border-color: #3a3d4e }
  .card-error { border-color: #3d1f1f }

  .card-photo { flex-shrink: 0 }
  .card-photo img, .no-photo {
    width: 72px; height: 72px; border-radius: 8px; object-fit: cover; display: block;
  }
  .no-photo {
    background: var(--border);
    color: var(--muted);
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; font-weight: 600;
  }

  .card-body { flex: 1; min-width: 0 }

  .card-top {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
    margin-bottom: 12px;
  }
  .card-title {
    font-size: 14px; font-weight: 500; line-height: 1.4;
    color: var(--text); flex: 1;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .card-title:hover { color: var(--accent) }

  .status-badge {
    flex-shrink: 0;
    font-size: 11px; font-weight: 500;
    padding: 3px 9px; border-radius: 20px;
    white-space: nowrap;
  }
  .status-ok      { background: #14532d; color: var(--ok) }
  .status-warn    { background: #431407; color: var(--warn) }
  .status-error   { background: #450a0a; color: var(--error) }
  .status-neutral { background: var(--border); color: var(--muted) }

  /* ── Price scale ── */
  .price-scale { margin: 4px 0 20px; padding: 0 8px }
  .scale-track {
    position: relative;
    height: 4px; background: var(--bar-bg); border-radius: 2px;
    margin: 28px 0 24px;
  }
  .scale-range {
    position: absolute; height: 100%;
    background: var(--bar-fill); border-radius: 2px; opacity: .8;
  }
  /* tick mark for fast/balanced/profit */
  .scale-mark {
    position: absolute; top: -4px;
    width: 2px; height: 12px;
    background: var(--muted);
    transform: translateX(-50%);
  }
  .scale-mark-bal { background: var(--bar-bal); }
  .scale-val {
    position: absolute; bottom: 16px; left: 50%;
    transform: translateX(-50%);
    font-size: 12px; font-weight: 600; color: var(--text);
    white-space: nowrap;
  }
  .scale-lbl {
    position: absolute; top: 16px; left: 50%;
    transform: translateX(-50%);
    font-size: 10px; color: var(--muted);
    white-space: nowrap;
  }
  .scale-mark-bal .scale-val { color: var(--bar-bal) }
  /* OLX price marker */
  .marker-olx {
    position: absolute; top: 0;
    transform: translateX(-50%);
  }
  .marker-olx-pin {
    width: 12px; height: 12px;
    background: var(--bar-olx);
    border-radius: 50%;
    border: 2px solid var(--bg);
    margin: -4px auto 0;
  }
  .marker-olx-val {
    position: absolute; bottom: 18px; left: 50%;
    transform: translateX(-50%);
    font-size: 12px; font-weight: 700; color: var(--bar-olx);
    white-space: nowrap;
  }
  .dev { font-size: 10px; color: var(--warn); margin-left: 4px; font-weight: 400 }

  /* ── Meta ── */
  .card-meta {
    display: flex; flex-wrap: wrap; gap: 12px;
    font-size: 11px; color: var(--muted); margin-top: 4px;
  }
  .lat { margin-left: auto }

  .error-msg { font-size: 12px; color: var(--error); padding: 4px 0 }
</style>
</head>
<body>

<div class="header">
  <div class="header-title">
    <h1>Monopricer test report</h1>
    <p>${basename(sourceFile)}${summary.source_url ? ` · <a href="${summary.source_url}" target="_blank">${summary.source_url.slice(0, 60)}…</a>` : ''}</p>
  </div>
  <div class="stat">
    <div class="val">${results.length}</div>
    <div class="lbl">всього</div>
  </div>
  <div class="stat">
    <div class="val" style="color:var(--ok)">${ok}</div>
    <div class="lbl">успішно</div>
  </div>
  <div class="stat">
    <div class="val" style="color:var(--error)">${fail}</div>
    <div class="lbl">помилок</div>
  </div>
  <div class="stat">
    <div class="val">${withPrice ? `${inRange}/${withPrice}` : '—'}</div>
    <div class="lbl">в діапазоні</div>
  </div>
  <div class="stat">
    <div class="val" style="font-size:12px;color:var(--muted)">${summary.run_at.replace('T', ' ').slice(0, 16)}</div>
    <div class="lbl">запущено</div>
  </div>
  <div class="stat">
    <div class="val" style="color:${lowSim > 0 ? 'var(--warn)' : 'var(--ok)'}">${lowSim}</div>
    <div class="lbl">слабких</div>
  </div>
  <div class="stat">
    <div class="val">${avgLat ?? '—'}<span style="font-size:12px;font-weight:400">ms</span></div>
    <div class="lbl">avg latency</div>
  </div>
</div>

<div class="list">
  ${cards}
</div>

</body>
</html>`
}

// ── Main ──

const inputArg = process.argv[2]
if (!inputArg) {
  console.error('Usage: npx tsx tests/generate-report.ts <results.json>')
  process.exit(1)
}

const inputPath = resolve(inputArg)
const outputPath = inputPath.replace(/\.json$/, '.html')

const report: RunReport = JSON.parse(readFileSync(inputPath, 'utf-8'))
const html = buildHtml(report, inputPath)
writeFileSync(outputPath, html, 'utf-8')
console.log(`Report saved to ${outputPath}`)
