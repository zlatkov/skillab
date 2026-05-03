# AGENTS.md

## Monorepo Overview

This is a Turborepo monorepo with three Next.js apps:

```
apps/
├── home/       Personal home page (zlatkov.ai)
├── skillab/    Skill evaluator + dependency graph (skillab.zlatkov.ai)
└── ai-news/    AI news digest agent (ainews.zlatkov.ai)
```

Each app has its own `package.json`, `next.config.ts`, `tsconfig.json`, and `vercel.json` where applicable. They share no code packages — each `lib/` is app-local.

---

## apps/home

Static home page. No API routes, no environment variables at runtime. Links to other apps via `NEXT_PUBLIC_SKILLAB_URL` and `NEXT_PUBLIC_AINEWS_URL` (fall back to production URLs).

---

## apps/skillab

Web toolkit for testing and visualising AI Agent Skills (SKILL.md files).

```
apps/skillab/
├── app/
│   ├── page.tsx              # Main UI — skill input, tool selector, config, results
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── generate/route.ts # LLM proxy — createModel + generateText
│       └── providers/route.ts # Returns which providers have server-side API keys
└── lib/
    ├── types.ts              # Shared types, provider model presets, constants
    ├── skill.ts              # Skill parser, GitHub fetcher, context builder, dependency graph
    └── engine.ts             # Client-side evaluation pipeline with progress callbacks
```

### Key Design Decisions

- **Browser-first**: Parsing, context building, eval orchestration run client-side. The API route only exists to avoid CORS.
- **Three model roles**: test models (evaluated), generator models (create prompts), judge models (score responses).
- **Mock tools**: For compliance testing, mock tool definitions are injected so models can make real structured tool calls.

### Evaluation Pipeline

**Parse → Build Context → Generate Prompts → Test → Evaluate → Report**

1. `parseSkillContent()` — extracts name, description, body from SKILL.md frontmatter
2. `buildTriggerSystemPrompt()` — mixes target skill with distractor skills in `<available_skills>` XML
3. Generator model creates N positive + N negative test prompts
4. Each prompt → each test model via `/api/generate`
5. Judge model scores trigger accuracy; for triggered positive prompts, compliance is also scored
6. Results rendered per model with trigger/compliance breakdown

### Scoring

`overall = trigger_accuracy × 50 + compliance_accuracy × 30 + avg_compliance_score/100 × 20`

### Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | Optional | Server-side key for OpenRouter (users can BYOK) |
| `GROQ_API_KEY` | Optional | Server-side key for Groq |
| `ANTHROPIC_API_KEY` | Optional | Server-side key |
| `NEXT_PUBLIC_HOME_URL` | Dev only | Falls back to `https://zlatkov.ai` |

---

## apps/ai-news

Automated AI industry news digest. An agent runs on a cron schedule, fetches news from multiple sources, and stores scored/categorized results in Supabase.

```
apps/ai-news/
├── app/
│   ├── page.tsx              # Displays latest completed run, grouped by category
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       └── cron/route.ts     # Cron endpoint — runs agent, stores results
├── lib/
│   ├── types.ts              # NewsItem, NewsRun, CATEGORIES
│   ├── supabase.ts           # Supabase client (service role)
│   └── agent.ts              # Fetch + LLM scoring logic
└── vercel.json               # Cron schedule: 08:00 and 20:00 UTC daily
```

### How the Agent Works

1. **Parallel fetch** — HN Algolia API + 10 Brave Search queries fire simultaneously
2. **Single LLM call** — All raw results sent to OpenRouter (default: `google/gemini-2.5-flash`) with a scoring prompt
3. **Structured output** — LLM returns a JSON array of `NewsItem[]` with score ≥ 6
4. **Store** — Results written to Supabase `news_runs` table

This avoids multi-step agent overhead — parallel fetches + one LLM call is fast and deterministic.

### Supabase Schema

```sql
create table news_runs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  status text not null default 'running',  -- 'running' | 'complete' | 'error'
  items jsonb not null default '[]',
  item_count int not null default 0,
  error text
);
create index news_runs_created_at_idx on news_runs (created_at desc);
```

### Cron Protection

The `/api/cron` endpoint requires `Authorization: Bearer {CRON_SECRET}`. Vercel sends this header automatically for scheduled cron jobs. Manual calls without the secret return 401.

### News Categories

M&A · Funding · Product Launch · Model Release · AI Engineering · Research · Regulation · Partnership · Open Source · Industry

Items are scored 1-10; only score ≥ 6 are stored. Categories are sorted by item count on the page.

### Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes | For LLM scoring calls |
| `BRAVE_API_KEY` | Yes | For Brave Search queries |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (server-side only) |
| `CRON_SECRET` | Yes | Protects the cron endpoint |
| `OPENROUTER_MODEL` | No | Override model (default: `google/gemini-2.5-flash`) |
| `NEXT_PUBLIC_HOME_URL` | Dev only | Falls back to `https://zlatkov.ai` |
