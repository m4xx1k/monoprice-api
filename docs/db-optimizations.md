# DB Optimizations (TODO)

Зміни для прискорення пошуку. Виконувати в Supabase SQL Editor коли буде час.

## 1. Partial HNSW індекс для SOLD

Зараз vector search сканує всі рядки з embedding, а потім фільтрує по `status = 'SOLD'`. Більшість відкидається — тому пошук повільний.

Partial індекс будує HNSW тільки по SOLD записах з ціною — пошук йде тільки серед них.

```sql
create index if not exists listings_embedding_sold_idx
  on listings using hnsw (embedding vector_cosine_ops)
  where status = 'SOLD' and sold_price > 0;
```

**Очікуваний ефект:** search 1.5s → ~50ms

**Ризик:** мінімальний, це новий індекс, нічого не змінює в даних. Побудова може зайняти 1-2 хвилини на 60k рядків.

## 2. REINDEX існуючого індексу

Якщо embeddings додавались поступово, HNSW індекс може бути фрагментований:

```sql
reindex index listings_embedding_idx;
```

## 3. Перевірка що індекс використовується

```sql
explain analyze
select id, 1 - (embedding <=> (select embedding from listings where embedding is not null limit 1)) as similarity
from listings
where status = 'SOLD' and sold_price > 0
order by embedding <=> (select embedding from listings where embedding is not null limit 1)
limit 10;
```

Має бути `Index Scan using listings_embedding_sold_idx`, а не `Seq Scan`.
