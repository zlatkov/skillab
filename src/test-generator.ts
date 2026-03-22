import { readFile } from 'node:fs/promises';
import { generateText, type LanguageModel } from 'ai';
import type { SkillDefinition, TestPrompt } from './config.js';

const RETRY_DELAY_MS = 2000;

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
}

function validatePrompts(parsed: unknown): TestPrompt[] {
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
  if (positiveCount !== 5 || negativeCount !== 5) {
    throw new Error(`Expected 5 positive and 5 negative prompts, got ${positiveCount} and ${negativeCount}`);
  }

  return prompts;
}

function fallbackPrompts(skill: SkillDefinition): TestPrompt[] {
  return [
    { text: `I need help with ${skill.name}`, type: 'positive' },
    { text: `Can you use the ${skill.name} skill for this task?`, type: 'positive' },
    { text: `Help me with something related to ${skill.description.toLowerCase()}`, type: 'positive' },
    { text: `I'd like to ${skill.description.toLowerCase().slice(0, 50)}`, type: 'positive' },
    { text: `Please assist me with ${skill.name} functionality`, type: 'positive' },
    { text: `What's the weather like today?`, type: 'negative' },
    { text: `Tell me a joke about programming`, type: 'negative' },
    { text: `How do I make a cup of coffee?`, type: 'negative' },
    { text: `What is the capital of France?`, type: 'negative' },
    { text: `Help me write a haiku about nature`, type: 'negative' },
  ];
}

const GENERATION_PROMPT = (skill: SkillDefinition) => `Generate test prompts for this AI skill:
Name: ${skill.name}
Description: ${skill.description}

Content summary (first 500 chars): ${skill.body.slice(0, 500)}

Generate exactly 10 prompts as a JSON array:
- 5 "positive" prompts that SHOULD trigger this skill (realistic user requests, varied wording)
- 5 "negative" prompts that should NOT trigger this skill (related but out of scope, or different topics)

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
  customPromptsPath?: string,
  verbose?: boolean,
): Promise<TestPrompt[]> {
  // Load custom prompts if provided
  if (customPromptsPath) {
    const raw = await readFile(customPromptsPath, 'utf-8');
    const prompts = validatePrompts(JSON.parse(raw));
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
            ? GENERATION_PROMPT(skill)
            : `${GENERATION_PROMPT(skill)}\n\nYour previous response was invalid JSON. Return ONLY valid JSON.`,
          temperature: 0.8,
        });

        const cleaned = stripCodeFences(text);
        const prompts = validatePrompts(JSON.parse(cleaned));
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
  const prompts = fallbackPrompts(skill);
  if (verbose) logPrompts(prompts, 'fallback');
  return prompts;
}
