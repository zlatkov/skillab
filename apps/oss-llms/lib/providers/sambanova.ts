import type { ModelEntry } from '../types';
import { inferFamily, inferParams, isOssModel } from '../utils';

interface SambanovaModel {
  id: string;
  object?: string;
  context_length?: number;
}

// SambaNova pricing (USD per 1M tokens) — from their pricing page
const SAMBANOVA_PRICING: Record<string, { input: number; output: number }> = {
  'Meta-Llama-3.1-8B-Instruct':   { input: 0.10,  output: 0.10 },
  'Meta-Llama-3.1-70B-Instruct':  { input: 0.60,  output: 0.60 },
  'Meta-Llama-3.1-405B-Instruct': { input: 5.00,  output: 10.00 },
  'Meta-Llama-3.2-1B-Instruct':   { input: 0.04,  output: 0.04 },
  'Meta-Llama-3.2-3B-Instruct':   { input: 0.08,  output: 0.08 },
  'Meta-Llama-3.3-70B-Instruct':  { input: 0.60,  output: 0.60 },
  'DeepSeek-R1':                   { input: 5.00,  output: 10.00 },
  'DeepSeek-R1-Distill-Llama-70B':{ input: 0.75,  output: 0.99 },
  'Qwen2.5-72B-Instruct':         { input: 0.60,  output: 0.60 },
  'Qwen2.5-Coder-32B-Instruct':   { input: 0.40,  output: 0.40 },
};

export async function fetchSambanova(): Promise<ModelEntry[]> {
  const apiKey = process.env.SAMBANOVA_API_KEY;
  if (!apiKey) return buildFromHardcoded();

  try {
    const res = await fetch('https://api.sambanova.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return buildFromHardcoded();

    const { data }: { data: SambanovaModel[] } = await res.json();

    return data
      .filter(m => isOssModel(m.id))
      .map(m => {
        const pricing = SAMBANOVA_PRICING[m.id];
        return {
          modelId: `sambanova/${m.id}`,
          modelName: m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          family: inferFamily(m.id),
          params: inferParams(m.id),
          providerId: 'sambanova',
          providerModelId: m.id,
          inputPrice: pricing?.input ?? null,
          outputPrice: pricing?.output ?? null,
          freeTier: false,
          contextLength: m.context_length ?? null,
          rpm: null,
          tpm: null,
          rpd: null,
          quantization: null,
          source: 'direct' as const,
        };
      });
  } catch {
    return buildFromHardcoded();
  }
}

function buildFromHardcoded(): ModelEntry[] {
  return Object.entries(SAMBANOVA_PRICING).map(([id, pricing]) => ({
    modelId: `sambanova/${id}`,
    modelName: id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    family: inferFamily(id),
    params: inferParams(id),
    providerId: 'sambanova',
    providerModelId: id,
    inputPrice: pricing.input,
    outputPrice: pricing.output,
    freeTier: false,
    contextLength: null,
    rpm: null,
    tpm: null,
    rpd: null,
    quantization: null,
    source: 'direct' as const,
  }));
}
