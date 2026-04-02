import OpenAI from 'openai'
import sharp from 'sharp'
import { env } from '../config/env.js'

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY })

const PROMPT = 'Коротко опиши цей товар для оголошення на маркетплейсі вживаних речей. Вкажи тип товару, бренд, модель, стан та ключові характеристики в 1-3 реченнях. Відповідай українською мовою.'

async function compressImage(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const compressed = await sharp(buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer()
  return compressed.toString('base64')
}

export async function describePhotos(photos: File[]): Promise<string> {
  const imageContent = await Promise.all(
    photos.map(async (file) => {
      const data = await compressImage(file)
      return {
        type: 'image_url' as const,
        image_url: { url: `data:image/jpeg;base64,${data}` },
      }
    })
  )

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [...imageContent, { type: 'text', text: PROMPT }],
      },
    ],
    max_tokens: 200,
  })

  return response.choices[0]?.message?.content ?? ''
}