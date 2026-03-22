import { readFile } from 'node:fs/promises';
import { generateText, type LanguageModel } from 'ai';
import type { SkillDefinition, TestPrompt } from './config.js';

const RETRY_DELAY_MS = 2000;

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
}

function validatePrompts(parsed: unknown, count: number): TestPrompt[] {
  if (!Array.isArray(parsed)) throw new Error('Expected JSON array');

  const prompts: TestPrompt[] = [];
  for (const item of parsed) {
    if (
      typeof item !== 'object' || item === null ||
      typeof item.text !== 'string' || !item.text.trim() ||
      (item.type !== 'positive' && item.type !== 'negative')
    ) {
      throw new Error('Invalid prompt format');
    }
    prompts.push({ text: item.text.trim(), type: item.type });
  }

  const positiveCount = prompts.filter(p => p.type === 'positive').length;
  const negativeCount = prompts.filter(p => p.type === 'negative').length;
  if (positiveCount !== count || negativeCount !== count) {
    throw new Error(`Expected ${count} positive and ${count} negative prompts, got ${positiveCount} and ${negativeCount}`);
  }

  return prompts;
}

const ALL_FALLBACK_POSITIVE: ((skill: SkillDefinition) => string)[] = [
  s => `I need help with ${s.name}`,
  s => `Can you use the ${s.name} skill for this task?`,
  s => `Help me with something related to ${s.description.toLowerCase()}`,
  s => `I'd like to ${s.description.toLowerCase().slice(0, 50)}`,
  s => `Please assist me with ${s.name} functionality`,
];

const ALL_FALLBACK_NEGATIVE: string[] = [
  `What's the weather like today?`,
  `Tell me a joke about programming`,
  `How do I make a cup of coffee?`,
  `What is the capital of France?`,
  `Help me write a haiku about nature`,
];

function fallbackPrompts(skill: SkillDefinition, count: number): TestPrompt[] {
  const positive = ALL_FALLBACK_POSITIVE.slice(0, count).map(fn => ({ text: fn(skill), type: 'positive' as const }));
  const negative = ALL_FALLBACK_NEGATIVE.slice(0, count).map(text => ({ text, type: 'negative' as const }));
  return [...positive, ...negative];
}

const GENERATION_PROMPT = (skill: SkillDefinition, count: number) => `Generate test prompts for this AI skill:
Name: ${skill.name}
Description: ${skill.description}

Content summary (first 500 chars): ${skill.body.slice(0, 500)}

Generate exactly ${count * 2} prompts as a JSON array:
- ${count} "positive" prompts that SHOULD trigger this skill (realistic user requests, varied wording)
- ${count} "negative" prompts that should NOT trigger this skill (related but out of scope, or different topics)

Format: [{"text": "...", "type": "positive"}, {"text": "...", "type": "negative"}]

Respond ONLY with valid JSON, no other text.`;

function logPrompts(prompts: TestPrompt[], source: string): void {
  process.stderr.write(`\n  Test prompts (${source}):\n`);
  for (const p of prompts) {
    const label = p.type === 'positive' ? '+' : '-';
    process.stderr.write(`    [${label}] ${p.text}\n`);
  }
  process.stderr.write('\n');
}

export async function generateTestPrompts(
  skill: SkillDefinition,
  generatorModels: LanguageModel[],
  count: number,
  customPromptsPath?: string,
  verbose?: boolean,
): Promise<TestPrompt[]> {
  // Load custom prompts if provided
  if (customPromptsPath) {
    const raw = await readFile(customPromptsPath, 'utf-8');
    const prompts = validatePrompts(JSON.parse(raw), count);
    if (verbose) logPrompts(prompts, 'custom');
    return prompts;
  }

  // Try each model with retries
  for (let modelIdx = 0; modelIdx < generatorModels.length; modelIdx++) {
    const model = generatorModels[modelIdx];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { text } = await generateText({
          model,
          system: 'You generate test prompts for evaluating AI skill detection. Respond ONLY with a JSON array. No markdown, no explanation.',
          prompt: attempt === 0
            ? GENERATION_PROMPT(skill, count)
            : `${GENERATION_PROMPT(skill, count)}\n\nYour previous response was invalid JSON. Return ONLY valid JSON.`,
          temperature: 0.8,
        });

        const cleaned = stripCodeFences(text);
        const prompts = validatePrompts(JSON.parse(cleaned), count);
        if (verbose) logPrompts(prompts, 'generated');
        return prompts;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Warning: Model ${modelIdx + 1}/${generatorModels.length}, attempt ${attempt + 1}/3 failed: ${message}\n`);
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
  }

  process.stderr.write('Warning: All generator models failed, using fallback prompts.\n');
  const prompts = fallbackPrompts(skill, count);
  if (verbose) logPrompts(prompts, 'fallback');
  return prompts;
}
