import type { Listing, MarketMetrics, EstimatePriceResponse } from '../types/index.js'

const SIMILARITY_THRESHOLD = 0.50
const MIN_ANALOGS = 3

// ── Public API ──

export function filterAnalogs(analogs: Listing[]): Listing[] {
  return analogs.filter((a) => a.similarity >= SIMILARITY_THRESHOLD)
}

export function hasEnoughData(analogs: Listing[]): boolean {
  return analogs.length >= MIN_ANALOGS
}

export function buildEstimateResponse(analogs: Listing[]): EstimatePriceResponse {
  const metrics = computeMetrics(analogs)

  const sold = analogs.filter((a) => a.status === 'SOLD')
  const active = analogs.filter((a) => a.status === 'ACTIVE')

  const durations = sold.map((a) => salesDuration(a.created_at, a.modified_at)).sort((a, b) => a - b)

  return {
    price: {
      min:      Math.round(metrics.p20 * 0.88),
      balanced: metrics.p50,
      profit:   Math.round(metrics.p80 * 1.18),
    },
    days_to_sell: {
      min: Math.round(percentile(durations, 20)),
      max: Math.round(percentile(durations, 80)),
    },
    statistics: {
      bargain_percentage: metrics.bargainPercentage,
    },
    similar_products: {
      sold: sold.map((a) => ({
        image_url: a.image_url,
        title: a.title,
        original_price: a.original_price,
        sold_price: a.sold_price,
        created_at: a.created_at,
        updated_at: a.modified_at,
      })),
      active: active.map((a) => ({
        image_url: a.image_url,
        title: a.title,
        original_price: a.original_price,
        created_at: a.created_at,
      })),
    },
  }
}

// ── Step 2: Data Science metrics ──

function computeMetrics(analogs: Listing[]): MarketMetrics {
  const sold = analogs.filter((a) => a.status === 'SOLD')
  const prices = sold.map((a) => a.sold_price).sort((a, b) => a - b)
  const durations = sold.map((a) => salesDuration(a.created_at, a.modified_at))

  const p20 = Math.round(percentile(prices, 20))
  const p50 = Math.round(percentile(prices, 50) * 1.12)
  const p80 = Math.round(percentile(prices, 80))

  const medianDays = Math.round(percentile(durations.sort((a, b) => a - b), 50))

  // Bargain analysis
  const bargainItems = sold.filter(
    (a) => a.sold_via_bargain || a.sold_price < a.original_price
  )
  const bargainPercentage = sold.length
    ? Math.round((bargainItems.length / sold.length) * 100)
    : 0

  let avgBargainDiscount = 0
  if (bargainItems.length > 0) {
    const discounts = bargainItems
      .filter((a) => a.original_price > 0)
      .map((a) => ((a.original_price - a.sold_price) / a.original_price) * 100)
    avgBargainDiscount = discounts.length
      ? Math.round(discounts.reduce((s, d) => s + d, 0) / discounts.length)
      : 0
  }

  // Confidence score
  const top5 = analogs.slice(0, 5)
  const avgSimilarity = top5.reduce((s, a) => s + a.similarity, 0) / top5.length
  let confidenceScore = Math.round(avgSimilarity * 100)

  if (analogs.length < 5) confidenceScore -= 5
  if (p50 > 0 && (p80 - p20) / p50 > 0.4) confidenceScore -= 5

  confidenceScore = Math.max(0, Math.min(100, confidenceScore))

  return { p20, p50, p80, medianDays, bargainPercentage, avgBargainDiscount, confidenceScore, soldCount: sold.length }
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0
  const idx = (p / 100) * (arr.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return arr[lower]
  return arr[lower] + (arr[upper] - arr[lower]) * (idx - lower)
}

function salesDuration(createdAt: string, modifiedAt: string): number {
  const diff = new Date(modifiedAt).getTime() - new Date(createdAt).getTime()
  return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)))
}
