import type { ModelEntry } from '../types';
import { inferFamily, inferParams, isOssModel, perTokenToPerMillion } from '../utils';

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
}

export async function fetchOpenRouter(): Promise<ModelEntry[]> {
  try {
    const headers: Record<string, string> = {
      'HTTP-Referer': 'https://oss-llms.zlatkov.ai',
    };
    if (process.env.OPENROUTER_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.OPENROUTER_API_KEY}`;
    }

    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];

    const { data }: { data: OpenRouterModel[] } = await res.json();

    return data
      .filter(m => isOssModel(m.id))
      .map(m => {
        const isFree = m.id.endsWith(':free');
        const baseId = isFree ? m.id.slice(0, -5) : m.id;
        const inputPrice = perTokenToPerMillion(m.pricing.prompt);
        const outputPrice = perTokenToPerMillion(m.pricing.completion);

        // OpenRouter uses -1 as a sentinel for "not applicable"
        const safeInput = inputPrice < 0 ? null : inputPrice;
        const safeOutput = outputPrice < 0 ? null : outputPrice;

        return {
          modelId: baseId,
          modelName: m.name,
          family: inferFamily(m.id),
          params: inferParams(m.id),
          providerId: 'openrouter',
          providerModelId: m.id,
          inputPrice: isFree ? 0 : safeInput,
          outputPrice: isFree ? 0 : safeOutput,
          freeTier: isFree || inputPrice === 0,
          contextLength: m.context_length,
          rpm: null,
          tpm: null,
          rpd: null,
          quantization: null,
          source: 'openrouter' as const,
        };
      });
  } catch {
    return [];
  }
}
