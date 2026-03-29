import OpenAI from 'openai'
import { env } from '../config/env.js'

export const openrouter = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://monobazar-pricer.app',
    'X-Title': 'MonoBazar Pricer',
  },
})

export const models = {
  vision: env.OPENROUTER_VISION_MODEL,
  embedding: env.OPENROUTER_EMBEDDING_MODEL,
} as const
