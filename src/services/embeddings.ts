import OpenAI from 'openai'
import { env } from '../config/env.js'
import { openrouter } from '../db/openrouter.js'

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

export function buildSearchQuery(description: string): string {
  return description.slice(0, 2000)
}
