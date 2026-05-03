create table if not exists cron_runs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  completed_at timestamptz,
  status text not null default 'running',   -- 'running' | 'complete' | 'error'
  entries_count int not null default 0,
  providers_count int not null default 0,
  error text
);

create index if not exists cron_runs_created_at_idx on cron_runs (created_at desc);

create table if not exists model_snapshots (
  id uuid default gen_random_uuid() primary key,
  run_id uuid references cron_runs(id) on delete cascade not null,
  created_at timestamptz default now(),

  -- Model identity
  model_id text not null,           -- e.g. 'meta-llama/Llama-3.1-70B-Instruct'
  model_name text not null,
  family text not null,             -- 'llama', 'mistral', 'qwen', etc.
  params text,                      -- '7b', '70b', '8x7b', etc.

  -- Provider
  provider_id text not null,        -- 'groq', 'together', 'deepinfra', etc.
  provider_model_id text not null,  -- provider's own model identifier

  -- Pricing (USD per 1M tokens)
  input_price numeric,
  output_price numeric,

  -- Availability
  free_tier boolean not null default false,
  context_length int,

  -- Rate limits
  rpm int,   -- requests per minute
  tpm int,   -- tokens per minute
  rpd int,   -- requests per day

  -- Extra
  quantization text,
  source text not null default 'direct',   -- 'direct' | 'openrouter'

  unique (run_id, model_id, provider_id)
);

create index if not exists model_snapshots_run_id_idx on model_snapshots (run_id);
create index if not exists model_snapshots_model_id_idx on model_snapshots (model_id);
create index if not exists model_snapshots_provider_id_idx on model_snapshots (provider_id);
create index if not exists model_snapshots_family_idx on model_snapshots (family);
