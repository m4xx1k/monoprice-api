import { openrouter, models } from '../db/openrouter.js'
import type { VisionResult } from '../types/index.js'

const VISION_PROMPT = `You are an expert at evaluating used goods. Analyze the photo and determine:

1. brand — brand name (or null if not visible)
2. model — model/name (or null)
3. condition — "new" | "excellent" | "good" | "fair" | "poor"
   - new: with tags, in packaging
   - excellent: like new, no signs of use
   - good: normal used condition, minor marks
   - fair: visible signs of use, scratches
   - poor: damaged, heavily worn
4. color — color (or null)
5. year — approximate year (or null)
6. details — what else you see: item type, accessories, defects, notable features

Reply ONLY with valid JSON, no markdown. Example:
{"brand":"Apple","model":"iPhone 13","condition":"good","color":"blue","year":2021,"details":"Smartphone, back panel, small scratch bottom-left corner, no case"}`

export async function analyzePhotos(photos: string[]): Promise<VisionResult> {
  const imageContent = photos.map((photo) => ({
    type: 'image_url' as const,
    image_url: {
      url: photo.startsWith('data:') ? photo : `data:image/jpeg;base64,${photo}`,
    },
  }))

  const response = await openrouter.chat.completions.create({
    model: models.vision,
    messages: [
      {
        role: 'user',
        content: [
          ...imageContent,
          { type: 'text', text: VISION_PROMPT },
        ],
      },
    ],
    max_tokens: 500,
    temperature: 0.1,
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  const cleaned = raw.replace(/```json\n?|```/g, '').trim()

  try {
    return JSON.parse(cleaned) as VisionResult
  } catch {
    return {
      brand: null,
      model: null,
      condition: 'good',
      color: null,
      year: null,
      details: raw,
    }
  }
}
