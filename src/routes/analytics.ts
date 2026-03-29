import { Hono } from 'hono'
import { supabase } from '../db/supabase.js'

const analytics = new Hono()

analytics.get('/api/analytics', async (c) => {
  // Run all queries in parallel
  const [totalRes, embeddingRes, statusRows, categoryRows, priceRows] = await Promise.all([
    // Total count
    supabase
      .from('listings')
      .select('*', { count: 'exact', head: true }),

    // With embedding count
    supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null),

    // Status distribution — use RPC to avoid 1000-row REST limit
    supabase.rpc('get_status_distribution'),

    // Category distribution (only rows with embeddings)
    supabase.rpc('get_category_distribution'),

    // Price stats by category (only SOLD with embeddings)
    supabase.rpc('get_price_stats'),
  ])

  if (statusRows.error || categoryRows.error || priceRows.error) {
    const missing = [
      statusRows.error && 'get_status_distribution',
      categoryRows.error && 'get_category_distribution',
      priceRows.error && 'get_price_stats',
    ].filter(Boolean)

    return c.json({
      error: `Missing RPC functions: ${missing.join(', ')}. Run the analytics SQL setup first.`,
    }, 500)
  }

  return c.json({
    total: totalRes.count ?? 0,
    with_embedding: embeddingRes.count ?? 0,
    without_embedding: (totalRes.count ?? 0) - (embeddingRes.count ?? 0),
    statuses: statusRows.data,
    categories: categoryRows.data,
    price_stats: priceRows.data,
  })
})

export default analytics
