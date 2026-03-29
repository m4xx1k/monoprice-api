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

  await new Promise((resolve) => setTimeout(resolve, 2000))

  return c.json({
    price: {
      fast: 1700.0,
      balanced: 2100.0,
      profit: 2500.0,
    },
    explanation:
      'Ціну розраховано на основі 14 схожих проданих товарів. У середньому їх купували за 6 дн., у 42% випадків відбувався торг. Балансована ціна відповідає середній ринковій.',
    similar_products: [
      {
        title: "Levi's White Sneakers, Size 39",
        image_url: 'https://i.ebayimg.com/images/g/5YoAAeSwC4ZpvoCW/s-l1200.webp',
        sold_price: 1750.0,
        sales_duration: 3,
      },
      {
        title: 'Saucony Triumph 17, Blue/Black, US 8.5',
        image_url: 'https://i.ebayimg.com/00/s/MTA5N1gxMjc4/z/fhEAAOSwru1ipDPP/$_57.JPG?',
        sold_price: 2100.0,
        sales_duration: 7,
      },
      {
        title: 'Nike Air Zoom Pegasus 39, Black, EU 42',
        image_url: 'https://i.ebayimg.com/images/g/8X4AAOSwfoNlxzTe/s-l400.png',
        sold_price: 2500.0,
        sales_duration: 14,
      },
    ],
  })
})

export default product
