create table if not exists news_runs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  status text not null default 'running',   -- 'running' | 'complete' | 'error'
  items jsonb not null default '[]',        -- array of NewsItem objects
  item_count int not null default 0,
  error text
);

create index if not exists news_runs_created_at_idx on news_runs (created_at desc);
