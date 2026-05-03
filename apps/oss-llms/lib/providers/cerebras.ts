import type { ModelEntry } from '../types';
import { inferFamily, inferParams } from '../utils';

interface CerebrasModel {
  id: string;
  object?: string;
  context_window?: number;
}

// Cerebras pricing as of 2025 (per 1M tokens)
const CEREBRAS_PRICING: Record<string, { input: number; output: number }> = {
  'llama3.1-8b':   { input: 0.10, output: 0.10 },
  'llama3.1-70b':  { input: 0.60, output: 0.60 },
  'llama3.3-70b':  { input: 0.85, output: 1.20 },
  'deepseek-r1-distill-llama-70b': { input: 0.75, output: 0.99 },
};

export async function fetchCerebras(): Promise<ModelEntry[]> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) return buildFromHardcoded();

  try {
    const res = await fetch('https://api.cerebras.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return buildFromHardcoded();

    const { data }: { data: CerebrasModel[] } = await res.json();

    return data.map(m => {
      const pricing = CEREBRAS_PRICING[m.id];
      return {
        modelId: `cerebras/${m.id}`,
        modelName: m.id.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        family: inferFamily(m.id),
        params: inferParams(m.id),
        providerId: 'cerebras',
        providerModelId: m.id,
        inputPrice: pricing?.input ?? null,
        outputPrice: pricing?.output ?? null,
        freeTier: false,
        contextLength: m.context_window ?? null,
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
  return Object.entries(CEREBRAS_PRICING).map(([id, pricing]) => ({
    modelId: `cerebras/${id}`,
    modelName: id.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    family: inferFamily(id),
    params: inferParams(id),
    providerId: 'cerebras',
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
