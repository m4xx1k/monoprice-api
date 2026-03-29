import { Hono } from 'hono'

const product = new Hono()

product.post('/v1/product/init', async (c) => {
  const body = await c.req.parseBody({ all: true })

  const id = body['id']
  const title = body['title']
  const category = body['category']
  const photos = body['photos']

  if (!id || !title || !category || !photos) {
    return c.json({ error: 'id, title, category and at least one photo are required' }, 400)
  }

  return c.body(null, 204)
})

product.post('/v1/product/description', async (c) => {
  const body = await c.req.json<{ id: string; description: string }>()

  if (!body.id || !body.description) {
    return c.json({ error: 'id and description are required' }, 400)
  }

  return c.json({
    price: {
      fast: 1800.0,
      balanced: 2100.0,
      profit: 2500.0,
    },
    explanation:
      'Based on recent sales of similar items in good condition. Fast sells quickly, balanced is average market value, profit maximizes revenue.',
    similar_products: [
      {
        title: "Levi's White Sneakers, Size 39",
        image_url: 'https://example.com/images/product1.jpg',
        sold_price: 1750.0,
        sales_duration: 3,
      },
    ],
  })
})

export default product
