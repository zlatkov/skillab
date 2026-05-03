'use client';

import { Fragment, useState, useMemo, useEffect, useRef } from 'react';
import type { ModelGroup, ModelSnapshot } from '@/lib/types';
import { PROVIDER_NAMES, PROVIDER_URLS } from '@/lib/types';
import { formatPrice, formatContext } from '@/lib/utils';

const COLLAPSE_AT = 5;

interface ModelGridProps {
  groups: ModelGroup[];
  lastRan: string | null;
  entriesCount: number;
  providersCount: number;
}

export function ModelGrid({ groups, lastRan, entriesCount, providersCount }: ModelGridProps) {
  const [family, setFamily] = useState('all');
  const [sort, setSort] = useState<'name' | 'cheapest'>('name');
  const [search, setSearch] = useState('');

  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groups) counts.set(g.family, (counts.get(g.family) ?? 0) + 1);
    return [
      { id: 'all', label: `All (${groups.length})` },
      ...[...counts.entries()]
        .sort((a, b) => {
          if (a[0] === 'other') return 1;
          if (b[0] === 'other') return -1;
          return b[1] - a[1];
        })
        .map(([id, count]) => ({
          id,
          label: `${id.charAt(0).toUpperCase() + id.slice(1)} (${count})`,
        })),
    ];
  }, [groups]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = groups
      .filter(g => family === 'all' || g.family === family)
      .filter(g => !q || g.name.toLowerCase().includes(q) || g.family.toLowerCase().includes(q));
    if (sort === 'cheapest') {
      return [...base].sort((a, b) => {
        const ai = a.cheapestInput ?? Infinity;
        const bi = b.cheapestInput ?? Infinity;
        return ai - bi;
      });
    }
    return [...base].sort((a, b) => a.name.localeCompare(b.name));
  }, [groups, family, sort, search]);

  const availableLetters = useMemo(() => {
    if (sort !== 'name') return [];
    const letters = new Set(filtered.map(g => g.name[0]?.toUpperCase()).filter(Boolean) as string[]);
    return [...letters].sort();
  }, [filtered, sort]);

  // Group by first letter when sorted A-Z
  const letterGroups = useMemo(() => {
    if (sort !== 'name') return null;
    const map = new Map<string, ModelGroup[]>();
    for (const g of filtered) {
      const letter = g.name[0]?.toUpperCase() ?? '#';
      const arr = map.get(letter) ?? [];
      arr.push(g);
      map.set(letter, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, sort]);

  return (
    <div className="flex gap-8">
      {/* Sidebar */}
      <nav className="hidden md:block w-36 shrink-0">
        <div className="sticky top-8">
          <a
            href={process.env.NEXT_PUBLIC_HOME_URL ?? 'https://zlatkov.ai'}
            className="text-xs text-text-dim hover:text-accent transition-colors"
          >
            &larr; Home
          </a>
          <div className="mt-3 mb-1">
            <span className="text-lg font-bold text-accent">oss-llms</span>
          </div>
          {lastRan && (
            <div className="text-xs text-text-dim/50 mb-0.5">Updated: {lastRan}</div>
          )}
          <div className="text-xs text-text-dim/50 mb-0.5">{entriesCount} entries</div>
          <div className="text-xs text-text-dim/50 mb-4">{providersCount} providers</div>
          {sort === 'name' && availableLetters.length > 0 && (
            <AlphaNav letters={availableLetters} />
          )}
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Mobile header */}
        <header className="mb-6 md:hidden">
          <a
            href={process.env.NEXT_PUBLIC_HOME_URL ?? 'https://zlatkov.ai'}
            className="text-xs text-text-dim hover:text-accent transition-colors"
          >
            &larr; Home
          </a>
          <div className="flex items-baseline gap-3 mt-2">
            <h1 className="text-2xl font-bold text-accent">oss-llms</h1>
          </div>
          <p className="text-text-dim text-sm mt-1">
            OSS model pricing and availability across inference providers
          </p>
          {lastRan && (
            <p className="text-xs text-text-dim/50 mt-1">
              Updated {lastRan} · {entriesCount} entries
            </p>
          )}
        </header>

        {/* Search */}
        <input
          type="search"
          placeholder="Search models…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full mb-4 px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text placeholder-text-dim/40 focus:outline-none focus:border-accent/50 transition-colors"
        />

        {/* Filters */}
        <div className="mb-6 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {families.map(f => (
              <button
                key={f.id}
                onClick={() => setFamily(f.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  family === f.id
                    ? 'bg-accent text-black'
                    : 'bg-bg-secondary text-text-dim hover:bg-bg-tertiary border border-border'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-dim/40 mr-1">sort:</span>
            {(['name', 'cheapest'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  sort === s
                    ? 'text-accent border border-accent/40'
                    : 'text-text-dim/50 border border-border hover:text-text-dim'
                }`}
              >
                {s === 'name' ? 'A–Z' : 'cheapest first'}
              </button>
            ))}
          </div>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <p className="text-text-dim/50 text-sm">No models found.</p>
        ) : (
          <div className="border border-border rounded-lg">
            {letterGroups
              ? letterGroups.map(([letter, letterModels]) => (
                  <Fragment key={letter}>
                    <div
                      id={`letter-${letter}`}
                      className="px-4 py-1.5 border-b border-border bg-bg-tertiary scroll-mt-4"
                    >
                      <span className="text-xs font-bold text-text-dim/40">{letter}</span>
                    </div>
                    {letterModels.map(group => (
                      <ModelRow key={group.key} group={group} />
                    ))}
                  </Fragment>
                ))
              : filtered.map(group => (
                  <ModelRow key={group.key} group={group} />
                ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AlphaNav({ letters }: { letters: string[] }) {
  const [active, setActive] = useState(letters[0] ?? '');
  const lockRef = useRef(false);

  useEffect(() => {
    setActive(letters[0] ?? '');
    const observer = new IntersectionObserver(
      (entries) => {
        if (lockRef.current) return;
        for (const e of entries) {
          if (e.isIntersecting) {
            setActive(e.target.id.replace('letter-', ''));
            break;
          }
        }
      },
      { rootMargin: '-10% 0px -80% 0px', threshold: 0 },
    );
    for (const letter of letters) {
      const el = document.getElementById(`letter-${letter}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [letters]);

  return (
    <ul className="flex flex-wrap gap-1">
      {letters.map(letter => (
        <li key={letter}>
          <a
            href={`#letter-${letter}`}
            onClick={() => {
              setActive(letter);
              lockRef.current = true;
              setTimeout(() => { lockRef.current = false; }, 1000);
            }}
            className={`flex items-center justify-center w-7 h-7 rounded text-sm font-mono transition-colors ${
              active === letter
                ? 'bg-accent text-black font-bold'
                : 'text-text-dim hover:text-accent hover:bg-bg-tertiary'
            }`}
          >
            {letter}
          </a>
        </li>
      ))}
    </ul>
  );
}

function ModelRow({ group }: { group: ModelGroup }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? group.entries : group.entries.slice(0, COLLAPSE_AT);
  const overflow = group.entries.length - COLLAPSE_AT;

  return (
    <div className="flex items-start gap-6 px-4 py-3 border-b border-border last:border-b-0 hover:bg-bg-secondary/50 transition-colors">
      {/* Left: model info */}
      <div className="w-52 shrink-0 pt-0.5">
        <h3 className="text-sm font-bold leading-tight">{group.name}</h3>
        <div className="flex flex-wrap items-center gap-x-1 mt-1 text-xs text-text-dim/50">
          <span>{group.family}</span>
          {group.contextLength && <span>· ctx {formatContext(group.contextLength)}</span>}
          {group.hasFree && <span className="text-accent/70">· free</span>}
        </div>
      </div>

      {/* Right: provider chips */}
      <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
        {visible.map(entry => (
          <ProviderChip
            key={`${entry.provider_id}:${entry.provider_model_id}`}
            entry={entry}
            isCheapestInput={group.cheapestInput != null && entry.input_price === group.cheapestInput}
            isCheapestOutput={group.cheapestOutput != null && entry.output_price === group.cheapestOutput}
          />
        ))}
        {!expanded && overflow > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-text-dim/40 hover:text-text-dim px-2 py-1 border border-border rounded hover:border-border-hover transition-colors self-center"
          >
            +{overflow} more
          </button>
        )}
        {expanded && overflow > 0 && (
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-text-dim/40 hover:text-text-dim px-2 py-1 border border-border rounded hover:border-border-hover transition-colors self-center"
          >
            show less
          </button>
        )}
      </div>
    </div>
  );
}

function ProviderChip({
  entry,
  isCheapestInput,
  isCheapestOutput,
}: {
  entry: ModelSnapshot;
  isCheapestInput: boolean;
  isCheapestOutput: boolean;
}) {
  const isBest = isCheapestInput || isCheapestOutput;
  const name = PROVIDER_NAMES[entry.provider_id] ?? entry.provider_id;
  const url = PROVIDER_URLS[entry.provider_id];
  const inputPrice = entry.input_price != null && entry.input_price >= 0 ? entry.input_price : null;
  const outputPrice = entry.output_price != null && entry.output_price >= 0 ? entry.output_price : null;
  const hasPrice = inputPrice != null || outputPrice != null;

  const chipClass = `
    inline-flex flex-col gap-0.5 text-xs rounded px-2.5 py-1.5 border transition-colors
    ${inputPrice === 0 && outputPrice === 0
      ? 'border-accent/40 bg-accent/5'
      : isBest
        ? 'border-success/40 bg-success/5'
        : 'border-border bg-bg-secondary hover:border-border-hover'
    }
  `.trim();

  const inner = (
    <>
      <span className={`font-medium ${isBest ? 'text-success' : 'text-text'}`}>
        {name}
        {isBest && <span className="ml-1 text-success">★</span>}
      </span>
      {inputPrice === 0 && outputPrice === 0 ? (
        <span className="text-accent/80">free</span>
      ) : hasPrice ? (
        <span className="text-text-dim tabular-nums">
          <span className={isCheapestInput ? 'text-success' : ''}>{formatPrice(inputPrice)}</span>
          {' / '}
          <span className={isCheapestOutput ? 'text-success' : ''}>{formatPrice(outputPrice)}</span>
        </span>
      ) : (
        <span className="text-text-dim/40">—</span>
      )}
    </>
  );

  if (url) {
    return <a href={url} target="_blank" rel="noopener noreferrer" className={chipClass}>{inner}</a>;
  }
  return <div className={chipClass}>{inner}</div>;
}
