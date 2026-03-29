import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  // Supabase
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  // OpenRouter
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_VISION_MODEL: z.string().default('anthropic/claude-sonnet-4-20250514'),
  OPENROUTER_EMBEDDING_MODEL: z.string().default('openai/text-embedding-3-small'),

  // Server
  PORT: z.coerce.number().default(3000),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('❌ Missing env vars:')
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`)
    }
    process.exit(1)
  }
  return result.data
}

export const env = loadEnv()
