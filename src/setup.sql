-- ============================================
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Create listings table
create table if not exists listings (
  id               bigserial primary key,
  external_id      uuid unique,
  title            text,
  description      text,
  original_price   numeric,
  sold_price       numeric,
  status           text,
  sold_via_bargain boolean,
  category_id      int,
  category_name    text,
  created_at       timestamptz,
  modified_at      timestamptz,
  image_url        text,
  embedding        vector(1536)
);

-- 3. Indexes
create index if not exists listings_category_idx on listings(category_id);
create index if not exists listings_status_idx   on listings(status);
create index if not exists listings_embedding_idx on listings using hnsw (embedding vector_cosine_ops);

-- 4. Vector search RPC
create or replace function match_listings(
  query_embedding vector(1536),
  match_count     int  default 20,
  filter_category int  default null,
  filter_status   text default 'SOLD'
)
returns table (
  id             bigint,
  title          text,
  description    text,
  image_url      text,
  sold_price     numeric,
  original_price numeric,
  created_at     timestamptz,
  modified_at    timestamptz,
  similarity     float
)
language sql stable as $$
  select
    id, title, description, image_url, sold_price, original_price,
    created_at, modified_at,
    1 - (embedding <=> query_embedding) as similarity
  from listings
  where category_id = filter_category
    and status = 'SOLD'
  order by embedding <=> query_embedding
  limit match_count;
$$;


-- 5. Vector search among specific IDs (used after init pre-filters candidates)
create or replace function match_listings_by_ids(
  query_embedding vector(1536),
  candidate_ids   bigint[],
  match_count     int default 10
)
returns table (
  id             bigint,
  title          text,
  description    text,
  image_url      text,
  sold_price     numeric,
  original_price numeric,
  created_at     timestamptz,
  modified_at    timestamptz,
  similarity     float
)
language sql stable as $$
  select
    id, title, description, image_url, sold_price, original_price,
    created_at, modified_at,
    1 - (embedding <=> query_embedding) as similarity
  from listings
  where id = any(candidate_ids)
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- 6. Analytics RPC functions

create or replace function get_status_distribution()
returns table (status text, count bigint)
language sql stable as $$
  select status, count(*)
  from listings
  group by status
  order by count(*) desc;
$$;

create or replace function get_category_distribution()
returns table (category_id int, category_name text, total bigint, with_embedding bigint)
language sql stable as $$
  select
    category_id,
    category_name,
    count(*) as total,
    count(embedding) as with_embedding
  from listings
  group by category_id, category_name
  order by total desc;
$$;

create or replace function get_price_stats()
returns table (
  category_name text,
  sold_count bigint,
  avg_sold_price numeric,
  median_sold_price numeric,
  min_sold_price numeric,
  max_sold_price numeric,
  avg_bargain_discount numeric
)
language sql stable as $$
  select
    category_name,
    count(*) as sold_count,
    round(avg(sold_price), 2) as avg_sold_price,
    round(percentile_cont(0.5) within group (order by sold_price)::numeric, 2) as median_sold_price,
    min(sold_price) as min_sold_price,
    max(sold_price) as max_sold_price,
    round(avg(
      case when sold_via_bargain and original_price > 0
        then (1 - sold_price / original_price) * 100
        else null
      end
    ), 1) as avg_bargain_discount
  from listings
  where
    status = 'SOLD'
    and embedding is not null
    and sold_price > 0
  group by category_name
  order by sold_count desc;
$$;
