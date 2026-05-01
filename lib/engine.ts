import type {
  BatchSkillReport,
  ComplianceEval,
  EvalConfig,
  EvalReport,
  EvalResult,
  LogEntry,
  SkillDefinition,
  TestPrompt,
  TriggerEval,
} from './types';
import { buildTriggerSystemPrompt, buildComplianceSystemPrompt } from './skill';

type ProgressCallback = (entry: LogEntry) => void;

function log(onProgress: ProgressCallback, text: string, type: LogEntry['type'] = 'info') {
  onProgress({ text, type, timestamp: Date.now() });
}

interface LLMRequest {
  provider: string;
  apiKey: string;
  modelId: string;
  messages?: Array<{ role: string; content: string }>;
  system?: string;
  prompt?: string;
  temperature?: number;
  useMockTools?: boolean;
  mockToolNames?: string[];
  maxSteps?: number;
  azureResourceName?: string;
}

interface LLMResponse {
  text: string;
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  steps: Array<{ toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> }>;
}

async function callLLM(req: LLMRequest): Promise<LLMResponse> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API error ${res.status}: ${error}`);
  }
  return res.json();
}

async function callLLMWithRetry(
  req: LLMRequest,
  fallbackModelIds: string[],
  maxRetries = 3,
): Promise<LLMResponse> {
  for (let modelIdx = 0; modelIdx < fallbackModelIds.length; modelIdx++) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await callLLM({ ...req, modelId: fallbackModelIds[modelIdx] });
      } catch {
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
  }
  throw new Error('All models failed after retries');
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
}

// --- Test prompt generation ---

const GENERATION_PROMPT = (skill: SkillDefinition, count: number) => `Generate test prompts for this AI skill:
Name: ${skill.name}
Description: ${skill.description}

Content summary (first 500 chars): ${skill.body.slice(0, 500)}

Generate exactly ${count * 2} prompts as a JSON array:
- ${count} "positive" prompts that SHOULD trigger this skill (realistic user requests, varied wording)
- ${count} "negative" prompts that should NOT trigger this skill (related but out of scope, or different topics)

Format: [{"text": "...", "type": "positive"}, {"text": "...", "type": "negative"}]

Respond ONLY with valid JSON, no other text.`;

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
  const pos = prompts.filter(p => p.type === 'positive').length;
  const neg = prompts.filter(p => p.type === 'negative').length;
  if (pos !== count || neg !== count) {
    throw new Error(`Expected ${count}+${count}, got ${pos}+${neg}`);
  }
  return prompts;
}

function fallbackPrompts(skill: SkillDefinition, count: number): TestPrompt[] {
  const posTemplates = [
    (s: SkillDefinition) => `I need help with ${s.name}`,
    (s: SkillDefinition) => `Can you use the ${s.name} skill for this task?`,
    (s: SkillDefinition) => `Help me with something related to ${s.description.toLowerCase()}`,
    (s: SkillDefinition) => `I'd like to ${s.description.toLowerCase().slice(0, 50)}`,
    (s: SkillDefinition) => `Please assist me with ${s.name} functionality`,
  ];
  const negTemplates = [
    `What's the weather like today?`,
    `Tell me a joke about programming`,
    `How do I make a cup of coffee?`,
    `What is the capital of France?`,
    `Help me write a haiku about nature`,
  ];
  const positive = posTemplates.slice(0, count).map(fn => ({ text: fn(skill), type: 'positive' as const }));
  const negative = negTemplates.slice(0, count).map(text => ({ text, type: 'negative' as const }));
  return [...positive, ...negative];
}

async function generateTestPrompts(
  skill: SkillDefinition,
  config: EvalConfig,
  onProgress: ProgressCallback,
  customPrompts?: TestPrompt[],
): Promise<TestPrompt[]> {
  if (customPrompts) {
    log(onProgress, `Using ${customPrompts.length} custom test prompts`, 'info');
    return customPrompts;
  }

  for (let modelIdx = 0; modelIdx < config.generatorModelIds.length; modelIdx++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { text } = await callLLM({
          provider: config.provider,
          apiKey: config.apiKey,
          modelId: config.generatorModelIds[modelIdx],
          system: 'You generate test prompts for evaluating AI skill detection. Respond ONLY with a JSON array. No markdown, no explanation.',
          prompt: attempt === 0
            ? GENERATION_PROMPT(skill, config.count)
            : `${GENERATION_PROMPT(skill, config.count)}\n\nYour previous response was invalid JSON. Return ONLY valid JSON.`,
          temperature: 0.8,
          azureResourceName: config.azureResourceName,
        });
        const cleaned = stripCodeFences(text);
        return validatePrompts(JSON.parse(cleaned), config.count);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(onProgress, `Generator ${config.generatorModelIds[modelIdx]} (attempt ${attempt + 1}/3): ${msg}`, 'warning');
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  log(onProgress, 'All generator models failed, using fallback prompts', 'warning');
  return fallbackPrompts(skill, config.count);
}

// --- Trigger evaluation ---

const TRIGGER_JUDGE_SYSTEM = `You are an evaluation judge. You assess whether an AI model correctly identified when to use a specific skill.
Respond ONLY with valid JSON, no other text.`;

function triggerJudgePrompt(
  skill: SkillDefinition,
  promptText: string,
  promptType: 'positive' | 'negative',
  response: string,
): string {
  return `## Skill Being Tested
Name: ${skill.name}
Description: ${skill.description}

## User Prompt
"${promptText}"

## Expected Behavior
This is a ${promptType} test case.
${promptType === 'positive'
    ? 'The model SHOULD have recognized this skill as relevant and indicated it would use it.'
    : 'The model should NOT have mentioned or tried to use this skill.'}

## Model Response
${response}

## Your Task
Did the model behave correctly? Evaluate whether it correctly identified (or correctly ignored) the "${skill.name}" skill.

Respond ONLY with JSON:
{"triggered": true/false, "correct": true/false, "reason": "brief explanation"}`;
}

function safeParseTriggerEval(text: string): TriggerEval {
  try {
    const parsed = JSON.parse(stripCodeFences(text));
    return {
      triggered: Boolean(parsed.triggered),
      correct: Boolean(parsed.correct),
      reason: String(parsed.reason ?? ''),
    };
  } catch {
    return { triggered: false, correct: false, reason: 'Failed to parse judge response' };
  }
}

// --- Compliance evaluation ---

const COMPLIANCE_JUDGE_SYSTEM = `You are an evaluation judge. You assess whether an AI model correctly followed a skill's instructions by calling the right tools and following the right workflow.
Respond ONLY with valid JSON, no other text.`;

function complianceJudgePrompt(skill: SkillDefinition, promptText: string, response: string): string {
  return `## Skill Instructions
${skill.body}

## User Prompt
"${promptText}"

## Model Response and Tool Calls
${response}

## Your Task
Did the model correctly follow the skill's instructions? Evaluate:
1. Did it call the correct tools as described in the skill?
2. Did it pass reasonable arguments to those tools?
3. Did it follow the stated workflow/steps in the right order?
4. Did it stay within the scope of the skill?

Note: Tools returned mock results. Do not penalize for the quality of returned data.

Respond ONLY with JSON:
{"compliant": true/false, "score": 0-100, "reason": "brief explanation"}`;
}

function safeParseComplianceEval(text: string): ComplianceEval {
  try {
    const parsed = JSON.parse(stripCodeFences(text));
    return {
      compliant: Boolean(parsed.compliant),
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      reason: String(parsed.reason ?? ''),
    };
  } catch {
    return { compliant: false, score: 0, reason: 'Failed to parse judge response' };
  }
}

// --- Report computation ---

export function computeReport(evalResults: EvalResult[], modelIds: string[]): EvalReport[] {
  return modelIds.map(modelId => {
    const modelResults = evalResults.filter(r => r.modelId === modelId);
    const triggerTotal = modelResults.length;
    const triggerCorrect = modelResults.filter(r => r.trigger.correct).length;
    const complianceResults = modelResults.filter(r => r.compliance != null);
    const complianceCorrect = complianceResults.filter(r => r.compliance!.compliant).length;
    const complianceTotal = complianceResults.length;
    const avgScore = complianceTotal > 0
      ? complianceResults.reduce((sum, r) => sum + r.compliance!.score, 0) / complianceTotal
      : 0;
    const triggerAcc = triggerTotal > 0 ? triggerCorrect / triggerTotal : 0;
    const complianceAcc = complianceTotal > 0 ? complianceCorrect / complianceTotal : 0;
    const overall = Math.round(triggerAcc * 50 + complianceAcc * 30 + (avgScore / 100) * 20);
    return {
      modelId,
      triggerScore: { correct: triggerCorrect, total: triggerTotal },
      complianceScore: { correct: complianceCorrect, total: complianceTotal, avgScore: Math.round(avgScore) },
      overall,
    };
  }).sort((a, b) => b.overall - a.overall);
}

// --- Main evaluation pipeline ---

async function runSingleSkill(
  skill: SkillDefinition,
  config: EvalConfig,
  onProgress: ProgressCallback,
  siblingSkills?: SkillDefinition[],
  customPrompts?: TestPrompt[],
): Promise<BatchSkillReport> {
  // Generate test prompts
  log(onProgress, `Generating test prompts for "${skill.name}"...`, 'info');
  const prompts = await generateTestPrompts(skill, config, onProgress, customPrompts);
  log(onProgress, `Generated ${prompts.length} test prompts`, 'success');

  if (config.verbose) {
    for (const p of prompts) {
      log(onProgress, `  [${p.type === 'positive' ? '+' : '-'}] ${p.text}`, 'info');
    }
  }

  // Build system prompt for trigger tests
  const systemPrompt = buildTriggerSystemPrompt(skill, siblingSkills);
  const complianceSystemPrompt = buildComplianceSystemPrompt(skill);

  const evalResults: EvalResult[] = [];
  const totalTests = config.modelIds.length * prompts.length;
  let completed = 0;

  for (const modelId of config.modelIds) {
    for (const prompt of prompts) {
      completed++;
      log(onProgress, `[${completed}/${totalTests}] Testing ${modelId} — ${prompt.type}: "${prompt.text.slice(0, 50)}..."`, 'progress');

      // Run trigger test
      let response = '';
      let error: string | undefined;
      try {
        const result = await callLLM({
          provider: config.provider,
          apiKey: config.apiKey,
          modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt.text },
          ],
          temperature: 0.3,
          azureResourceName: config.azureResourceName,
        });
        response = result.text;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        log(onProgress, `  Error: ${error}`, 'error');
      }

      if (error) {
        evalResults.push({
          modelId,
          prompt,
          response,
          trigger: { triggered: false, correct: false, reason: `Error: ${error}` },
        });
        continue;
      }

      // Judge trigger
      let trigger: TriggerEval;
      try {
        const judgeResult = await callLLMWithRetry(
          {
            provider: config.provider,
            apiKey: config.apiKey,
            modelId: '', // will be overridden
            system: TRIGGER_JUDGE_SYSTEM,
            prompt: triggerJudgePrompt(skill, prompt.text, prompt.type, response),
            temperature: 0.1,
            azureResourceName: config.azureResourceName,
          },
          config.judgeModelIds,
        );
        trigger = safeParseTriggerEval(judgeResult.text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        trigger = { triggered: false, correct: false, reason: `Judge failed: ${msg}` };
      }

      log(onProgress, `  Trigger: ${trigger.correct ? 'PASS' : 'FAIL'} (triggered: ${trigger.triggered})`, trigger.correct ? 'success' : 'warning');

      // Compliance evaluation (only for positive prompts where skill was triggered)
      let compliance: ComplianceEval | undefined;
      if (prompt.type === 'positive' && trigger.triggered) {
        try {
          log(onProgress, `  Running compliance test...`, 'info');
          const toolNames = config.enabledTools ?? [];
          const compResult = await callLLM({
            provider: config.provider,
            apiKey: config.apiKey,
            modelId,
            messages: [
              { role: 'system', content: complianceSystemPrompt },
              { role: 'user', content: prompt.text },
            ],
            temperature: 0.3,
            useMockTools: toolNames.length > 0,
            mockToolNames: toolNames,
            maxSteps: 10,
            azureResourceName: config.azureResourceName,
          });

          const allToolCalls = compResult.steps.flatMap(s => s.toolCalls ?? []);
          const toolCallSummary = allToolCalls.length > 0
            ? `\n\nTool calls made:\n${allToolCalls.map(tc => `- ${tc.toolName}(${JSON.stringify(tc.args)})`).join('\n')}`
            : '\n\nNo tool calls were made.';
          const fullResponse = compResult.text + toolCallSummary;

          log(onProgress, `  Compliance test done (${allToolCalls.length} tool calls)`, 'info');

          const judgeText = await callLLMWithRetry(
            {
              provider: config.provider,
              apiKey: config.apiKey,
              modelId: '',
              system: COMPLIANCE_JUDGE_SYSTEM,
              prompt: complianceJudgePrompt(skill, prompt.text, fullResponse),
              temperature: 0.1,
              azureResourceName: config.azureResourceName,
            },
            config.judgeModelIds,
          );
          compliance = safeParseComplianceEval(judgeText.text);
          log(onProgress, `  Compliance: ${compliance.compliant ? 'PASS' : 'FAIL'} (${compliance.score}/100)`, compliance.compliant ? 'success' : 'warning');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          compliance = { compliant: false, score: 0, reason: `Compliance failed: ${msg}` };
          log(onProgress, `  Compliance error: ${msg}`, 'error');
        }
      }

      evalResults.push({ modelId, prompt, response, trigger, compliance });

      if (config.verbose) {
        log(onProgress, `  Reason: ${trigger.reason}`, 'info');
        if (compliance) {
          log(onProgress, `  Compliance reason: ${compliance.reason}`, 'info');
        }
      }
    }
  }

  const reports = computeReport(evalResults, config.modelIds);
  return { skill, reports, evalResults };
}

export async function runEvaluation(
  skills: SkillDefinition[],
  config: EvalConfig,
  onProgress: ProgressCallback,
  customPrompts?: TestPrompt[],
): Promise<BatchSkillReport[]> {
  const results: BatchSkillReport[] = [];

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    const siblingSkills = skills.filter((_, idx) => idx !== i);

    log(onProgress, `\n[${i + 1}/${skills.length}] Evaluating "${skill.name}"...`, 'info');
    const result = await runSingleSkill(skill, config, onProgress, siblingSkills, customPrompts);
    results.push(result);
    log(onProgress, `Completed "${skill.name}"`, 'success');
  }

  return results;
}

// --- Skill generation from prompt ---

const SKILL_GEN_SYSTEM = `You are an expert at writing Agent Skills in the SKILL.md format (OpenSkills specification).
Generate a complete, well-structured SKILL.md file based on the user's description.
The file should include YAML frontmatter with name and description fields, followed by markdown content with clear instructions.
Include sections for: description, when to trigger, step-by-step instructions, and any tool usage.
Respond ONLY with the SKILL.md content, no other text.`;

export async function generateSkillFromPrompt(
  prompt: string,
  config: { provider: string; apiKey: string; modelId: string; azureResourceName?: string },
): Promise<string> {
  const result = await callLLM({
    provider: config.provider,
    apiKey: config.apiKey,
    modelId: config.modelId,
    system: SKILL_GEN_SYSTEM,
    prompt: `Create a SKILL.md for: ${prompt}`,
    temperature: 0.7,
    azureResourceName: config.azureResourceName,
  });
  return stripCodeFences(result.text);
}
