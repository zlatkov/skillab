# skillab

Tools for working with [Agent Skills](https://agentskills.io/home) (SKILL.md files).

Skill authors write a SKILL.md and have zero idea whether it works on any model besides the one they tested with. skillab provides a web-based toolkit to evaluate skills across multiple models and visualise dependencies between them — following the [OpenSkills](https://github.com/numman-ali/openskills) specification used by agents like [OpenClaw](https://openclaw.ai/) and Claude Code.

## Tools

### Skill Evaluator

Test how well AI models trigger and follow a skill's instructions. The evaluator simulates how agents inject skills into system prompts using `<available_skills>` XML blocks, then scores each model on trigger accuracy and instruction compliance.

- Load skills from GitHub repos, file upload, or paste
- Evaluate across multiple models and providers simultaneously
- Toggle-button model presets per provider (OpenRouter, Anthropic, OpenAI, Google, Azure)
- Configurable generator and judge models with fallback chains
- Verbose per-prompt breakdown with pass/fail details
- JSON export for results

### Dependency Graph

Visualise how skills reference each other. No API key needed — just load 2+ skills.

- Tree view with box-drawing characters showing dependency relationships
- Adjacency matrix with hover details
- Detects name mentions, path references, and frontmatter dependency fields

## Getting Started

### Hosted

Visit [skillab.dev](https://skillab.dev) (coming soon) or deploy your own instance on Vercel.

### Local Development

```bash
git clone https://github.com/zlatkov/skillab.git
cd skillab
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How It Works

All orchestration runs in the browser. A single thin API route (`/api/generate`) proxies LLM calls to avoid CORS issues — no other server-side logic.

1. **Parse** — Reads SKILL.md files, extracts name, description, and instructions from YAML frontmatter and markdown content.
2. **Build context** — The test model is presented as a helpful AI agent with access to multiple skills. Your skill is mixed in with distractor skills to test whether the model can identify the correct one.
3. **Generate test prompts** — A generator model creates positive prompts (should trigger) and negative prompts (should not trigger) from the skill definition.
4. **Run trigger tests** — Each prompt is sent to each test model with the skill-injected system prompt.
5. **Evaluate** — A judge model assesses trigger accuracy. For correctly triggered prompts, the model is re-prompted with full instructions and scored on compliance. If the skill references tools (WebFetch, Read, Write, Bash, etc.), mock tool definitions are provided so the model can make real structured tool calls.
6. **Report** — Results are displayed in a table with trigger accuracy, compliance scores, and overall percentage per model.

See [AGENTS.md](./AGENTS.md) for detailed pipeline internals.

## Skill Input

skillab accepts skills from multiple sources:

| Source | Example |
|---|---|
| GitHub shorthand | `owner/repo` |
| GitHub repo URL | `https://github.com/owner/repo` |
| GitHub folder URL | `https://github.com/owner/repo/tree/main/skills` |
| GitHub file URL | `https://github.com/owner/repo/blob/main/skills/my-skill/SKILL.md` |
| File upload | One or more `.md` files |
| Paste | Direct SKILL.md content (use `===SKILL===` delimiter for multiple) |

When multiple skills are loaded, other real skills are injected as distractors alongside dummy skills — making trigger tests more realistic.

## Providers

All providers use the [Vercel AI SDK](https://ai-sdk.dev) under the hood.

| Provider | Notes |
|---|---|
| OpenRouter | Access 300+ models. Default provider with preset models. |
| Anthropic | Direct access to Claude models. |
| OpenAI | Direct access to GPT models. |
| Google | Direct access to Gemini models. |
| Azure | Azure AI Foundry. Model IDs are deployment names (add manually). |

API keys are sent directly to the provider via the proxy route — they are never stored.

## Model Roles

skillab uses three types of models:

| Role | Description |
|---|---|
| **Test models** | The models being evaluated. These receive the skill-injected prompt and are scored. |
| **Generator models** | Generate test prompts from the skill definition. Configurable in Advanced Options. |
| **Judge models** | Evaluate trigger accuracy and instruction compliance. Configurable in Advanced Options. |

Each provider has preset defaults for all three roles. Generator and judge models support fallback chains.

## Scoring

Each model is scored on two dimensions:

- **Trigger accuracy** (50% of overall): Did the model correctly identify when to use the skill (positive prompts) and when to ignore it (negative prompts)?
- **Compliance** (50% of overall): For positive prompts where the skill was triggered, did the model follow the skill's instructions? Split into pass/fail (30%) and quality score 0-100 (20%).

## Custom Test Prompts

Provide custom prompts as a JSON array in Advanced Options:

```json
[
  {"text": "Help me extract text from this PDF", "type": "positive"},
  {"text": "What's the weather today?", "type": "negative"}
]
```

## Tech Stack

- Next.js 15 (App Router)
- React 19
- Tailwind CSS v4
- Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/azure`)
- TypeScript

## License

MIT
