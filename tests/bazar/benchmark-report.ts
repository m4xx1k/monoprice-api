/**
 * Generates a self-contained HTML benchmark report from a benchmark-results-*.json file.
 *
 * Usage:
 *   npx tsx scripts/benchmark-report.ts benchmark-results-<timestamp>.json
 *
 * Output: benchmark-report-<timestamp>.html (next to the input file)
 */

import { readFileSync, writeFileSync } from 'fs'

// ── Types ──

interface Latency {
  avg_ms: number
  median_ms: number
  p95_ms: number
  min_ms: number
  max_ms: number
}

interface ItemResult {
  test_id: string
  category_name: string
  title: string
  actual_price: number
  status: 200 | 422 | 'error'
  latency_ms: number
  price_min?: number
  price_balanced?: number
  price_profit?: number
  in_range?: boolean
  relative_error_pct?: number
  signed_error_pct?: number
  days_to_sell?: { min: number; max: number }
  analogs_sold?: number
  analogs_active?: number
  insufficient_details?: { total_found: number; after_filter: number; min_required: number }
  error_message?: string
}

interface CategoryStats {
  total: number
  success_count: number
  success_rate_pct: number
  insufficient_data_count: number
  error_count: number
  latency: Latency | null
  in_range_pct: number | null
  mean_abs_error_pct: number | null
  median_abs_error_pct: number | null
  bias_pct: number | null
  items: ItemResult[]
}

interface BenchmarkData {
  meta: { input_file: string; base_url: string; total_items: number; ran_at: string }
  overall: CategoryStats
  categories: Record<string, CategoryStats>
}

// ── Helpers ──

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmt(n: number | null | undefined, suffix = ''): string {
  if (n == null) return '<span class="muted">—</span>'
  return `${n}${suffix}`
}

function fmtBias(n: number | null | undefined): string {
  if (n == null) return '<span class="muted">—</span>'
  const sign = n > 0 ? '+' : ''
  const cls = n > 5 ? 'val-red' : n < -5 ? 'val-yellow' : 'val-green'
  return `<span class="${cls}">${sign}${n}%</span>`
}

function biasLabel(n: number | null | undefined): string {
  if (n == null) return '—'
  if (Math.abs(n) <= 5) return 'точно'
  return n > 0 ? 'завищуємо' : 'занижуємо'
}

function statusBadge(item: ItemResult): string {
  if (item.status === 200) {
    return item.in_range
      ? '<span class="badge badge-green">✓ в діапазоні</span>'
      : '<span class="badge badge-red">✗ поза діапазоном</span>'
  }
  if (item.status === 422) return '<span class="badge badge-yellow">мало даних</span>'
  return '<span class="badge badge-red">помилка</span>'
}

function priceRangeViz(item: ItemResult): string {
  if (item.status !== 200 || !item.price_min || !item.price_balanced || !item.price_profit) {
    if (item.status === 422) {
      const d = item.insufficient_details
      return `<span class="muted small">знайдено ${d?.total_found ?? 0}, потрібно ${d?.min_required ?? 3}</span>`
    }
    return `<span class="muted">—</span>`
  }

  const { actual_price, price_min, price_balanced, price_profit } = item
  const lo = Math.min(actual_price, price_min) * 0.88
  const hi = Math.max(actual_price, price_profit) * 1.12
  const span = hi - lo || 1
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100)).toFixed(1)

  const pMin = pos(price_min)
  const pBal = pos(price_balanced)
  const pProfit = pos(price_profit)
  const pActual = pos(actual_price)
  const bandW = (parseFloat(pProfit) - parseFloat(pMin)).toFixed(1)

  const inRange = item.in_range

  return `
    <div class="pv">
      <div class="pv-track">
        <div class="pv-band" style="left:${pMin}%;width:${bandW}%"></div>
        <div class="pv-bal" style="left:${pBal}%" title="balanced: ${price_balanced} грн"></div>
        <div class="pv-actual ${inRange ? 'pv-in' : 'pv-out'}" style="left:${pActual}%" title="actual: ${actual_price} грн"></div>
      </div>
      <div class="pv-vals">
        <span class="muted small">${price_min.toLocaleString('uk-UA')}</span>
        <span class="small" style="color:var(--purple-light)">${price_balanced.toLocaleString('uk-UA')}</span>
        <span class="muted small">${price_profit.toLocaleString('uk-UA')}</span>
      </div>
    </div>`
}

function errPctCell(item: ItemResult): string {
  if (item.relative_error_pct == null) return '<td class="muted">—</td>'
  const v = item.relative_error_pct
  const cls = v <= 15 ? 'val-green' : v <= 40 ? 'val-yellow' : 'val-red'
  return `<td><span class="${cls}">${v}%</span></td>`
}

function categorySection(name: string, stats: CategoryStats): string {
  const inRangeFill = stats.in_range_pct ?? 0
  const maeFill = Math.min(stats.mean_abs_error_pct ?? 0, 100)
  const successFill = stats.success_rate_pct

  const rows = stats.items.map((item) => `
    <tr>
      <td class="mono muted small">${esc(item.test_id)}</td>
      <td class="title-cell" title="${esc(item.title)}">${esc(item.title)}</td>
      <td class="mono right">${item.actual_price.toLocaleString('uk-UA')} <span class="muted small">грн</span></td>
      <td>${priceRangeViz(item)}</td>
      ${errPctCell(item)}
      <td class="mono right muted small">${item.latency_ms} мс</td>
      <td>${statusBadge(item)}</td>
    </tr>`).join('')

  return `
  <section class="cat-section">
    <div class="cat-header">
      <div class="cat-title-row">
        <h2 class="cat-name">${esc(name)}</h2>
        <div class="cat-pills">
          <span class="pill">${stats.total} товарів</span>
          ${stats.insufficient_data_count > 0 ? `<span class="pill pill-dim">${stats.insufficient_data_count}× мало даних</span>` : ''}
        </div>
      </div>
      <div class="cat-bars">
        <div class="bar-row">
          <span class="bar-label">Success</span>
          <div class="bar-track"><div class="bar-fill bar-blue" style="width:${successFill}%"></div></div>
          <span class="bar-val">${successFill}%</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">In Range</span>
          <div class="bar-track"><div class="bar-fill bar-purple" style="width:${inRangeFill}%"></div></div>
          <span class="bar-val">${stats.in_range_pct != null ? inRangeFill + '%' : '—'}</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">MAE</span>
          <div class="bar-track"><div class="bar-fill bar-orange" style="width:${maeFill}%"></div></div>
          <span class="bar-val">${stats.mean_abs_error_pct != null ? stats.mean_abs_error_pct + '%' : '—'}</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">Bias</span>
          <div class="bar-track" style="position:relative">
            <div class="bar-center"></div>
            ${stats.bias_pct != null ? `<div class="bar-fill bar-bias" style="
              left:${stats.bias_pct >= 0 ? '50%' : `${50 + stats.bias_pct / 2}%`};
              width:${Math.abs(stats.bias_pct) / 2}%;
              background:${stats.bias_pct > 5 ? 'var(--red)' : stats.bias_pct < -5 ? 'var(--yellow)' : 'var(--green)'}
            "></div>` : ''}
          </div>
          <span class="bar-val">${fmtBias(stats.bias_pct)} <span class="muted small">${biasLabel(stats.bias_pct)}</span></span>
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <table class="items-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Назва</th>
            <th class="right">Реальна ціна</th>
            <th>Діапазон [p20 · p50 · p80]</th>
            <th>Похибка</th>
            <th class="right">Латенсі</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`
}

// ── Main HTML ──

function generateHTML(data: BenchmarkData): string {
  const { meta, overall, categories } = data
  const catNames = Object.keys(categories)

  const ranAt = new Date(meta.ran_at).toLocaleString('uk-UA', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  // chart data
  const chartLabels = JSON.stringify(catNames)
  const inRangeVals = JSON.stringify(catNames.map((n) => categories[n].in_range_pct ?? 0))
  const maeVals = JSON.stringify(catNames.map((n) => categories[n].mean_abs_error_pct ?? 0))
  const latAvg = JSON.stringify(catNames.map((n) => categories[n].latency?.avg_ms ?? 0))
  const latP95 = JSON.stringify(catNames.map((n) => categories[n].latency?.p95_ms ?? 0))
  const successVals = JSON.stringify(catNames.map((n) => categories[n].success_rate_pct))

  const catSections = catNames.map((n) => categorySection(n, categories[n])).join('\n')

  const inRangePct = overall.in_range_pct ?? 0
  const successPct = overall.success_rate_pct
  const maeVal = overall.mean_abs_error_pct ?? 0
  const biasVal = overall.bias_pct ?? 0

  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Monopricer Benchmark</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:           #0b0b12;
  --bg2:          #0f0f18;
  --surface:      #14141e;
  --surface2:     #1a1a28;
  --surface3:     #22223a;
  --border:       #252538;
  --border2:      #303048;
  --purple:       #8055f5;
  --purple-light: #a07bff;
  --purple-dim:   #4a3a8a;
  --blue:         #4a8ee8;
  --blue-light:   #7ab3ff;
  --blue-dim:     #2a4e8a;
  --green:        #1ec99a;
  --red:          #f05470;
  --yellow:       #f0a030;
  --text:         #e0e0f0;
  --text2:        #8888aa;
  --text3:        #4a4a6a;
  --radius:       12px;
  --radius-sm:    8px;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  min-height: 100vh;
}

a { color: var(--purple-light); }
.mono { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; }
.muted { color: var(--text2); }
.small { font-size: 12px; }
.right { text-align: right; }
.val-green { color: var(--green); }
.val-red   { color: var(--red); }
.val-yellow{ color: var(--yellow); }

/* ── Layout ── */
.page { max-width: 1200px; margin: 0 auto; padding: 32px 24px 80px; }

/* ── Header ── */
.header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 40px; padding-bottom: 24px;
  border-bottom: 1px solid var(--border);
}
.logo {
  display: flex; align-items: center; gap: 12px;
}
.logo-icon {
  width: 40px; height: 40px; border-radius: 10px;
  background: linear-gradient(135deg, var(--purple), var(--blue));
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
}
.logo-text { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
.logo-sub  { font-size: 12px; color: var(--text2); margin-top: 1px; }
.header-meta { text-align: right; }
.header-meta .date { font-size: 13px; color: var(--text2); }
.header-meta .source { font-size: 12px; color: var(--text3); margin-top: 4px; font-family: monospace; }

/* ── Hero cards ── */
.hero-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 32px;
}
@media (max-width: 900px) { .hero-grid { grid-template-columns: repeat(3, 1fr); } }

.hero-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 16px 14px;
  position: relative;
  overflow: hidden;
}
.hero-card::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: var(--accent, var(--purple));
}
.hero-card .card-label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--text2); margin-bottom: 8px;
}
.hero-card .card-value {
  font-size: 28px; font-weight: 700; letter-spacing: -1px;
  font-variant-numeric: tabular-nums;
}
.hero-card .card-sub {
  font-size: 11px; color: var(--text2); margin-top: 4px;
}
.hero-card.purple { --accent: var(--purple); }
.hero-card.blue   { --accent: var(--blue); }
.hero-card.green  { --accent: var(--green); }
.hero-card.yellow { --accent: var(--yellow); }
.hero-card.red    { --accent: var(--red); }

/* ── Charts grid ── */
.charts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
.charts-grid.wide { grid-template-columns: 1fr; }
@media (max-width: 780px) { .charts-grid { grid-template-columns: 1fr; } }

.chart-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}
.chart-title {
  font-size: 13px; font-weight: 600;
  color: var(--text2); text-transform: uppercase; letter-spacing: 0.6px;
  margin-bottom: 16px;
}
.chart-wrap { position: relative; height: 220px; }
.chart-wrap.tall { height: 260px; }

/* ── Section divider ── */
.section-title {
  font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 1px;
  color: var(--text3);
  margin: 40px 0 16px;
  display: flex; align-items: center; gap: 10px;
}
.section-title::after {
  content: ''; flex: 1; height: 1px; background: var(--border);
}

/* ── Category section ── */
.cat-section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 16px;
  overflow: hidden;
}
.cat-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 24px;
  align-items: start;
}
@media (max-width: 780px) { .cat-header { grid-template-columns: 1fr; } }

.cat-title-row {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-bottom: 4px;
}
.cat-name { font-size: 16px; font-weight: 700; }
.cat-pills { display: flex; gap: 6px; flex-wrap: wrap; }
.pill {
  font-size: 11px; padding: 2px 8px;
  background: var(--surface2); border: 1px solid var(--border2);
  border-radius: 20px; color: var(--text2);
}
.pill-dim { color: var(--text3); }

/* ── Mini bars ── */
.cat-bars { display: flex; flex-direction: column; gap: 8px; }
.bar-row { display: flex; align-items: center; gap: 8px; }
.bar-label { font-size: 11px; color: var(--text2); width: 52px; flex-shrink: 0; }
.bar-track {
  flex: 1; height: 6px; background: var(--surface3);
  border-radius: 3px; overflow: visible; position: relative;
}
.bar-fill {
  height: 100%; border-radius: 3px;
  transition: width 0.4s ease;
  position: absolute; top: 0;
}
.bar-blue   { background: var(--blue); }
.bar-purple { background: var(--purple); }
.bar-orange { background: var(--yellow); }
.bar-center {
  position: absolute; left: 50%; top: -2px;
  width: 1px; height: 10px; background: var(--border2);
}
.bar-bias { height: 100%; border-radius: 3px; position: absolute; top: 0; }
.bar-val { font-size: 12px; color: var(--text); width: 120px; flex-shrink: 0; font-variant-numeric: tabular-nums; }

/* ── Table ── */
.table-wrap { overflow-x: auto; }
.items-table {
  width: 100%; border-collapse: collapse;
  font-size: 13px;
}
.items-table th {
  padding: 10px 14px;
  text-align: left; font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--text3);
  border-bottom: 1px solid var(--border);
  font-weight: 500;
  white-space: nowrap;
}
.items-table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.items-table tbody tr:last-child td { border-bottom: none; }
.items-table tbody tr:hover td { background: var(--surface2); }
.title-cell {
  max-width: 220px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ── Badges ── */
.badge {
  display: inline-block; font-size: 11px; padding: 2px 8px;
  border-radius: 20px; white-space: nowrap; font-weight: 500;
}
.badge-green  { background: rgba(30, 201, 154, 0.12); color: var(--green); }
.badge-red    { background: rgba(240, 84, 112, 0.12); color: var(--red); }
.badge-yellow { background: rgba(240, 160, 48, 0.12); color: var(--yellow); }

/* ── Price viz ── */
.pv { min-width: 180px; }
.pv-track {
  position: relative; height: 6px;
  background: var(--surface3); border-radius: 3px; margin-bottom: 4px;
}
.pv-band {
  position: absolute; top: 0; height: 100%;
  background: linear-gradient(90deg, var(--purple-dim), var(--blue-dim));
  border-radius: 3px;
}
.pv-bal {
  position: absolute; top: -3px;
  width: 2px; height: 12px;
  background: var(--purple-light);
  border-radius: 1px;
  transform: translateX(-50%);
}
.pv-actual {
  position: absolute; top: -4px;
  width: 14px; height: 14px; border-radius: 50%;
  transform: translateX(-50%);
  border: 2px solid var(--bg);
}
.pv-in  { background: var(--green); }
.pv-out { background: var(--red); }
.pv-vals {
  display: flex; justify-content: space-between;
  font-variant-numeric: tabular-nums;
}

/* ── Footer ── */
.footer {
  margin-top: 60px; padding-top: 20px;
  border-top: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center;
}
.footer-text { font-size: 12px; color: var(--text3); }

/* Legend */
.legend { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
.legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text2); }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <header class="header">
    <div class="logo">
      <div class="logo-icon">📊</div>
      <div>
        <div class="logo-text">Monopricer Benchmark</div>
        <div class="logo-sub">Аналіз точності оцінки цін</div>
      </div>
    </div>
    <div class="header-meta">
      <div class="date">${ranAt}</div>
      <div class="source">${esc(meta.base_url)} · ${esc(meta.input_file)}</div>
    </div>
  </header>

  <!-- Hero metrics -->
  <div class="hero-grid">
    <div class="hero-card green">
      <div class="card-label">Success rate</div>
      <div class="card-value val-${successPct >= 80 ? 'green' : successPct >= 50 ? 'yellow' : 'red'}">${successPct}%</div>
      <div class="card-sub">${overall.success_count} з ${overall.total} запитів</div>
    </div>
    <div class="hero-card purple">
      <div class="card-label">In Range [p20–p80]</div>
      <div class="card-value val-${inRangePct >= 60 ? 'green' : inRangePct >= 35 ? 'yellow' : 'red'}">${inRangePct}%</div>
      <div class="card-sub">реальна ціна в нашому діапазоні</div>
    </div>
    <div class="hero-card yellow">
      <div class="card-label">Balanced MAE</div>
      <div class="card-value val-${maeVal <= 20 ? 'green' : maeVal <= 40 ? 'yellow' : 'red'}">${maeVal}%</div>
      <div class="card-sub">середня абс. похибка p50</div>
    </div>
    <div class="hero-card ${Math.abs(biasVal) <= 5 ? 'green' : biasVal > 0 ? 'red' : 'yellow'}">
      <div class="card-label">Bias</div>
      <div class="card-value val-${Math.abs(biasVal) <= 5 ? 'green' : biasVal < 0 ? 'yellow' : 'red'}">${biasVal > 0 ? '+' : ''}${biasVal}%</div>
      <div class="card-sub">${biasLabel(biasVal)} · ${biasVal < 0 ? 'недооцінка' : biasVal > 0 ? 'переоцінка' : 'без зміщення'}</div>
    </div>
    <div class="hero-card blue">
      <div class="card-label">Latency p95</div>
      <div class="card-value">${overall.latency?.p95_ms ?? '—'}</div>
      <div class="card-sub">мс · avg ${overall.latency?.avg_ms ?? '—'} мс</div>
    </div>
  </div>

  <!-- Charts row 1 -->
  <div class="charts-grid">
    <div class="chart-card">
      <div class="chart-title">In Range % по категоріях</div>
      <div class="chart-wrap">
        <canvas id="chartInRange"></canvas>
      </div>
    </div>
    <div class="chart-card">
      <div class="chart-title">MAE % по категоріях</div>
      <div class="chart-wrap">
        <canvas id="chartMAE"></canvas>
      </div>
    </div>
  </div>

  <!-- Charts row 2 -->
  <div class="charts-grid">
    <div class="chart-card">
      <div class="chart-title">Latency по категоріях (мс)</div>
      <div class="chart-wrap">
        <canvas id="chartLatency"></canvas>
      </div>
    </div>
    <div class="chart-card">
      <div class="chart-title">Success rate по категоріях</div>
      <div class="chart-wrap">
        <canvas id="chartSuccess"></canvas>
      </div>
    </div>
  </div>

  <!-- Category sections -->
  <div class="section-title">Деталі по категоріях</div>

  <div class="legend">
    <div class="legend-item"><div class="legend-dot" style="background:var(--green)"></div> Реальна ціна в діапазоні</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--red)"></div> Поза діапазоном</div>
    <div class="legend-item"><div style="width:10px;height:3px;background:var(--purple-light);border-radius:1px"></div> p50 (balanced)</div>
    <div class="legend-item"><div style="width:20px;height:6px;background:linear-gradient(90deg,var(--purple-dim),var(--blue-dim));border-radius:3px"></div> діапазон [p20–p80]</div>
  </div>

  ${catSections}

  <footer class="footer">
    <div class="footer-text">Monopricer · Benchmark Report · ${esc(meta.ran_at)}</div>
    <div class="footer-text">${meta.total_items} товарів · ${catNames.length} категорій</div>
  </footer>

</div>

<script>
Chart.defaults.color = '#8888aa'
Chart.defaults.borderColor = '#252538'
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
Chart.defaults.font.size = 11

const PURPLE = '#8055f5'
const BLUE   = '#4a8ee8'
const GREEN  = '#1ec99a'
const YELLOW = '#f0a030'
const RED    = '#f05470'
const GRID   = '#1e1e30'

const labels = ${chartLabels}
const shortLabels = labels.map(l => l.length > 18 ? l.slice(0, 16) + '…' : l)

const barOpts = (stacked) => ({
  indexAxis: 'y',
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { callbacks: {
    label: (ctx) => ' ' + ctx.raw + (ctx.dataset.label ? ' (' + ctx.dataset.label + ')' : '')
  }}},
  scales: {
    x: { grid: { color: GRID }, ticks: { color: '#8888aa' }, stacked },
    y: { grid: { display: false }, ticks: { color: '#c0c0d8' }, stacked },
  }
})

// In Range chart
new Chart(document.getElementById('chartInRange'), {
  type: 'bar',
  data: {
    labels: shortLabels,
    datasets: [{
      data: ${inRangeVals},
      backgroundColor: ${inRangeVals}.map(v => v >= 60 ? GREEN + 'cc' : v >= 35 ? YELLOW + 'cc' : RED + 'cc'),
      borderRadius: 4,
      borderSkipped: false,
    }]
  },
  options: { ...barOpts(false), plugins: { ...barOpts(false).plugins,
    tooltip: { callbacks: { label: (ctx) => ' ' + ctx.raw + '%' } }
  },
  scales: { ...barOpts(false).scales, x: { ...barOpts(false).scales.x, max: 100, ticks: { callback: v => v + '%' } } }
  }
})

// MAE chart
new Chart(document.getElementById('chartMAE'), {
  type: 'bar',
  data: {
    labels: shortLabels,
    datasets: [{
      data: ${maeVals},
      backgroundColor: ${maeVals}.map(v => v <= 20 ? GREEN + 'cc' : v <= 40 ? YELLOW + 'cc' : RED + 'cc'),
      borderRadius: 4,
      borderSkipped: false,
    }]
  },
  options: { ...barOpts(false), plugins: { ...barOpts(false).plugins,
    tooltip: { callbacks: { label: (ctx) => ' ' + ctx.raw + '%' } }
  },
  scales: { ...barOpts(false).scales, x: { ...barOpts(false).scales.x, ticks: { callback: v => v + '%' } } }
  }
})

// Latency grouped bar
new Chart(document.getElementById('chartLatency'), {
  type: 'bar',
  data: {
    labels: shortLabels,
    datasets: [
      { label: 'avg', data: ${latAvg}, backgroundColor: BLUE + '99', borderRadius: 4, borderSkipped: false },
      { label: 'p95', data: ${latP95}, backgroundColor: PURPLE + '99', borderRadius: 4, borderSkipped: false },
    ]
  },
  options: {
    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 12 } },
      tooltip: { callbacks: { label: (ctx) => ' ' + ctx.raw + ' мс (' + ctx.dataset.label + ')' } }
    },
    scales: {
      x: { grid: { color: GRID }, ticks: { callback: v => v + 'мс' } },
      y: { grid: { display: false }, ticks: { color: '#c0c0d8' } },
    }
  }
})

// Success rate chart
new Chart(document.getElementById('chartSuccess'), {
  type: 'bar',
  data: {
    labels: shortLabels,
    datasets: [{
      data: ${successVals},
      backgroundColor: ${successVals}.map(v => v >= 80 ? GREEN + 'cc' : v >= 50 ? YELLOW + 'cc' : RED + 'cc'),
      borderRadius: 4,
      borderSkipped: false,
    }]
  },
  options: { ...barOpts(false), plugins: { ...barOpts(false).plugins,
    tooltip: { callbacks: { label: (ctx) => ' ' + ctx.raw + '%' } }
  },
  scales: { ...barOpts(false).scales, x: { ...barOpts(false).scales.x, max: 100, ticks: { callback: v => v + '%' } } }
  }
})
</script>
</body>
</html>`
}

// ── Entry point ──

const inputFile = process.argv[2]
if (!inputFile) {
  console.error('Usage: npx tsx scripts/benchmark-report.ts <benchmark-results.json>')
  process.exit(1)
}

const data: BenchmarkData = JSON.parse(readFileSync(inputFile, 'utf-8'))
const html = generateHTML(data)

const outFile = inputFile.replace(/benchmark-results/, 'benchmark-report').replace(/\.json$/, '.html')
writeFileSync(outFile, html)
console.log(`✓ Репорт збережено: ${outFile}`)
