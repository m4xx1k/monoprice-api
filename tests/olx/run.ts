/**
 * All-in-one runner: scrape → pricing → report → open
 *
 * Usage:
 *   npx tsx tests/run.ts <OLX_URL> <name> [options]
 *
 * Options:
 *   --limit N          max products to scrape (default 50)
 *   --api <url>        API base URL (default http://localhost:3000)
 *   --only-report      skip scrape+pricing, regenerate HTML from existing JSON
 *
 * Output files (auto-dated to avoid overwrites):
 *   tests/data/<name>_2025-01-15_14-32.json
 *   tests/data/<name>_2025-01-15_14-32-results.json
 *   tests/data/<name>_2025-01-15_14-32-results.html
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)

const onlyReport = args.includes('--only-report')
const limitIdx   = args.indexOf('--limit')
const limit      = limitIdx !== -1 ? args[limitIdx + 1] : '50'
const apiIdx     = args.indexOf('--api')
const apiBase    = apiIdx !== -1 ? args[apiIdx + 1]! : 'http://localhost:4000'

const olxUrl  = onlyReport ? null : args.find(a => a.startsWith('http'))!
const nameArg = args.find(a => !a.startsWith('--') && !a.startsWith('http') && args.indexOf(a) !== limitIdx + 1 && args.indexOf(a) !== apiIdx + 1)

if (!nameArg) {
  console.error('Usage: npx tsx tests/run.ts <OLX_URL> <name> [--limit N] [--api URL] [--only-report]')
  process.exit(1)
}
if (!onlyReport && !olxUrl) {
  console.error('OLX URL required unless --only-report is set')
  process.exit(1)
}

// ── Dated name ──

function dateSuffix() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

const baseName    = onlyReport ? nameArg : `${nameArg}_${dateSuffix()}`
const dataDir     = resolve(import.meta.dirname!, 'data')
const productsPath = resolve(dataDir, `${baseName}.json`)
const resultsPath  = resolve(dataDir, `${baseName}-results.json`)
const reportPath   = resolve(dataDir, `${baseName}-results.html`)

function run(script: string, scriptArgs: string[]) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`▶ ${script} ${scriptArgs.join(' ')}`)
  console.log('─'.repeat(60))
  const result = spawnSync('npx', ['tsx', resolve(import.meta.dirname!, script), ...scriptArgs], {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    console.error(`\n✗ ${script} failed (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}

function openFile(path: string) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawnSync(opener, [path], { stdio: 'ignore', shell: process.platform === 'win32' })
}

// ── Pipeline ──

if (!onlyReport) {
  run('olx-scraper.ts', [olxUrl!, baseName, '--limit', limit!])
} else if (!existsSync(productsPath)) {
  console.error(`Products file not found: ${productsPath}`)
  process.exit(1)
}

if (!onlyReport) {
  run('run-pricing.ts', [baseName, apiBase, '--url', olxUrl!])
} else if (!existsSync(resultsPath)) {
  console.error(`Results file not found: ${resultsPath}`)
  process.exit(1)
}

run('generate-report.ts', [resultsPath])

console.log(`\n✓ Done → ${reportPath}`)
openFile(reportPath)
