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

  // Dedup direct entries by (providerId, providerModelId)
  const directSeen = new Set<string>();
  const dedupedDirect: ModelEntry[] = [];
  for (const entry of directEntries) {
    const key = `${entry.providerId}:${entry.providerModelId}`;
    if (!directSeen.has(key)) {
      directSeen.add(key);
      dedupedDirect.push(entry);
    }
  }

  // Dedup OpenRouter by modelId — free/paid variants share the same modelId after
  // normalisation, which would violate the unique (run_id, model_id, provider_id) constraint.
  // Prefer the free variant when both exist.
  const orEntries = unwrap(openrouter, 'openrouter');
  const orByModelId = new Map<string, ModelEntry>();
  for (const entry of orEntries) {
    const existing = orByModelId.get(entry.modelId);
    if (!existing || entry.freeTier) {
      orByModelId.set(entry.modelId, entry);
    }
  }
  const dedupedOR = Array.from(orByModelId.values());

  const allEntries = [...dedupedDirect, ...dedupedOR];

  const providerResults: Record<string, number> = {};
  for (const entry of allEntries) {
    providerResults[entry.providerId] = (providerResults[entry.providerId] ?? 0) + 1;
  }

  return { entries: allEntries, providerResults, errors };
}
