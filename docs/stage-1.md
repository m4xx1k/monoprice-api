# Stage 1: Foundation

Мета — зібрати working PoC, який приймає фото + опис і повертає ціну. Без SSE, без складних агрегацій, без LLM-прайсера. Тільки те, що потрібно щоб перевірити пайплайн end-to-end.

---

## Scope

**Є в Stage 1:**
- Hono сервер з двома ендпоінтами
- Supabase: таблиця listings з векторами, базовий RPC match_listings
- OpenRouter: vision (аналіз фото) + embeddings
- Простий SQL-based pricer (percentiles по sold_price знайдених аналогів)
- Завантаження датасету і генерація embeddings

**Немає в Stage 1:**
- SSE / streaming
- LLM-based pricer
- SQL views, тренди, аналітика по bargain
- Confidence score
- Pricing factors з відсотками
- A/B тестування
- Eval pipeline

---

## Ендпоінти

### `POST /api/analyze-photo`

Аналізує фото через Vision API, повертає структуровані дані про товар.

**Request:**
```json
{
  "photos": ["base64..."]
}
```

**Response:**
```json
{
  "brand": "Nike",
  "model": "Air Zoom Pegasus 39",
  "condition": "good",
  "color": "black",
  "year": null,
  "details": "Running sneakers, minor sole wear"
}
```

---

### `POST /api/price`

Приймає опис + vision result, повертає ціну. Синхронний — без SSE.

**Request:**
```json
{
  "description": "Nike кросівки, EU 42, стан хороший",
  "vision_result": { "...результат з analyze-photo..." },
  "category_id": 12
}
```

**Response:**
```json
{
  "price": {
    "fast": 1800.0,
    "balanced": 2100.0,
    "profit": 2500.0
  },
  "explanation": "Based on recent sales of similar items in good condition. Fast sells quickly, balanced is average market value, profit maximizes revenue.",
  "similar_products": [
    {
      "title": "Levi's White Sneakers, Size 39",
      "image_url": "https://example.com/images/product1.jpg",
      "sold_price": 1750.0,
      "sales_duration": 3
    },
    {
      "title": "Saucony Triumph 17, Blue/Black, US 8.5",
      "image_url": "https://example.com/images/product2.jpg",
      "sold_price": 2100.0,
      "sales_duration": 7
    },
    {
      "title": "Nike Air Zoom Pegasus 39, Black, EU 42",
      "image_url": "https://example.com/images/product3.jpg",
      "sold_price": 2500.0,
      "sales_duration": 14
    }
  ]
}
```

---

## База даних (Supabase)

### Таблиця `listings`

```sql
create table listings (
  id          bigserial primary key,
  title       text,
  description text,
  original_price numeric,
  sold_price  numeric,
  status      text,          -- ACTIVE | SOLD | DELETED | ...
  sold_via_bargain boolean,
  category_id int,
  created_at  timestamptz,
  modified_at timestamptz,   -- для SOLD = дата продажу
  image_url   text,          -- перше фото (для similar_products)
  embedding   vector(1536)
);
```

### RPC `match_listings`

Векторний пошук схожих товарів. Повертає топ-N за cosine similarity.

```sql
create or replace function match_listings(
  query_embedding vector(1536),
  match_count     int     default 20,
  filter_category int     default null,
  filter_status   text    default 'SOLD'
)
returns table (
  id            bigint,
  title         text,
  image_url     text,
  sold_price    numeric,
  original_price numeric,
  created_at    timestamptz,
  modified_at   timestamptz,
  similarity    float
)
language sql stable
as $$
  select
    id, title, image_url, sold_price, original_price,
    created_at, modified_at,
    1 - (embedding <=> query_embedding) as similarity
  from listings
  where
    status = coalesce(filter_status, status)
    and (filter_category is null or category_id = filter_category)
    and sold_price is not null
    and sold_price > 0
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

---

## Логіка прайсингу (Stage 1)

Після того як знайдені аналоги через vector search:

1. Беремо `sold_price` топ-N знайдених товарів
2. `fast` = 20-й перцентиль (нижня частина ринку — продається швидко)
3. `balanced` = медіана (50-й перцентиль)
4. `profit` = 80-й перцентиль (верхня частина ринку)
5. `explanation` — шаблонний текст з кількістю аналогів
6. `similar_products` — топ-3 найближчих за similarity, з `sales_duration` = різниця між `modified_at` і `created_at` в днях

---

## Структура сервісів

```
src/
├── index.ts                  # Hono app, реєстрація роутів
├── config/
│   └── env.ts                # Zod-валідація env змінних
├── db/
│   ├── supabase.ts           # Supabase client
│   └── openrouter.ts         # OpenAI SDK з OpenRouter base URL
├── routes/
│   ├── analyze.ts            # POST /api/analyze-photo
│   └── price.ts              # POST /api/price
└── services/
    ├── vision.ts             # Виклик Vision API, парсинг відповіді
    ├── embeddings.ts         # Генерація embedding для тексту
    ├── search.ts             # Виклик match_listings RPC
    └── pricer.ts             # Перцентильний розрахунок ціни
```

---

## Env змінні

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_VISION_MODEL=anthropic/claude-sonnet-4-20250514
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small

PORT=3000
```

---

## Чеклист Stage 1

- [ ] `config/env.ts` — Zod схема для всіх env змінних
- [ ] `db/supabase.ts` — Supabase client
- [ ] `db/openrouter.ts` — OpenAI SDK з OpenRouter base URL
- [ ] Supabase: створити таблицю listings + RPC match_listings
- [ ] `services/vision.ts` — аналіз фото через Vision API
- [ ] `services/embeddings.ts` — генерація embedding
- [ ] `services/search.ts` — виклик match_listings
- [ ] `services/pricer.ts` — перцентильний розрахунок
- [ ] `routes/analyze.ts` — POST /api/analyze-photo
- [ ] `routes/price.ts` — POST /api/price
- [ ] `index.ts` — зібрати все разом
- [ ] Завантажити датасет у Supabase (скрипт)
- [ ] Згенерувати embeddings для всіх лістингів (скрипт)
- [ ] Smoke test обох ендпоінтів

---

## Що залишається на Stage 2

- SSE streaming для /api/price
- LLM-based pricer з поясненням на основі аналізу
- SQL аналітика: bargain discount, тренди по часу
- Confidence score
- Pricing factors з поясненням впливу
- Eval pipeline (MAE/MAPE)
- Деплой на Railway
