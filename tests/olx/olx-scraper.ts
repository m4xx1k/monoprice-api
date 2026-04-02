/**
 * OLX Scraper — extracts product data from an OLX listing page.
 *
 * Usage:  npx tsx tests/olx-scraper.ts <OLX_LIST_URL> [output.json]
 *
 * For each listing on the page it fetches the detail page to grab the full
 * description. Results are saved to tests/data/<output>.json.
 */

import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Types ──

type OlxProduct = {
  title: string
  description: string
  price: number | null
  currency: string
  link: string
  photo: string | null
}

// ── Config ──

const limitArg = process.argv.indexOf('--limit')
const MAX_PRODUCTS = limitArg !== -1 ? parseInt(process.argv[limitArg + 1] ?? '50', 10) : 50
const DELAY_MIN_MS = 1000
const DELAY_MAX_MS = 3000

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'uk-UA,uk;q=0.9',
}

// ── Helpers ──

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function randomDelay() {
  const ms = Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)) + DELAY_MIN_MS
  return sleep(ms)
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

function parsePrice(raw: string): { price: number | null; currency: string } {
  const cleaned = raw.replace(/\s/g, '').replace(/,/g, '.')
  const match = cleaned.match(/([\d.]+)/)
  const price = match ? parseFloat(match[1]) : null
  const currency = cleaned.includes('грн')
    ? 'UAH'
    : cleaned.includes('$')
      ? 'USD'
      : cleaned.includes('€')
        ? 'EUR'
        : 'UAH'
  return { price, currency }
}

// ── Types for list items ──

type ListItem = { title: string; link: string; price: number | null; currency: string; photo: string | null }

// ── Parse cards from one page of HTML ──

function extractCleanTitle($el: cheerio.Cheerio<Element>, $: cheerio.CheerioAPI): string {
  // data-cy="ad-card-title" wraps only the title text — use it directly
  const titleEl = $el.find('[data-cy="ad-card-title"]')
  if (titleEl.length) {
    // Clone and remove any nested price/badge elements before reading text
    const clone = titleEl.clone()
    clone.find('[data-testid="ad-price"], [data-cy="ad-price"], p, span.price').remove()
    const t = clone.text().trim()
    if (t && !t.includes('{')) return t
  }
  // Fallback: link title attribute is clean (no price)
  const link = $el.find('a[href*="/d/"]').first()
  return link.attr('title')?.trim() || link.find('h4, h6').first().text().trim() || ''
}

function cleanPhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null
  // Skip OLX placeholder SVG
  if (url.includes('no_thumbnail') || url.endsWith('.svg')) return null
  // Upgrade thumbnail size to full: ;s=216x152 or ;s=WxH → ;s=640x480
  return url.replace(/;s=\d+x\d+/, ';s=640x480').replace(/;q=\d+/, ';q=80')
}

function parseCards($: cheerio.CheerioAPI): ListItem[] {
  // Remove style/script so .text() doesn't pick up CSS-in-JS content
  $('style, script').remove()

  const items: ListItem[] = []

  $('[data-cy="l-card"]').each((_, el) => {
    const card = $(el)

    const linkEl = card.find('a[href*="/d/"]').first()
    let href = linkEl.attr('href') ?? ''
    if (href.startsWith('/')) href = `https://www.olx.ua${href}`
    if (!href) return

    const title = extractCleanTitle(card, $)

    const priceText = card.find('[data-testid="ad-price"]').text().trim()
      || card.find('p[data-testid="ad-price"]').text().trim()
      || card.find('h3').first().text().trim()
      || ''
    const { price, currency } = parsePrice(priceText)

    const rawPhoto = card.find('img').first().attr('src')
      ?? card.find('img').first().attr('data-src')
    const photo = cleanPhotoUrl(rawPhoto)

    items.push({ title, link: href, price, currency, photo })
  })

  return items
}

// ── Collect up to MAX_PRODUCTS items across pages ──

async function collectListItems(startUrl: string): Promise<ListItem[]> {
  const all: ListItem[] = []
  const seen = new Set<string>()

  // Build page URL: add or replace ?page=N
  function pageUrl(base: string, page: number) {
    const u = new URL(base)
    u.searchParams.set('page', String(page))
    return u.toString()
  }

  let page = 1

  while (all.length < MAX_PRODUCTS) {
    const url = page === 1 ? startUrl : pageUrl(startUrl, page)
    console.log(`Fetching list page ${page}: ${url}`)

    const html = await fetchPage(url)
    const $ = cheerio.load(html)
    const cards = parseCards($)

    if (!cards.length) {
      console.log('No more listings found, stopping pagination.')
      break
    }

    for (const item of cards) {
      if (seen.has(item.link)) continue
      seen.add(item.link)
      all.push(item)
      if (all.length >= MAX_PRODUCTS) break
    }

    console.log(`  Collected ${all.length}/${MAX_PRODUCTS} so far`)

    // Check if there's a next page link; stop if not
    const hasNextPage = $('[data-cy="pagination-forward"]').length > 0
      || $('a[data-testid="pagination-forward"]').length > 0
    if (!hasNextPage) break

    page++
    await randomDelay()
  }

  return all
}

// ── Scrape detail page for description ──

async function scrapeDescription(url: string): Promise<string> {
  const html = await fetchPage(url)
  const $ = cheerio.load(html)

  // Remove style/script tags so their text content doesn't pollute .text() output
  $('style, script').remove()

  const container = $('[data-cy="ad_description"]').length
    ? $('[data-cy="ad_description"]')
    : $('[data-testid="ad-description"]')

  if (!container.length) return ''

  // Grab individual text nodes from p/span/div children, skip empty ones
  const parts: string[] = []
  container.find('p, span, div').addBack().each((_, el) => {
    const node = $(el)
    // Only leaf-level nodes (no block children) carry real text
    if (node.children('p, div').length === 0) {
      const t = node.text().trim()
      if (t) parts.push(t)
    }
  })

  // Deduplicate consecutive identical lines and join
  const unique = parts.filter((v, i) => v !== parts[i - 1])
  return unique.join('\n').trim()
}

// ── Main ──

async function main() {
  const listUrl = process.argv[2]
  if (!listUrl) {
    console.error('Usage: npx tsx tests/olx-scraper.ts <OLX_LIST_URL> [output_name]')
    process.exit(1)
  }

  const outputName = process.argv[3] || 'olx-products'
  const outputPath = outputName.includes('/')
    ? resolve(outputName)
    : resolve(import.meta.dirname!, 'data', outputName.replace(/\.json$/, '') + '.json')

  const items = await collectListItems(listUrl)
  if (!items.length) {
    console.error('No listings found. OLX might have changed its markup or the URL is wrong.')
    process.exit(1)
  }

  const products: OlxProduct[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    console.log(`[${i + 1}/${items.length}] Fetching description: ${item.title.slice(0, 60)}...`)

    try {
      const description = await scrapeDescription(item.link)
      products.push({
        title: item.title,
        description,
        price: item.price,
        currency: item.currency,
        link: item.link,
        photo: item.photo,
      })
    } catch (err) {
      console.error(`  ⚠ Failed to fetch ${item.link}: ${(err as Error).message}`)
      products.push({
        title: item.title,
        description: '',
        price: item.price,
        currency: item.currency,
        link: item.link,
        photo: item.photo,
      })
    }

    if (i < items.length - 1) await randomDelay()
  }

  writeFileSync(outputPath, JSON.stringify(products, null, 2), 'utf-8')
  console.log(`\nSaved ${products.length} products to ${outputPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
