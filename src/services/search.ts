import { supabase } from '../db/supabase.js'
import type { Listing } from '../types/index.js'

type SearchOptions = {
  embedding: number[]
  category_id?: number
  limit?: number
}

export async function searchListings(options: SearchOptions): Promise<Listing[]> {
  const { embedding, category_id, limit = 20 } = options

  const { data, error } = await supabase.rpc('match_listings', {
    query_embedding: embedding,
    match_count: limit,
    filter_category: category_id ?? null,
  })

  if (error) {
    console.error('Supabase search error:', error)
    throw new Error(`Search failed: ${error.message}`)
  }

  return (data ?? []) as Listing[]
}
