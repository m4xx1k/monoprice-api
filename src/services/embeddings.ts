import OpenAI from 'openai'
import { env } from '../config/env.js'

const embeddingClient = new OpenAI({ apiKey: env.OPENAI_API_KEY })
const embeddingModel = env.OPENROUTER_EMBEDDING_MODEL

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await embeddingClient.embeddings.create({
    model: embeddingModel,
    input: text,
  })
  return response.data[0].embedding
}

