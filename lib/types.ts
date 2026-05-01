export const PROVIDER_NAMES = ['openrouter', 'anthropic', 'openai', 'google', 'azure'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export interface SkillDefinition {
  name: string;
  description: string;
  body: string;
  rawContent: string;
}

export interface TestPrompt {
  text: string;
  type: 'positive' | 'negative';
}

export interface TriggerEval {
  triggered: boolean;
  correct: boolean;
  reason: string;
}

export interface ComplianceEval {
  compliant: boolean;
  score: number;
  reason: string;
}

export interface EvalResult {
  modelId: string;
  prompt: TestPrompt;
  response: string;
  trigger: TriggerEval;
  compliance?: ComplianceEval;
}

export interface EvalReport {
  modelId: string;
  triggerScore: { correct: number; total: number };
  complianceScore: { correct: number; total: number; avgScore: number };
  overall: number;
}

export interface BatchSkillReport {
  skill: SkillDefinition;
  reports: EvalReport[];
  evalResults: EvalResult[];
}

export interface SkillEdge {
  from: string;
  to: string;
  mentions: string[];
}

export interface SkillGraph {
  nodes: string[];
  edges: SkillEdge[];
}

export interface LogEntry {
  text: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'progress';
  timestamp: number;
}

export interface EvalConfig {
  provider: ProviderName;
  apiKey: string;
  modelIds: string[];
  generatorModelIds: string[];
  judgeModelIds: string[];
  count: number;
  verbose: boolean;
  azureResourceName?: string;
}

export interface ModelOption {
  id: string;
  label: string;
  category: 'test' | 'generator' | 'judge' | 'all';
}

export const PROVIDER_MODELS: Record<ProviderName, {
  test: ModelOption[];
  generator: ModelOption[];
  judge: ModelOption[];
}> = {
  openrouter: {
    test: [
      { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', category: 'test' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', category: 'test' },
      { id: 'mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1', category: 'test' },
      { id: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B', category: 'test' },
      { id: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3', category: 'test' },
    ],
    generator: [
      { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', category: 'generator' },
      { id: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3', category: 'generator' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', category: 'generator' },
    ],
    judge: [
      { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', category: 'judge' },
      { id: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3', category: 'judge' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', category: 'judge' },
    ],
  },
  anthropic: {
    test: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', category: 'test' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', category: 'test' },
    ],
    generator: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', category: 'generator' },
    ],
    judge: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', category: 'judge' },
    ],
  },
  openai: {
    test: [
      { id: 'gpt-4o', label: 'GPT-4o', category: 'test' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', category: 'test' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', category: 'test' },
    ],
    generator: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', category: 'generator' },
    ],
    judge: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', category: 'judge' },
    ],
  },
  google: {
    test: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', category: 'test' },
      { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash', category: 'test' },
      { id: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro', category: 'test' },
    ],
    generator: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', category: 'generator' },
    ],
    judge: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', category: 'judge' },
    ],
  },
  azure: {
    test: [],
    generator: [],
    judge: [],
  },
};

// Defaults: first model from each category for the selected provider
export function getDefaultModels(provider: ProviderName) {
  const models = PROVIDER_MODELS[provider];
  return {
    test: models.test.map(m => m.id),
    generator: models.generator.map(m => m.id),
    judge: models.judge.map(m => m.id),
  };
}

// Keep these for backward compat with engine fallbacks
export const DEFAULT_FREE_MODELS = PROVIDER_MODELS.openrouter.test.map(m => m.id);
export const DEFAULT_GENERATOR_MODELS = PROVIDER_MODELS.openrouter.generator.map(m => m.id);
export const DEFAULT_JUDGE_MODELS = PROVIDER_MODELS.openrouter.judge.map(m => m.id);

export const DUMMY_SKILLS = [
  {
    name: 'git-commit-helper',
    description: 'Helps create well-formatted git commits with conventional commit messages.',
  },
  {
    name: 'api-documentation',
    description: 'Generates API documentation from code comments and type definitions.',
  },
  {
    name: 'test-generator',
    description: 'Creates unit tests for functions and classes based on their signatures and behavior.',
  },
];
