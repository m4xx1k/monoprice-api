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
--    filter_category = null  → no category filter
--    filter_statuses = null  → no status filter
create or replace function match_listings(
  query_embedding   vector(1536),
  match_count       int    default 20,
  filter_category   int    default null,
  filter_statuses   text[] default null
)
returns table (
  id               bigint,
  external_id      uuid,
  title            text,
  description      text,
  image_url        text,
  sold_price       numeric,
  original_price   numeric,
  status           text,
  sold_via_bargain boolean,
  category_id      int,
  category_name    text,
  created_at       timestamptz,
  modified_at      timestamptz,
  similarity       float
)
language sql stable as $$
  select
    l.id, l.external_id, l.title, l.description, l.image_url,
    l.sold_price, l.original_price, l.status, l.sold_via_bargain,
    l.category_id, l.category_name, l.created_at, l.modified_at,
    1 - (l.embedding <=> query_embedding) as similarity
  from listings l
  where l.embedding is not null
    and (filter_category is null or l.category_id = filter_category)
    and (filter_statuses is null or l.status = any(filter_statuses))
  order by l.embedding <=> query_embedding
  limit match_count;
$$;


-- 5. Vector search among specific IDs (used after init pre-filters candidates)
--    filter_statuses = null  → no status filter
create or replace function match_listings_by_ids(
  query_embedding   vector(1536),
  candidate_ids     bigint[],
  match_count       int    default 10,
  filter_statuses   text[] default null
)
returns table (
  id               bigint,
  external_id      uuid,
  title            text,
  description      text,
  image_url        text,
  sold_price       numeric,
  original_price   numeric,
  status           text,
  sold_via_bargain boolean,
  category_id      int,
  category_name    text,
  created_at       timestamptz,
  modified_at      timestamptz,
  similarity       float
)
language sql stable as $$
  select
    l.id, l.external_id, l.title, l.description, l.image_url,
    l.sold_price, l.original_price, l.status, l.sold_via_bargain,
    l.category_id, l.category_name, l.created_at, l.modified_at,
    1 - (l.embedding <=> query_embedding) as similarity
  from listings l
  where l.id = any(candidate_ids)
    and l.embedding is not null
    and (filter_statuses is null or l.status = any(filter_statuses))
  order by l.embedding <=> query_embedding
  limit match_count;
$$;
