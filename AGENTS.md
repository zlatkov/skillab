# AGENTS.md

## Project Overview

`skillab` is a Next.js web app that provides tools for working with Agent Skills (SKILL.md files). It runs as a browser-first application — all orchestration logic executes client-side, with a single thin API route (`/api/generate`) that proxies LLM calls to avoid CORS restrictions.

## Architecture

```
app/
├── page.tsx              # Main UI: skill input, tool selector, config, results
├── layout.tsx            # Root layout with metadata
├── globals.css           # Dark theme, amber accent, custom scrollbar
└── api/
    └── generate/
        └── route.ts      # Thin LLM proxy — creates provider models, calls generateText

lib/
├── types.ts              # Shared types, provider model presets, constants
├── skill.ts              # Skill parser, GitHub fetcher, context builder, dependency graph
└── engine.ts             # Client-side evaluation pipeline with progress callbacks
```

## Key Design Decisions

- **Browser-first**: Parsing, context building, eval orchestration, and graph building all run in the browser. The API route only exists because LLM providers don't support CORS.
- **No CLI**: Previously a CLI tool, now purely a web app. No `bin`, no npm publishing.
- **Browser-compatible frontmatter parser**: Replaces `gray-matter` (which requires Node.js `fs`) with a custom parser that handles YAML block scalars (`>` and `|`).
- **GitHub API for repo scanning**: Uses the Git Trees API with `recursive=1` to find SKILL.md files. Runs client-side since GitHub API supports CORS.

## Three Model Roles

1. **Test models** — the models being evaluated. Receive the skill-injected prompt and are scored.
2. **Generator models** — generate test prompts from the skill definition. Configurable in Advanced Options.
3. **Judge models** — evaluate test model responses for trigger accuracy and compliance.

All three use the same provider. Each provider has preset defaults. Generator and judge models support fallback chains with retry.

## Tools

### Skill Evaluator

The evaluation pipeline runs in six stages: **Parse → Build Context → Generate Prompts → Test → Evaluate → Report**.

#### Parse
`lib/skill.ts` — `parseSkillContent()` extracts name, description, and body from SKILL.md content. Uses a custom `parseFrontmatter()` that handles YAML block scalars. Falls back to first heading for name, first paragraph for description.

#### Build Context
`lib/skill.ts` — `buildTriggerSystemPrompt()` and `buildComplianceSystemPrompt()`. The trigger prompt mixes the target skill with 3 dummy distractors (git-commit-helper, api-documentation, test-generator) plus any sibling skills from a batch. The compliance prompt includes full skill instructions.

#### Generate Test Prompts
`lib/engine.ts` — A generator model creates N positive + N negative test prompts. Falls back through the generator model list on failure with retry. Falls back to hardcoded generic prompts if all generators fail.

#### Run Trigger Tests
Each prompt is sent to each test model with the skill-injected system prompt via `/api/generate`.

#### Evaluate
A judge model evaluates each response:
- **Trigger judgment** — `{triggered, correct, reason}`
- **Compliance judgment** (positive prompts that triggered correctly) — The test model is re-prompted with full instructions. If the skill references tools (WebFetch, BraveSearch, WebSearch, Read, Write, Edit, Bash, Grep, Glob), mock tool definitions are provided so the model can make structured tool calls. The judge scores `{compliant, score (0-100), reason}`.

Each eval item makes 1 API call for negative prompts, or up to 3 for positive prompts (trigger judge + compliance run + compliance judge).

#### Report
Results displayed in a table per skill. Batch mode adds a combined summary with per-skill averages. JSON export available.

### Dependency Graph

`lib/skill.ts` — `buildDependencyGraph()` builds a graph between skills by scanning each skill's raw content for:
- **Name mentions** — word-boundary regex match for other skill names
- **Path references** — patterns like `skills/other-skill/`
- **Frontmatter fields** — skill names after `dependencies:`, `requires:`, `uses:`, `depends_on:`, or `related:`

Renders as a tree view with box-drawing characters plus an adjacency matrix. No API key required.

## API Route

`app/api/generate/route.ts` — Thin proxy that:
1. Creates a provider-specific model instance (OpenRouter, OpenAI, Anthropic, Google, Azure)
2. Calls `generateText()` from the Vercel AI SDK
3. Returns `{text, toolCalls, steps}`
4. Includes mock tool definitions when `useMockTools: true`
5. Enhanced error handling extracts underlying provider errors from AI SDK error wrappers

## Scoring

- **Overall score**: `trigger_accuracy × 50 + compliance_accuracy × 30 + avg_compliance_score/100 × 20`
- Trigger accuracy: correct triggers and correct non-triggers out of total prompts
- Compliance: only measured on positive prompts that correctly triggered

## Tech Stack

- Next.js 15 (App Router), React 19, TypeScript
- Tailwind CSS v4 (dark theme, amber accent `#f59e0b`)
- Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/azure`)
- Zod (schema validation for mock tools)

## Development

```bash
npm install
npm run dev
```

No environment variables needed for development — API keys are entered in the UI and sent per-request.

## Conventions

- All client-side code in `lib/` — no Node.js-specific APIs
- Provider model presets defined in `lib/types.ts` (`PROVIDER_MODELS`)
- Single `page.tsx` with sub-components (ModelPicker, GraphView, ResultsTable, etc.)
- Progress callbacks via `LogEntry` type for real-time UI updates during evaluation
