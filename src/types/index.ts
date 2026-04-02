// ── Supabase: raw listing from match_listings RPC ──

export type Listing = {
  id: number
  external_id: string
  title: string
  description: string | null
  image_url: string | null
  sold_price: number
  original_price: number
  status: string
  sold_via_bargain: boolean | null
  category_id: number
  category_name: string | null
  created_at: string
  modified_at: string
  similarity: number
}

export type EstimateProductRequest = { title?: string; description: string; category?: number }

// ── Estimate price response ──

export type EstimatePriceResponse = {
  price: {
    min: number
    balanced: number
    profit: number
  }
  days_to_sell: {
    min: number
    max: number
  }
  statistics: {
    bargain_percentage: number
  }
  similar_products: {
    sold: Array<{
      image_url: string | null
      title: string
      original_price: number
      sold_price: number
      created_at: string
      updated_at: string
    }>
    active: Array<{
      image_url: string | null
      title: string
      original_price: number
      created_at: string
    }>
  }
}

// ── Intermediate analytics ──

export type MarketMetrics = {
  p20: number
  p50: number
  p80: number
  medianDays: number
  bargainPercentage: number
  avgBargainDiscount: number
  confidenceScore: number
  soldCount: number
}
