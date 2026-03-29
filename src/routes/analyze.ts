import { Hono } from 'hono'
import { analyzePhotos } from '../services/vision.js'
import type { AnalyzeRequest } from '../types/index.js'

const analyze = new Hono()

analyze.post('/api/analyze-photo', async (c) => {
  const body = await c.req.json<AnalyzeRequest>()

  if (!body.photos?.length) {
    return c.json({ error: 'At least one photo is required' }, 400)
  }

  const result = await analyzePhotos(body.photos)
  return c.json(result)
})

export default analyze
