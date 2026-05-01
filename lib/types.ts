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
      { id: 'anthropic/claude-sonnet-4', label: 'anthropic/claude-sonnet-4', category: 'test' },
      { id: 'openai/gpt-4.1', label: 'openai/gpt-4.1', category: 'test' },
      { id: 'openai/gpt-4o', label: 'openai/gpt-4o', category: 'test' },
      { id: 'google/gemini-2.5-pro', label: 'google/gemini-2.5-pro', category: 'test' },
      { id: 'google/gemini-2.5-flash', label: 'google/gemini-2.5-flash', category: 'test' },
      { id: 'deepseek/deepseek-chat-v3-0324', label: 'deepseek/deepseek-chat-v3-0324', category: 'test' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'meta-llama/llama-3.3-70b-instruct', category: 'test' },
      { id: 'openai/gpt-4.1-mini', label: 'openai/gpt-4.1-mini', category: 'test' },
    ],
    generator: [
      { id: 'google/gemini-2.5-flash', label: 'google/gemini-2.5-flash', category: 'generator' },
      { id: 'deepseek/deepseek-chat-v3-0324', label: 'deepseek/deepseek-chat-v3-0324', category: 'generator' },
      { id: 'openai/gpt-4.1-mini', label: 'openai/gpt-4.1-mini', category: 'generator' },
    ],
    judge: [
      { id: 'google/gemini-2.5-flash', label: 'google/gemini-2.5-flash', category: 'judge' },
      { id: 'deepseek/deepseek-chat-v3-0324', label: 'deepseek/deepseek-chat-v3-0324', category: 'judge' },
      { id: 'openai/gpt-4.1-mini', label: 'openai/gpt-4.1-mini', category: 'judge' },
    ],
  },
  anthropic: {
    test: [
      { id: 'claude-opus-4-7', label: 'claude-opus-4-7', category: 'test' },
      { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', category: 'test' },
      { id: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5-20251001', category: 'test' },
    ],
    generator: [
      { id: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5-20251001', category: 'generator' },
    ],
    judge: [
      { id: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5-20251001', category: 'judge' },
    ],
  },
  openai: {
    test: [
      { id: 'gpt-4.1', label: 'gpt-4.1', category: 'test' },
      { id: 'gpt-4o', label: 'gpt-4o', category: 'test' },
      { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', category: 'test' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini', category: 'test' },
    ],
    generator: [
      { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', category: 'generator' },
    ],
    judge: [
      { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', category: 'judge' },
    ],
  },
  google: {
    test: [
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro', category: 'test' },
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash', category: 'test' },
      { id: 'gemini-2.0-flash-001', label: 'gemini-2.0-flash-001', category: 'test' },
    ],
    generator: [
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash', category: 'generator' },
    ],
    judge: [
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash', category: 'judge' },
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
    test: models.test.length > 0 ? [models.test[0].id] : [],
    generator: models.generator.length > 0 ? [models.generator[0].id] : [],
    judge: models.judge.length > 0 ? [models.judge[0].id] : [],
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
