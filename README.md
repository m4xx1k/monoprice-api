# monopricer

AI-агент для оцінки ціни вживаних товарів на монобазарі.

Отримує опис товару → знаходить схожі оголошення → повертає рекомендовану ціну з трьома стратегіями продажу.

---

## Як це працює

```
Опис товару
    ↓
OpenAI text-embedding-3-small → вектор
    ↓
pgvector (cosine similarity) → 20 схожих оголошень
    ↓
Фільтрація (similarity ≥ 0.50, мін. 3 аналоги)
    ↓
Перцентильна статистика по sold_price
    ↓
Ціна + стратегії + компаративи
```

---

## Ендпоінт

### `POST /v2/product/estimate`

**Body:**
```json
{
  "description": "iPhone 14 Pro 256GB, стан хороший, є подряпини на корпусі",
  "title": "iPhone 14 Pro",   // optional
  "category": 42              // optional
}
```

**Response:**
```json
{
  "price": {
    "min": 28160,       // p20 × 0.88 — продати швидко
    "balanced": 35840,  // p50 × 1.12 — збалансовано
    "profit": 42480     // p80 × 1.18 — максимальний прибуток
  },
  "days_to_sell": {
    "min": 2,
    "max": 14
  },
  "statistics": {
    "bargain_percentage": 63.5
  },
  "similar_products": {
    "sold": [ ... ],   // аналоги що продались (з фото і цінами)
    "active": [ ... ]  // активні оголошення прямо зараз
  }
}
```

**Помилки:**
- `400` — немає `description`
- `422` — недостатньо аналогів для оцінки (<3)

---

## Логіка ціни

Беремо `sold_price` з відфільтрованих аналогів, сортуємо та рахуємо перцентилі:

| Стратегія | Формула | Сенс |
|-----------|---------|------|
| `min` | p20 × 0.88 | Швидкий продаж |
| `balanced` | p50 × 1.12 | Оптимальна ціна |
| `profit` | p80 × 1.18 | Максимум прибутку |

---

## Технології

| Шар | Технологія |
|-----|-----------|
| Framework | [Hono](https://hono.dev) + Node.js |
| Embeddings | OpenAI `text-embedding-3-small` |
| Vector DB | Supabase + PostgreSQL + pgvector (HNSW) |
| Vision | GPT-4o-mini (опис товару з фото) |
| Validation | Zod |
| Image processing | sharp |

---

## Запуск

```bash
cp .env.example .env   # заповнити змінні
npm install
npm run dev
```

**Змінні середовища:**
```
SUPABASE_URL
SUPABASE_SERVICE_KEY
OPENAI_API_KEY
PORT (default: 3000)
```
