import { supabase } from '@/lib/supabase';
import { CATEGORIES } from '@/lib/types';
import type { NewsItem, NewsRun } from '@/lib/types';
import { CategoryNav } from './category-nav';
import { catId } from '@/lib/cat-id';

export const dynamic = 'force-dynamic';

function relativeTime(isoDate: string | undefined, direction: 'ago' | 'until', intervalHours: number): string {
  if (!isoDate) return direction === 'until' ? `~${intervalHours}h` : '—';
  const refMs = direction === 'until'
    ? new Date(isoDate).getTime() + intervalHours * 60 * 60 * 1000
    : new Date(isoDate).getTime();
  const diffMins = Math.round((direction === 'until' ? refMs - Date.now() : Date.now() - refMs) / 60000);
  if (diffMins <= 0) return direction === 'until' ? 'soon' : 'just now';
  if (diffMins < 60) return `${diffMins}m${direction === 'ago' ? ' ago' : ''}`;
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  const str = m === 0 ? `${h}h` : `${h}h ${m}m`;
  return direction === 'ago' ? `${str} ago` : str;
}

function formatItemDate(published_at: string | null | undefined): string {
  if (!published_at) return '';
  const d = new Date(published_at);
  if (isNaN(d.getTime())) return '';
  const diffMins = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMins < 0 || diffMins > 14 * 24 * 60) return '';
  if (diffMins < 60) return `${diffMins}m ago`;
  const h = Math.floor(diffMins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function Page() {
  let runs: NewsRun[] = [];
  try {
    const { data } = await supabase
      .from('news_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2);
    runs = (data ?? []) as NewsRun[];
  } catch {
    // Supabase not configured
  }

  const latestRun = runs[0];
  const isRunning = latestRun?.status === 'running';
  const displayRun = isRunning ? runs[1] : latestRun;

  const byCategory = new Map<string, NewsItem[]>();
  if (displayRun?.items) {
    for (const item of displayRun.items) {
      const arr = byCategory.get(item.category) ?? [];
      arr.push(item);
      byCategory.set(item.category, arr);
    }
    for (const [cat, items] of byCategory) {
      byCategory.set(cat, [...items].sort((a, b) => b.score - a.score));
    }
  }

  const sortedCategories = CATEGORIES
    .filter(c => byCategory.has(c))
    .sort((a, b) => (byCategory.get(b)?.length ?? 0) - (byCategory.get(a)?.length ?? 0));

  for (const cat of byCategory.keys()) {
    if (!sortedCategories.includes(cat as typeof CATEGORIES[number])) {
      sortedCategories.push(cat as typeof CATEGORIES[number]);
    }
  }

  const intervalHours = parseInt(process.env.RUN_INTERVAL_HOURS ?? '6', 10);
  const lastRan = relativeTime(displayRun?.created_at, 'ago', intervalHours);
  const nextRun = relativeTime(displayRun?.created_at, 'until', intervalHours);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 flex gap-8">
      {/* Sidebar nav */}
      <nav className="hidden md:block w-40 shrink-0">
        <div className="sticky top-8">
          <a
            href={process.env.NEXT_PUBLIC_HOME_URL ?? 'https://zlatkov.ai'}
            className="text-xs text-text-dim hover:text-accent transition-colors"
          >
            &larr; Home
          </a>
          <div className="mt-3 mb-1">
            <span className="text-lg font-bold text-accent">ai-news</span>
          </div>
          <div className="text-xs text-text-dim/60 mb-1">Last run: {lastRan}</div>
          <div className="text-xs text-text-dim/60 mb-4">Next run: ~{nextRun}</div>
          {isRunning && (
            <p className="text-xs text-accent mb-3 loading-text">Fetching...</p>
          )}
          <CategoryNav categories={sortedCategories} />
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Mobile header */}
        <header className="mb-8 md:hidden">
          <a
            href={process.env.NEXT_PUBLIC_HOME_URL ?? 'https://zlatkov.ai'}
            className="text-xs text-text-dim hover:text-accent transition-colors"
          >
            &larr; Home
          </a>
          <div className="flex items-baseline gap-3 mt-2">
            <h1 className="text-2xl font-bold text-accent">ai-news</h1>
          </div>
          <p className="text-text-dim text-sm mt-1">AI industry news, scored and categorized</p>
          <p className="text-xs text-text-dim/60 mt-1">Last run: {lastRan} · Next run: ~{nextRun}</p>
          {isRunning && <p className="text-xs text-accent mt-2 loading-text">Fetching latest news...</p>}
        </header>

        {!latestRun && (
          <p className="text-text-dim text-sm">
            No news yet. The first digest will appear after the next scheduled run.
          </p>
        )}

        {displayRun?.status === 'error' && (
          <div className="border border-error/30 rounded-lg p-4 mb-6 text-sm text-error">
            Last run failed: {displayRun.error}
          </div>
        )}

        {sortedCategories.map(category => {
          const items = byCategory.get(category)!;
          return (
            <section key={category} id={catId(category)} className="mb-8 scroll-mt-8">
              <h2 className="text-xs font-bold text-text-dim uppercase tracking-wider mb-3">
                {category}{' '}
                <span className="text-text-dim/40 font-normal">({items.length})</span>
              </h2>
              <div className="space-y-3">
                {items.map((item, i) => {
                  const date = formatItemDate(item.published_at);
                  return (
                    <article key={i} className="relative border border-border rounded-lg p-4 bg-bg-secondary hover:border-accent/50 transition-colors">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-bold leading-snug block after:absolute after:inset-0"
                      >
                        {item.title}
                      </a>
                      <p className="text-xs text-text-dim mt-1 leading-relaxed">{item.summary}</p>
                      <div className="relative z-10 flex items-center gap-3 mt-2 text-xs text-text-dim/50">
                        <span>{item.source}</span>
                        {date && <span>{date}</span>}
                        {item.hn_points != null && item.hn_url && (
                          <a
                            href={item.hn_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-accent transition-colors"
                          >
                            HN: {item.hn_points} pts
                            {item.hn_comments != null && ` · ${item.hn_comments} comments`}
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        {displayRun?.status === 'complete' && (
          <p className="text-xs text-text-dim/40 mt-4">
            {displayRun.item_count} items · runs every {intervalHours}h
          </p>
        )}
      </div>
    </div>
  );
}
