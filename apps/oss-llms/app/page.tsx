import { supabase } from '@/lib/supabase';
import type { CronRun, ModelGroup, ModelSnapshot } from '@/lib/types';
import { groupKey, cleanModelName } from '@/lib/utils';
import { ModelGrid } from './model-grid';

export const dynamic = 'force-dynamic';

function timeAgo(iso: string): string {
  const diffMins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMins <= 0) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
}

function buildGroups(snapshots: ModelSnapshot[]): ModelGroup[] {
  const map = new Map<string, ModelSnapshot[]>();

  for (const s of snapshots) {
    const key = groupKey(s.model_id);
    const arr = map.get(key) ?? [];
    arr.push(s);
    map.set(key, arr);
  }

  const groups: ModelGroup[] = [];

  for (const [key, entries] of map.entries()) {
    // Deduplicate by provider_id — multiple model variants can map to the same group.
    // Keep one entry per provider: prefer free tier, then cheapest input price.
    const byProvider = new Map<string, ModelSnapshot>();
    for (const s of entries) {
      const existing = byProvider.get(s.provider_id);
      if (!existing) {
        byProvider.set(s.provider_id, s);
      } else {
        const existingFree = existing.free_tier && existing.input_price === 0;
        const newFree = s.free_tier && s.input_price === 0;
        if (newFree && !existingFree) {
          byProvider.set(s.provider_id, s);
        } else if (!existingFree && !newFree) {
          const ei = existing.input_price ?? Infinity;
          const ni = s.input_price ?? Infinity;
          if (ni < ei) byProvider.set(s.provider_id, s);
        }
      }
    }
    const dedupedEntries = Array.from(byProvider.values());

    // Sort providers: free first, then by input price asc, null last
    const sorted = [...dedupedEntries].sort((a, b) => {
      if (a.free_tier && a.input_price === 0 && !(b.free_tier && b.input_price === 0)) return -1;
      if (b.free_tier && b.input_price === 0 && !(a.free_tier && a.input_price === 0)) return 1;
      const ai = a.input_price ?? Infinity;
      const bi = b.input_price ?? Infinity;
      return ai - bi;
    });

    const priced = dedupedEntries.filter(e => e.input_price != null && e.input_price >= 0);
    const cheapestInput = priced.length > 0
      ? Math.min(...priced.map(e => e.input_price!))
      : null;

    const pricedOut = dedupedEntries.filter(e => e.output_price != null && e.output_price >= 0);
    const cheapestOutput = pricedOut.length > 0
      ? Math.min(...pricedOut.map(e => e.output_price!))
      : null;

    const contextLengths = dedupedEntries.map(e => e.context_length).filter(Boolean) as number[];
    const contextLength = contextLengths.length > 0 ? Math.max(...contextLengths) : null;

    // Prefer direct-source name, otherwise best available
    const bestEntry =
      dedupedEntries.find(e => e.source === 'direct') ?? dedupedEntries[0];

    groups.push({
      key,
      name: cleanModelName(bestEntry.model_id),
      family: bestEntry.family,
      params: bestEntry.params,
      contextLength,
      entries: sorted,
      cheapestInput,
      cheapestOutput,
      hasFree: dedupedEntries.some(e => e.free_tier),
    });
  }

  return groups;
}

export default async function Page() {
  let run: CronRun | null = null;
  let snapshots: ModelSnapshot[] = [];

  try {
    const { data: runs } = await supabase
      .from('cron_runs')
      .select('*')
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(1);

    run = runs?.[0] ?? null;

    if (run) {
      const { data } = await supabase
        .from('model_snapshots')
        .select('*')
        .eq('run_id', run.id);

      snapshots = (data ?? []) as ModelSnapshot[];
    }
  } catch {
    // Supabase not configured
  }

  const groups = buildGroups(snapshots);
  const lastRan = run ? timeAgo(run.created_at) : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {!run ? (
        <p className="text-text-dim text-sm">
          No data yet. The first snapshot will appear after the next scheduled cron run.
        </p>
      ) : (
        <ModelGrid
          groups={groups}
          lastRan={lastRan}
          entriesCount={run.entries_count}
          providersCount={run.providers_count}
        />
      )}
    </div>
  );
}
