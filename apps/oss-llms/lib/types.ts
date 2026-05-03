export interface ModelEntry {
  modelId: string;
  modelName: string;
  family: string;
  params: string | null;
  providerId: string;
  providerModelId: string;
  inputPrice: number | null;   // USD per 1M tokens
  outputPrice: number | null;  // USD per 1M tokens
  freeTier: boolean;
  contextLength: number | null;
  rpm: number | null;
  tpm: number | null;
  rpd: number | null;
  quantization: string | null;
  source: 'direct' | 'openrouter';
}

export interface ModelSnapshot {
  id: string;
  run_id: string;
  created_at: string;
  model_id: string;
  model_name: string;
  family: string;
  params: string | null;
  provider_id: string;
  provider_model_id: string;
  input_price: number | null;
  output_price: number | null;
  free_tier: boolean;
  context_length: number | null;
  rpm: number | null;
  tpm: number | null;
  rpd: number | null;
  quantization: string | null;
  source: string;
}

export interface CronRun {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: 'running' | 'complete' | 'error';
  entries_count: number;
  providers_count: number;
  error: string | null;
}

export interface ModelGroup {
  key: string;
  name: string;
  family: string;
  params: string | null;
  contextLength: number | null;
  entries: ModelSnapshot[];
  cheapestInput: number | null;
  cheapestOutput: number | null;
  hasFree: boolean;
}

export const PROVIDER_NAMES: Record<string, string> = {
  groq: 'Groq',
  together: 'Together AI',
  deepinfra: 'DeepInfra',
  fireworks: 'Fireworks AI',
  hyperbolic: 'Hyperbolic',
  cerebras: 'Cerebras',
  novita: 'Novita AI',
  sambanova: 'SambaNova',
  openrouter: 'OpenRouter',
};


export const PROVIDER_URLS: Record<string, string> = {
  groq: 'https://console.groq.com',
  together: 'https://api.together.xyz',
  deepinfra: 'https://deepinfra.com',
  fireworks: 'https://fireworks.ai',
  hyperbolic: 'https://hyperbolic.xyz',
  cerebras: 'https://cerebras.ai',
  novita: 'https://novita.ai',
  sambanova: 'https://cloud.sambanova.ai',
  openrouter: 'https://openrouter.ai',
};
