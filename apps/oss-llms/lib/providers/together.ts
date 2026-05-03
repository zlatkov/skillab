import type { ModelEntry } from '../types';
import { inferFamily, inferParams, isOssModel } from '../utils';

interface TogetherModel {
  id: string;
  type: string;
  display_name: string;
  context_length?: number;
  pricing?: {
    input: number;   // USD per 1M tokens
    output: number;
  };
}

export async function fetchTogether(): Promise<ModelEntry[]> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch('https://api.together.xyz/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];

    const models: TogetherModel[] = await res.json();

    return models
      .filter(m => (m.type === 'chat' || m.type === 'language') && isOssModel(m.id))
      .map(m => ({
        modelId: m.id,
        modelName: m.display_name || m.id,
        family: inferFamily(m.id),
        params: inferParams(m.id),
        providerId: 'together',
        providerModelId: m.id,
        inputPrice: m.pricing?.input ?? null,
        outputPrice: m.pricing?.output ?? null,
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
