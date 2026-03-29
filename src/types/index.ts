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
  created_at: string
  modified_at: string
  similarity: number
}

// ── Request bodies ──

export type AnalyzeRequest = {
  photos: string[]
}

// ── Response contracts ──

export type SimilarProduct = {
  external_id: string
  title: string
  description: string | null
  image_url: string | null
  sold_price: number
  sales_duration: number
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
