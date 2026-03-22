# AGENTS.md

## Project Overview

`skilleval` is a CLI tool that evaluates how well AI models understand and follow Agent Skills (SKILL.md files). It simulates how AI agents inject skills into prompts, then tests whether various LLM models correctly trigger and follow the skill's instructions. The test model is presented as a helpful AI agent (not a coding-specific agent) with access to multiple skills.

## Architecture

The pipeline runs in four stages: **Parse → Generate → Test → Evaluate**.

```
src/
├── index.ts            # CLI entrypoint (Commander.js), wires the pipeline
├── config.ts           # Types, interfaces, constants, default model lists
├── parser.ts           # Loads SKILL.md from local path, GitHub URL, or owner/repo shorthand
├── providers.ts        # Factory for Vercel AI SDK LanguageModel instances (OpenRouter, Anthropic, OpenAI, Google)
├── context-builder.ts  # Builds system prompts with skill XML injection and dummy distractor skills
├── test-generator.ts   # Uses an LLM to generate 5 positive + 5 negative test prompts
├── runner.ts           # Sends test prompts to each target model and records responses
├── evaluator.ts        # LLM-as-judge: evaluates trigger accuracy and instruction compliance
└── reporter.ts         # Renders results as a table or JSON
```

## Three Model Roles

1. **Generator models** — generate test prompts from the skill definition. Always use OpenRouter.
2. **Test models** — the models being evaluated. Use the provider specified by `--provider`.
3. **Judge models** — evaluate test model responses. Always use OpenRouter.

Generator and judge models support comma-separated fallbacks and retry with delay.

## Pipeline Detail

### 1. Parse
Reads the SKILL.md from a local path, GitHub URL, or `owner/repo` shorthand. Extracts the skill's `name`, `description`, and instruction body from YAML frontmatter and markdown content using `gray-matter`.

### 2. Build context
Constructs the system prompt using `<available_skills>` XML injection — the same format agents use in production. The target skill is mixed in with 3 dummy distractor skills (git-commit-helper, api-documentation, test-generator) to test whether the model can identify the correct skill from a list.

### 3. Generate test prompts
A **generator model** creates 10 test prompts from the skill definition:
- 5 **positive** prompts — realistic user requests that should trigger the skill
- 5 **negative** prompts — related but out-of-scope requests that should not trigger it

Falls back to hardcoded generic prompts if generation fails. Custom prompts can be provided via `--prompts`.

### 4. Run trigger tests
Each test prompt is sent to each **test model** with the skill-injected system prompt. The model's response and latency are recorded.

### 5. Evaluate
A **judge model** evaluates each response in two phases:

- **Trigger judgment** — Did the model correctly trigger the skill (for positive prompts) or correctly ignore it (for negative prompts)? The judge outputs `{triggered, correct, reason}`.
- **Compliance judgment** (positive prompts only, when triggered) — The test model is re-prompted with the full skill instructions. If the skill references known tools (WebFetch, BraveSearch, WebSearch, Read, Write, Edit, Bash, Grep, Glob, etc.), mock tool definitions are provided via the API `tools` parameter so the model can make real structured tool calls. The tools return placeholder results — the judge evaluates whether the model called the right tools with reasonable parameters and followed the correct workflow, not the quality of returned data. This involves two extra API calls: one to the test model for a compliance response, and one to the judge to score it. The judge outputs `{compliant, score (0-100), reason}`. Tool names are matched using aliases (e.g. "Brave Search" matches `BraveSearch`).

Each evaluation item makes 1 API call (trigger judge only) for negative prompts, or up to 3 API calls (trigger judge + compliance run + compliance judge) for positive prompts that triggered correctly.

### 6. Report
Prints a compatibility matrix with trigger accuracy, compliance scores, and an overall percentage per model.

## Scoring

- **Overall score**: `trigger_accuracy × 50 + compliance_accuracy × 30 + avg_compliance_score/100 × 20`
- Exit code is `0` if all models score >= 50%, `1` otherwise (useful for CI).

## Development

```bash
npm install
npm run dev -- ./path/to/SKILL.md --verbose
```

Requires `OPENROUTER_API_KEY` in environment or `.env` file. The project uses `dotenv` for local env loading.

## Build

```bash
npm run build    # TypeScript → dist/
```

## Tech Stack

- TypeScript (ESM)
- Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`)
- Commander.js (CLI)
- gray-matter (SKILL.md frontmatter parsing)
- chalk (terminal colors)
- dotenv (env loading)

## Conventions

- No test framework yet — manual testing via `npm run dev`
- Free OpenRouter models (`:free` suffix) are used by default but are subject to rate limits
- The `.env` file is gitignored and holds API keys locally
- All stderr output is for progress/status; stdout is for results
