import type { ModelEntry } from '../types';
import { inferFamily, inferParams, isOssModel } from '../utils';

interface NovitaModel {
  id: string;
  object?: string;
  context_length?: number;
  pricing?: {
    prompt?: number;      // USD per token
    completion?: number;  // USD per token
  };
}

export async function fetchNovita(): Promise<ModelEntry[]> {
  const apiKey = process.env.NOVITA_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch('https://api.novita.ai/v3/openai/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];

    const { data }: { data: NovitaModel[] } = await res.json();

    return data
      .filter(m => isOssModel(m.id))
      .map(m => ({
        modelId: m.id,
        modelName: m.id.replace(/^[^/]+\//, '').replace(/[-_]/g, ' '),
        family: inferFamily(m.id),
        params: inferParams(m.id),
        providerId: 'novita',
        providerModelId: m.id,
        inputPrice: m.pricing?.prompt != null ? m.pricing.prompt * 1_000_000 : null,
        outputPrice: m.pricing?.completion != null ? m.pricing.completion * 1_000_000 : null,
        freeTier: false,
        contextLength: m.context_length ?? null,
        rpm: null,
        tpm: null,
        rpd: null,
        quantization: null,
        source: 'direct' as const,
      }));
  } catch {
    return [];
  }
}
