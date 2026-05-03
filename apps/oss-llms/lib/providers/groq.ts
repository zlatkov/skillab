import type { ModelEntry } from '../types';
import { inferFamily, inferParams } from '../utils';

// Groq's models API doesn't include pricing — hardcoded from their pricing page.
// https://console.groq.com/docs/openai#models
const GROQ_PRICING: Record<string, { input: number; output: number }> = {
  'gemma-7b-it':                              { input: 0.07,  output: 0.07 },
  'gemma2-9b-it':                             { input: 0.20,  output: 0.20 },
  'llama-3.1-8b-instant':                     { input: 0.05,  output: 0.08 },
  'llama-3.1-70b-versatile':                  { input: 0.59,  output: 0.79 },
  'llama-3.3-70b-versatile':                  { input: 0.59,  output: 0.79 },
  'llama-3.3-70b-specdec':                    { input: 0.59,  output: 0.99 },
  'llama3-8b-8192':                           { input: 0.05,  output: 0.08 },
  'llama3-70b-8192':                          { input: 0.59,  output: 0.79 },
  'llama-3.2-1b-preview':                     { input: 0.04,  output: 0.04 },
  'llama-3.2-3b-preview':                     { input: 0.06,  output: 0.06 },
  'llama-3.2-11b-vision-preview':             { input: 0.18,  output: 0.18 },
  'llama-3.2-90b-vision-preview':             { input: 0.90,  output: 0.90 },
  'llama-guard-3-8b':                         { input: 0.20,  output: 0.20 },
  'llama3-groq-8b-8192-tool-use-preview':     { input: 0.19,  output: 0.19 },
  'llama3-groq-70b-8192-tool-use-preview':    { input: 0.89,  output: 0.89 },
  'mixtral-8x7b-32768':                       { input: 0.24,  output: 0.24 },
  'deepseek-r1-distill-llama-70b':            { input: 0.75,  output: 0.99 },
  'deepseek-r1-distill-qwen-32b':             { input: 0.69,  output: 0.69 },
};

// Free tier rate limits (requests/tokens per day for most models)
const GROQ_FREE_RPD = 14400;
const GROQ_FREE_RPM = 30;
const GROQ_FREE_TPM = 6000;

const GROQ_CONTEXT: Record<string, number> = {
  'mixtral-8x7b-32768':        32768,
  'llama3-8b-8192':            8192,
  'llama3-70b-8192':           8192,
  'llama-3.1-8b-instant':      131072,
  'llama-3.1-70b-versatile':   131072,
  'llama-3.3-70b-versatile':   131072,
  'llama-3.3-70b-specdec':     131072,
  'llama-3.2-1b-preview':      131072,
  'llama-3.2-3b-preview':      131072,
  'llama-3.2-11b-vision-preview': 131072,
  'llama-3.2-90b-vision-preview': 131072,
  'gemma-7b-it':               8192,
  'gemma2-9b-it':              8192,
  'deepseek-r1-distill-llama-70b': 131072,
  'deepseek-r1-distill-qwen-32b':  131072,
};

interface GroqModel {
  id: string;
  object: string;
  owned_by: string;
  context_window?: number;
  active?: boolean;
}

export async function fetchGroq(): Promise<ModelEntry[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return buildFromHardcoded();

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return buildFromHardcoded();

    const { data }: { data: GroqModel[] } = await res.json();
    const active = data.filter(m => m.active !== false && m.object === 'model');

    return active.map(m => {
      const pricing = GROQ_PRICING[m.id];
      return {
        modelId: `groq/${m.id}`,
        modelName: formatGroqName(m.id),
        family: inferFamily(m.id),
        params: inferParams(m.id),
        providerId: 'groq',
        providerModelId: m.id,
        inputPrice: pricing?.input ?? null,
        outputPrice: pricing?.output ?? null,
        freeTier: true,
        contextLength: m.context_window ?? GROQ_CONTEXT[m.id] ?? null,
        rpm: GROQ_FREE_RPM,
        tpm: GROQ_FREE_TPM,
        rpd: GROQ_FREE_RPD,
        quantization: null,
        source: 'direct' as const,
      };
    });
  } catch {
    return buildFromHardcoded();
  }
}

function buildFromHardcoded(): ModelEntry[] {
  return Object.entries(GROQ_PRICING).map(([id, pricing]) => ({
    modelId: `groq/${id}`,
    modelName: formatGroqName(id),
    family: inferFamily(id),
    params: inferParams(id),
    providerId: 'groq',
    providerModelId: id,
    inputPrice: pricing.input,
    outputPrice: pricing.output,
    freeTier: true,
    contextLength: GROQ_CONTEXT[id] ?? null,
    rpm: GROQ_FREE_RPM,
    tpm: GROQ_FREE_TPM,
    rpd: GROQ_FREE_RPD,
    quantization: null,
    source: 'direct' as const,
  }));
}

function formatGroqName(id: string): string {
  return id
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/\b(\d+)\b/g, '$1')
    .replace(/8192|32768|131072/g, '');
}
