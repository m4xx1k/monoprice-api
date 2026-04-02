// ── Vision ──

export type VisionResult = {
  brand: string | null
  model: string | null
  condition: 'new' | 'excellent' | 'good' | 'fair' | 'poor'
  color: string | null
  year: number | null
  details: string | null
}

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

// ── Request bodies ──

export type AnalyzeRequest = {
  photos: string[]
}

// ── Route: /v1/product ──

export type InitBody = {
  id: string
  title: string
  category: string
  photos: unknown
}

export type DescriptionBody = {
  id: string
  title: string
  description: string
  category?: number
}

// ── Response contracts ──

export type SimilarProduct = {
  external_id: string
  title: string
  description: string | null
  image_url: string | null
  sold_price: number
  sales_duration: number | null
  created_at: string
  status: string
}

export type PriceResponse = {
  price: {
    fast: number
    balanced: number
    profit: number
  }
  explanation: string
  similar_products: SimilarProduct[]
}

// ── New enriched response ──

export type Strategy = {
  name: string
  expected_revenue: number
  recommended_listing_price: number
  estimated_days: string
  badge?: string
}

export type MarketTemplate = {
  icon: string
  title: string
  text: string
}

export type EvidenceProduct = {
  external_id: string
  title: string
  original_price: number
  sold_price: number
  similarity: number
  days_to_sell: number
  image_url: string | null
}

export type EnrichedPriceResponse = {
  pricing: {
    strategies: {
      fast: Strategy
      balanced: Strategy
      profit: Strategy
    }
  }
  market_arguments: {
    confidence_score: number
    confidence_label: string
    templates: MarketTemplate[]
  }
  evidence: {
    total_found: number
    top_similar_products: EvidenceProduct[]
  }
}

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
