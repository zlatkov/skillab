import type { ModelEntry } from '../types';
import { inferFamily, inferParams, isOssModel, perTokenToPerMillion } from '../utils';

interface OpenRouterModel {
  id: string;
  canonical_slug?: string;
  hugging_face_id?: string | null;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
}

interface OpenRouterEndpoint {
  name?: string;
  provider_name?: string;
  tag?: string;
  context_length?: number;
  max_completion_tokens?: number | null;
  quantization?: string | null;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  status?: number;
  uptime_last_30m?: number;
}

interface OpenRouterEndpointsResponse {
  data?: {
    id?: string;
    name?: string;
    endpoints?: OpenRouterEndpoint[];
  };
}

// Map OpenRouter's provider names to our canonical IDs.
// Names cover both the direct providers we fetch ourselves and additional
// inference networks OpenRouter aggregates that we'd otherwise miss.
const OR_PROVIDER_MAP: Record<string, string> = {
  'together': 'together',
  'together ai': 'together',
  'fireworks': 'fireworks',
  'deepinfra': 'deepinfra',
  'hyperbolic': 'hyperbolic',
  'cerebras': 'cerebras',
  'sambanova': 'sambanova',
  'novita': 'novita',
  'groq': 'groq',
  'lambda': 'lambda',
  'nebius': 'nebius',
  'nebius ai studio': 'nebius',
  'chutes': 'chutes',
  'parasail': 'parasail',
  'lepton': 'lepton',
  'mancer': 'mancer',
  'recursal': 'recursal',
  'crusoe': 'crusoe',
  'featherless': 'featherless',
  'avian.io': 'avian',
  'avian': 'avian',
  'inflection': 'inflection',
  'inference.net': 'inference-net',
  'kluster.ai': 'kluster',
  'targon': 'targon',
  'ubicloud': 'ubicloud',
  'phala': 'phala',
};

function normalizeProviderId(rawName: string | undefined): string {
  if (!rawName) return 'openrouter';
  const lower = rawName.trim().toLowerCase();
  if (OR_PROVIDER_MAP[lower]) return OR_PROVIDER_MAP[lower];
  return lower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'HTTP-Referer': 'https://oss-llms.zlatkov.ai',
  };
  if (process.env.OPENROUTER_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  }
  return headers;
}

async function fetchEndpoints(modelId: string): Promise<OpenRouterEndpoint[]> {
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/models/${modelId}/endpoints`, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as OpenRouterEndpointsResponse;
    return json.data?.endpoints ?? [];
  } catch {
    return [];
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchOpenRouter(): Promise<ModelEntry[]> {
  let models: OpenRouterModel[];
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const { data } = (await res.json()) as { data: OpenRouterModel[] };
    models = data;
  } catch {
    return [];
  }

  // OSS filter: closed-source prefix exclusion (anthropic/openai/x-ai/closed
  // Gemini) plus a hugging_face_id positive signal — OpenRouter populates
  // that field for models with public HF weights, which is a reliable proxy
  // for open source. If the field is absent from the response (older API
  // versions), fall back to the prefix filter alone.
  const ossModels = models.filter(m => {
    if (!isOssModel(m.id)) return false;
    if (m.hugging_face_id === undefined) return true;
    return typeof m.hugging_face_id === 'string' && m.hugging_face_id.length > 0;
  });

  const endpointsPerModel = await mapWithConcurrency(ossModels, 8, m => fetchEndpoints(m.id));

  const entries: ModelEntry[] = [];

  for (let i = 0; i < ossModels.length; i++) {
    const m = ossModels[i];
    const endpoints = endpointsPerModel[i];
    const isFree = m.id.endsWith(':free');
    const baseId = isFree ? m.id.slice(0, -5) : m.id;

    if (endpoints.length === 0) {
      // Fallback: OpenRouter didn't disclose upstream providers for this
      // model, so credit OpenRouter itself with the model-level pricing.
      const inputPrice = perTokenToPerMillion(m.pricing.prompt);
      const outputPrice = perTokenToPerMillion(m.pricing.completion);
      const safeInput = inputPrice < 0 ? null : inputPrice;
      const safeOutput = outputPrice < 0 ? null : outputPrice;

      entries.push({
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
      });
      continue;
    }

    for (const ep of endpoints) {
      const providerId = normalizeProviderId(ep.provider_name ?? ep.tag);
      const promptPrice = ep.pricing?.prompt;
      const completionPrice = ep.pricing?.completion;
      const inputPrice = promptPrice != null ? perTokenToPerMillion(promptPrice) : null;
      const outputPrice = completionPrice != null ? perTokenToPerMillion(completionPrice) : null;
      const safeInput = inputPrice != null && inputPrice < 0 ? null : inputPrice;
      const safeOutput = outputPrice != null && outputPrice < 0 ? null : outputPrice;
      const free = (safeInput === 0 && safeOutput === 0) || isFree;

      entries.push({
        modelId: baseId,
        modelName: m.name,
        family: inferFamily(m.id),
        params: inferParams(m.id),
        providerId,
        providerModelId: m.id,
        inputPrice: free ? 0 : safeInput,
        outputPrice: free ? 0 : safeOutput,
        freeTier: free,
        contextLength: ep.context_length ?? m.context_length,
        rpm: null,
        tpm: null,
        rpd: null,
        quantization: ep.quantization ?? null,
        source: 'openrouter' as const,
      });
    }
  }

  return entries;
}
