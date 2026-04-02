import { supabase } from '../db/supabase.js'
import type { Listing } from '../types/index.js'

const MEDIA_BASE_URL = 'https://resale-media.monobazar.com.ua/'

type SearchOptions = {
  embedding: number[]
  category_id?: number
  limit?: number
  candidate_ids?: number[]
  statuses?: string[]
}

export async function searchListings(options: SearchOptions): Promise<Listing[]> {
  const { embedding, category_id, limit = 10, candidate_ids, statuses } = options
  const filter_statuses = statuses?.length ? statuses : null

  // If we have pre-filtered candidate IDs, search only among them
  if (candidate_ids?.length) {
    const { data, error } = await supabase.rpc('match_listings_by_ids', {
      query_embedding: embedding,
      candidate_ids,
      match_count: limit,
      filter_statuses,
    })

    if (error) {
      console.error('Supabase search (by ids) error:', error)
      throw new Error(`Search failed: ${error.message}`)
    }
    return (data ?? []) as Listing[]
  }

  const { data, error } = await supabase.rpc('match_listings', {
    query_embedding: embedding,
    match_count: limit,
    filter_category: category_id ?? null,
    filter_statuses,
  })

  if (error) {
    console.error('Supabase search error:', error)
    throw new Error(`Search failed: ${error.message}`)
  }

  return (data ?? []) as Listing[]
}

// TODO: delete
export async function populateImageUrls(listings: Listing[]): Promise<Listing[]> {
  const externalIds = listings.map((l) => l.external_id).filter(Boolean)

  if (!externalIds.length) {
    console.log('[photos] no external_ids found in listings')
    return listings
  }

  const { data, error } = await supabase
    .from('photos')
    .select('advertisement_id, s3_key')
    .in('advertisement_id', externalIds)

  if (error) {
    console.error('Photos fetch error:', error)
    return listings
  }


  // Map: advertisement_id → first s3_key
  const photoMap = new Map<string, string>()
  for (const row of data ?? []) {
    if (!photoMap.has(row.advertisement_id)) {
      photoMap.set(row.advertisement_id, row.s3_key)
    }
  }

  return listings.map((l) => {
    const s3Key = photoMap.get(l.external_id)
    return s3Key ? { ...l, image_url: `${MEDIA_BASE_URL}${s3Key}` } : l
  })
}
