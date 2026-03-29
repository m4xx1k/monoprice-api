import OpenAI from 'openai'
import { env } from '../config/env.js'
import { openrouter, models } from '../db/openrouter.js'

// Use OpenAI directly if key provided (faster, no proxy overhead)
// Otherwise fall back to OpenRouter
const embeddingClient = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
  : openrouter

const embeddingModel = env.OPENAI_API_KEY
  ? env.OPENROUTER_EMBEDDING_MODEL   // e.g. "text-embedding-3-small"
  : `openai/${env.OPENROUTER_EMBEDDING_MODEL}` // OpenRouter needs prefix

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await embeddingClient.embeddings.create({
    model: embeddingModel,
    input: text,
  })
  return response.data[0].embedding
}

export function buildSearchQuery(description: string, visionDetails?: string): string {
  const parts: string[] = []
  if (visionDetails) parts.push(visionDetails)
  parts.push(description)
  return parts.join(' ').slice(0, 2000)
}
