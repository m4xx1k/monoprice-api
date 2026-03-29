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

-- 3. Create photos table
-- NOTE: в реальній БД типи text (не uuid), advertisement_id nullable
create table if not exists photos (
  s3_key           text primary key,
  advertisement_id text
);

create index if not exists adv_photos_idx on photos(advertisement_id);

-- 4. Indexes
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
  external_id    uuid,
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
    id, external_id, title, description, image_url, sold_price, original_price,
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
  external_id    uuid,
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
    id, external_id, title, description, image_url, sold_price, original_price,
    created_at, modified_at,
    1 - (embedding <=> query_embedding) as similarity
  from listings
  where id = any(candidate_ids)
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
