import type { ModelEntry } from '../types';
import { inferFamily, inferParams, isOssModel } from '../utils';

interface DeepInfraModel {
  model_name: string;
  type?: string;
  reported_by?: string;
  description?: string;
  pricing?: {
    cents_per_input_token?: string | number;
    cents_per_output_token?: string | number;
  };
  max_tokens?: number;
  max_new_tokens?: number;
}

export async function fetchDeepInfra(): Promise<ModelEntry[]> {
  try {
    const headers: Record<string, string> = {};
    if (process.env.DEEPINFRA_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.DEEPINFRA_API_KEY}`;
    }
    const res = await fetch('https://api.deepinfra.com/models/featured', {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];

    const data: DeepInfraModel[] = await res.json();

    return data
      .filter(m => isOssModel(m.model_name))
      .map(m => {
        const centsIn = m.pricing?.cents_per_input_token
          ? parseFloat(String(m.pricing.cents_per_input_token))
          : null;
        const centsOut = m.pricing?.cents_per_output_token
          ? parseFloat(String(m.pricing.cents_per_output_token))
          : null;

        return {
          modelId: m.model_name,
          modelName: m.model_name.replace(/^[^/]+\//, '').replace(/-/g, ' '),
          family: inferFamily(m.model_name),
          params: inferParams(m.model_name),
          providerId: 'deepinfra',
          providerModelId: m.model_name,
          // Convert cents per token → USD per 1M tokens
          inputPrice: centsIn != null ? (centsIn / 100) * 1_000_000 : null,
          outputPrice: centsOut != null ? (centsOut / 100) * 1_000_000 : null,
          freeTier: false,
          contextLength: m.max_tokens ?? null,
          rpm: null,
          tpm: null,
          rpd: null,
          quantization: null,
          source: 'direct' as const,
        };
      });
  } catch {
    return [];
  }
}
