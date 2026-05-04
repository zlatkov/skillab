import type { ModelEntry } from './types';
import { fetchGroq } from './providers/groq';
import { fetchTogether } from './providers/together';
import { fetchDeepInfra } from './providers/deepinfra';
import { fetchFireworks } from './providers/fireworks';
import { fetchHyperbolic } from './providers/hyperbolic';
import { fetchCerebras } from './providers/cerebras';
import { fetchSambanova } from './providers/sambanova';
import { fetchNovita } from './providers/novita';
import { fetchOpenRouter } from './providers/openrouter';

export interface FetchResult {
  entries: ModelEntry[];
  providerResults: Record<string, number>;
  errors: string[];
}

export async function fetchAllProviders(): Promise<FetchResult> {
  const errors: string[] = [];

  const [groq, together, deepinfra, fireworks, hyperbolic, cerebras, sambanova, novita, openrouter] =
    await Promise.allSettled([
      fetchGroq(),
      fetchTogether(),
      fetchDeepInfra(),
      fetchFireworks(),
      fetchHyperbolic(),
      fetchCerebras(),
      fetchSambanova(),
      fetchNovita(),
      fetchOpenRouter(),
    ]);

  function unwrap(result: PromiseSettledResult<ModelEntry[]>, name: string): ModelEntry[] {
    if (result.status === 'fulfilled') return result.value;
    errors.push(`${name}: ${result.reason}`);
    return [];
  }

  const directEntries = [
    ...unwrap(groq, 'groq'),
    ...unwrap(together, 'together'),
    ...unwrap(deepinfra, 'deepinfra'),
    ...unwrap(fireworks, 'fireworks'),
    ...unwrap(hyperbolic, 'hyperbolic'),
    ...unwrap(cerebras, 'cerebras'),
    ...unwrap(sambanova, 'sambanova'),
    ...unwrap(novita, 'novita'),
  ];

  // Direct fetchers win over OpenRouter-derived entries — direct APIs have
  // more accurate pricing and real rate limits. Key by (modelId, providerId).
  const merged = new Map<string, ModelEntry>();
  for (const entry of directEntries) {
    const key = `${entry.modelId}::${entry.providerId}`;
    if (!merged.has(key)) merged.set(key, entry);
  }

  for (const entry of unwrap(openrouter, 'openrouter')) {
    const key = `${entry.modelId}::${entry.providerId}`;
    if (!merged.has(key)) merged.set(key, entry);
  }

  const allEntries = Array.from(merged.values());

  const providerResults: Record<string, number> = {};
  for (const entry of allEntries) {
    providerResults[entry.providerId] = (providerResults[entry.providerId] ?? 0) + 1;
  }

  return { entries: allEntries, providerResults, errors };
}
