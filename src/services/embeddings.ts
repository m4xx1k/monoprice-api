import { openrouter, models } from '../db/openrouter.js'

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openrouter.embeddings.create({
    model: models.embedding,
    input: text,
  })
  return response.data[0].embedding
}

/**
 * Build a search query from available info.
 * The richer the query — the better the vector match.
 */
export function buildSearchQuery(description: string, visionDetails?: string): string {
  const parts: string[] = []
  if (visionDetails) parts.push(visionDetails)
  parts.push(description)
  return parts.join(' ').slice(0, 2000)
}
