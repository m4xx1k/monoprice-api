# monopricer

## Хакатон

**SKELAR x mono AI Competition 2026**

Хакатон від SKELAR та monobank. Задача — побудувати AI-агента-прайсера для монобазару (сервіс продажу вживаних речей у застосунку monobank, розділ Маркет → Базар).

---

## Завдання

Коли продаєш вживану річ — часто не знаєш актуальної вартості. Починаєш гуглити, прицінюватися на різних платформах і подумки торгуватися із собою.

Побудувати AI-агента-прайсера, який із опису користувача та фото товару генерує:

1. **Рекомендовану ціну та ціновий діапазон**
2. **Стратегії продажу** (наприклад, fast / balanced / max profit)
3. **Пояснення ціни**, яке спирається на докази (компаративи / фактори ціноутворення)

### Вхід агента

| # | Параметр | Обов'язковість |
|---|----------|---------------|
| 1 | Опис продавця (текст) | Так |
| 2 | 1–5 фото | Так |
| 3 | Категорія товару | Опціонально |

### Вихід агента

Пропозиція ціни для оголошення продавця.

---

## Критерії оцінювання

1. **Довіра до ціни** — продуктове рішення для формування довіри користувача до сформованої ціни (ціновий діапазон, пояснення з доказами, компаративи).

2. **Швидкість ≤ 5 секунд** — цільовий час відпрацювання всього пайплайну, щоб забезпечити вбудовування в синхронний флоу взаємодії з користувачем.

3. **Стратегії продажу** — продуктове та технічне рішення, яке задовольняє потреби продавця й платформи у формуванні успішної завершеної угоди, з опорою на аналіз ринку.

4. **Вартість одного запиту** — на цьому етапі не є фокусом, але враховується.

5. **PoC** — готове працююче технічне рішення (Proof of Concept).

6. **Візуалізація флоу** (бонус) — мобільний UI відповідно до флоу створення оголошення на монобазарі. Інтерактивний UI не обов'язковий, може бути концептом/дизайном.

---

## Датасет

Організатори надають корпус оголошень монобазару.

### Колонки

| Колонка | Опис |
|---------|------|
| `status` | Поточний статус оголошення |
| `title` | Короткий опис оголошення |
| `description` | Повний опис оголошення |
| `original_price` | Ціна встановлена продавцем |
| `sold_price` | Ціна продажу (фактична) |
| `sold_via_bargain` | Прапорець продажу через торги (впливає на різницю між original_price та sold_price) |
| `created_at` | Дата створення оголошення |
| `modified_at` | Дата останньої модифікації (для SOLD — фактично дата продажу) |
| `category_id` | ID категорії (відповідає `category_dictionary.json`) |

### Життєвий цикл статусів

```
ACTIVE → RESERVED → ORDER_PROCESSING → SOLD
```

- `ACTIVE` — оголошення опубліковане
- `RESERVED` — покупець зарезервував
- `ORDER_PROCESSING` — оформлення угоди
- `SOLD` — продано (modified_at = дата продажу)
- `DELETED` — видалено користувачем вручну

### Важливі нюанси

- `sold_price` — реальна ринкова ціна, найцінніший сигнал
- `original_price` vs `sold_price` + `sold_via_bargain` — показує наскільки продавці завищують ціну і як торг впливає на фінальну ціну
- `modified_at` для SOLD записів — дата продажу, дозволяє будувати тренди
- `DELETED` оголошення — можуть бути корисні для аналізу (товари що не продалися)

---

## Наш флоу

### Екран 1: Завантаження товару

```
Юзер завантажує фото (1-5)
    │
    ├──→ POST /api/analyze-photo (фонова задача)
    │    Vision AI аналізує фото → бренд, модель, стан, деталі
    │    Працює поки юзер пише опис (~2-3 сек)
    │
Юзер вводить опис товару
Юзер обирає категорію (опціонально)
    │
    └──→ Натискає "Оцінити ціну"
```

### Екран 2: Результат (SSE stream, ≤ 2-3 сек)

```
1. Формуємо embedding з опису + vision output + категорія
2. Vector search — шукаємо схожі товари в Supabase (pgvector)
   Фільтри: категорія, дата публікації/продажу, статус
3. SQL аналітика — агрегуємо статистику по аналогах
   (sold vs active ціни, тренди, розкид)
4. [Опціонально] LLM — формує пояснення та рекомендації

Результат:
├── Рекомендована ціна + діапазон
├── 3 стратегії (fast / balanced / max profit)
├── Пояснення з факторами ціноутворення
├── Список компаративів (аналогічні товари)
└── Confidence score
```

### Чому цей флоу швидкий

Vision працює у фоні поки юзер пише опис. Коли він натискає "Оцінити" — vision вже готовий. Залишається тільки embedding + search + pricing = ~2-3 секунди. Вписуємось у ліміт 5 секунд з запасом.

---

## Техстек

| Компонент | Технологія | Обґрунтування |
|-----------|-----------|---------------|
| Backend | Node.js + Hono + TypeScript | Легкий, SSE з коробки, швидкий старт |
| Database + Vectors | Supabase (PostgreSQL + pgvector) | Одна БД для всього: вектори, аналітика, SQL |
| AI Gateway | OpenRouter | Один API для різних моделей, швидке тестування |
| Vision | Claude Sonnet / GPT-4o (через OpenRouter) | Розпізнавання товару з фото |
| Embeddings | OpenAI text-embedding-3-small (через OpenRouter) | 1536 dims, дешево, швидко |
| LLM Pricing | Claude Sonnet (через OpenRouter) | Structured output, якісний reasoning |
| Deploy | Railway | Автодеплой з GitHub, швидко |
| Mobile | Swift (iOS) | Нативний клієнт |

---

## Архітектура

```
┌──────────────┐
│  Swift App   │
│  (iOS)       │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────┐
│  Node.js API  (Hono)                 │
│                                      │
│  POST /api/analyze-photo             │
│    → OpenRouter Vision API           │
│    → VisionResult (brand, model...)  │
│                                      │
│  POST /api/price  (SSE stream)       │
│    → OpenRouter Embeddings API       │
│    → Supabase pgvector search        │
│    → Supabase SQL analytics          │
│    → [Optional] OpenRouter LLM       │
│    → PriceResult                     │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Supabase (PostgreSQL + pgvector)    │
│                                      │
│  listings table                      │
│    - title, description              │
│    - original_price, sold_price      │
│    - status, sold_via_bargain        │
│    - category_id                     │
│    - created_at, modified_at         │
│    - embedding vector(1536)          │
│                                      │
│  RPC: match_listings()              │
│  Views: category_stats, price_trends│
└──────────────────────────────────────┘
```

---

## Структура проєкту

```
monopricer-api/
├── src/
│   ├── index.ts                 # Hono сервер + middleware
│   ├── config/
│   │   └── env.ts               # Env vars з zod валідацією
│   ├── db/
│   │   ├── supabase.ts          # Supabase клієнт
│   │   └── openrouter.ts        # OpenRouter клієнт (OpenAI SDK)
│   ├── routes/
│   │   ├── analyze.ts           # POST /api/analyze-photo
│   │   └── price.ts             # POST /api/price (SSE)
│   ├── services/
│   │   ├── vision.ts            # Аналіз фото через Vision API
│   │   ├── embeddings.ts        # Генерація embeddings
│   │   ├── search.ts            # Vector search + SQL аналітика
│   │   └── pricer.ts            # Pricing (LLM або SQL варіант)
│   └── types/
│       └── index.ts             # Всі типи (контракти з клієнтом)
├── supabase-setup.sql           # SQL для налаштування БД
├── .env.example                 # Шаблон змінних оточення
├── package.json
├── tsconfig.json
└── README.md
```

---

## API контракти

### `POST /api/analyze-photo`

Викликається одразу при завантаженні фото (у фоні).

**Request:**
```json
{
  "photos": ["base64..."]
}
```

**Response:**
```json
{
  "brand": "Apple",
  "model": "iPhone 13",
  "condition": "good",
  "color": "синій",
  "year": 2021,
  "details": "Смартфон, задня панель, подряпина в нижньому лівому куті"
}
```

### `POST /api/price`

SSE stream. Викликається коли юзер натисне "Оцінити".

**Request:**
```json
{
  "description": "iPhone 13 128GB, стан хороший",
  "vision_result": { "...результат з analyze-photo..." },
  "category_id": 5,
  "photos": ["base64..."]
}
```

**SSE Events:**
```
data: {"type":"step","step":"search","status":"processing","message":"Шукаю аналоги..."}
data: {"type":"step","step":"search","status":"done","message":"Знайшов 18 схожих товарів","data":{"count":18}}
data: {"type":"step","step":"pricing","status":"processing","message":"Рахую ціну..."}
data: {"type":"result","data":{"recommended_price":8500,...}}
```

**Result payload:**
```json
{
  "recommended_price": 8500,
  "price_range": { "min": 7200, "max": 10000 },
  "confidence": "high",
  "strategies": {
    "fast": { "price": 7200, "estimated_days": "1-3", "tip": "..." },
    "balanced": { "price": 8500, "estimated_days": "5-10", "tip": "..." },
    "max_profit": { "price": 10000, "estimated_days": "14-30", "tip": "..." }
  },
  "explanation": "Ціна базується на 18 аналогах...",
  "pricing_factors": [
    { "factor": "Бренд Apple", "impact": "+20%" },
    { "factor": "Подряпини", "impact": "-5%" }
  ],
  "comparables": [
    { "description": "iPhone 13 128GB білий", "price": 8200, "is_sold": true, "similarity": 0.94 }
  ],
  "detected_item": {
    "brand": "Apple",
    "model": "iPhone 13",
    "condition": "good",
    "color": "синій",
    "year": 2021,
    "details": "..."
  }
}
```

---

## План імплементації

### Фаза 1: Фундамент (зараз)

- [x] Структура проєкту, типи, конфігурація
- [ ] Supabase: створити таблицю listings, RPC, views
- [ ] OpenRouter: підключити vision + embeddings
- [ ] Endpoint POST /api/analyze-photo
- [ ] Endpoint POST /api/price (SSE каркас)
- [ ] Базовий SQL-based pricer (працює без LLM)

### Фаза 2: Дата

- [ ] Завантажити датасет у Supabase
- [ ] Чистка: видалити price=0, outliers, дублі
- [ ] Маппінг category_id → category_dictionary.json
- [ ] Генерація embeddings для всіх лістингів
- [ ] Заливка embeddings у Supabase

### Фаза 3: Якість прайсингу

- [ ] Тюнінг vector search (фільтри, ваги sold vs active)
- [ ] SQL аналітика: sold_price vs original_price, торг, тренди
- [ ] LLM-based pricer з промптом
- [ ] A/B: SQL-only vs LLM — порівняти якість

### Фаза 4: Полірування

- [ ] Eval pipeline: 200 лістингів → метрики (MAE, MAPE, hit rate)
- [ ] Edge cases: рідкісні товари, дуже дорогі, DELETED
- [ ] Оптимізація швидкості (паралелізація, кешування)
- [ ] Деплой на Railway

### Фаза 5: Бонуси

- [ ] Мобільний UI концепт / дизайн
- [ ] Price trends графік
- [ ] Використання sold_via_bargain для коригування ціни
- [ ] Аналіз DELETED оголошень (що не продається)

---

## Ключові інсайти з датасету

Речі які треба використати для якісного прайсингу:

- **sold_price > original_price** — `sold_price` це реальна ціна, `original_price` — бажання продавця. Рекомендацію базуємо на `sold_price`.
- **sold_via_bargain** — якщо true, значить фінальна ціна нижча за оригінальну через торг. Можна рахувати середній % знижки через торг по категоріях.
- **DELETED** — оголошення що не продалися. Якщо товар схожий на DELETED — це сигнал що ціна завищена або товар непопулярний.
- **modified_at для SOLD** — дата продажу. Дозволяє будувати тренди: ціна на iPhone падає кожен вересень коли виходить новий.
- **Час між created_at і modified_at (для SOLD)** — скільки днів продавався. Це основа для стратегій fast/balanced/max.

---

## Env змінні

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# OpenRouter
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_VISION_MODEL=anthropic/claude-sonnet-4-20250514
OPENROUTER_PRICING_MODEL=anthropic/claude-sonnet-4-20250514
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small

# Server
PORT=3000
USE_LLM=true
```