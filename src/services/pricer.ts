import type { Listing, PriceResponse } from '../types/index.js'

export function calculatePrice(analogs: Listing[], description: string): PriceResponse {
  const prices = analogs.map((a) => a.sold_price).sort((a, b) => a - b)
  const durations = analogs.map((a) => salesDuration(a.created_at, a.modified_at))

  const fast = Math.round(percentile(prices, 20))
  const balanced = Math.round(percentile(prices, 50))
  const profit = Math.round(percentile(prices, 80))

  const avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
  const minPrice = prices[0]
  const maxPrice = prices[prices.length - 1]
  const avgSimilarity = Math.round(analogs.reduce((s, a) => s + a.similarity, 0) / analogs.length * 100)

  const bargainCount = analogs.filter((a) => a.sold_price < a.original_price).length
  const bargainPct = Math.round((bargainCount / analogs.length) * 100)

  const explanation = buildExplanation({
    count: analogs.length,
    avgSimilarity,
    minPrice,
    maxPrice,
    avgDuration,
    bargainPct,
    fast,
    balanced,
    profit,
  })

  const similar_products = analogs.slice(0, 5).map((a) => ({
    title: a.title,
    description: a.description,
    image_url: a.image_url,
    sold_price: a.sold_price,
    sales_duration: salesDuration(a.created_at, a.modified_at),
  }))

  return { price: { fast, balanced, profit }, explanation, similar_products }
}

function buildExplanation(p: {
  count: number
  avgSimilarity: number
  minPrice: number
  maxPrice: number
  avgDuration: number
  bargainPct: number
  fast: number
  balanced: number
  profit: number
}): string {
  const lines: string[] = []

  lines.push(
    `Ціну розраховано на основі ${p.count} схожих проданих товарів (середня схожість ${p.avgSimilarity}%).`
  )

  lines.push(
    `Діапазон цін аналогів: ${p.minPrice}–${p.maxPrice} грн. У середньому товари продавались за ${p.avgDuration} дн.`
  )

  if (p.bargainPct > 0) {
    lines.push(
      `У ${p.bargainPct}% випадків покупці торгувались і купували дешевше за початкову ціну.`
    )
  }

  lines.push(
    `Швидкий продаж (${p.fast} грн) — нижня ціна ринку, продаж за 1–3 дні. ` +
    `Балансована (${p.balanced} грн) — середня ринкова ціна, продаж за 5–10 днів. ` +
    `Максимальна (${p.profit} грн) — верхня межа, продаж може зайняти 2–4 тижні.`
  )

  return lines.join(' ')
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
