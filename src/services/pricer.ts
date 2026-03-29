import type { Listing, PriceResponse } from '../types/index.js'

export function calculatePrice(analogs: Listing[], description: string): PriceResponse {
  const prices = analogs.map((a) => a.sold_price).sort((a, b) => a - b)

  const fast = Math.round(percentile(prices, 20))
  const balanced = Math.round(percentile(prices, 50))
  const profit = Math.round(percentile(prices, 80))

  const explanation =
    analogs.length >= 3
      ? `Based on ${analogs.length} similar sold listings. Fast sells quickly, balanced is average market value, profit maximizes revenue.`
      : `Low number of similar items found (${analogs.length}). Prices are estimates only.`

  const similar_products = analogs.slice(0, 3).map((a) => ({
    title: a.title,
    image_url: a.image_url,
    sold_price: a.sold_price,
    sales_duration: salesDuration(a.created_at, a.modified_at),
  }))

  return { price: { fast, balanced, profit }, explanation, similar_products }
}

// ── Helpers ──

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
