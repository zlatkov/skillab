import { supabase } from '@/lib/supabase';
import { CATEGORIES } from '@/lib/types';
import type { NewsItem, NewsRun } from '@/lib/types';

export const dynamic = 'force-dynamic';

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

  // Also include any categories from the data not in our predefined list
  for (const cat of byCategory.keys()) {
    if (!sortedCategories.includes(cat as typeof CATEGORIES[number])) {
      sortedCategories.push(cat as typeof CATEGORIES[number]);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <a
          href={process.env.NEXT_PUBLIC_HOME_URL ?? 'https://zlatkov.ai'}
          className="text-xs text-text-dim hover:text-accent transition-colors"
        >
          &larr; Home
        </a>
        <div className="flex items-baseline gap-3 mt-2">
          <h1 className="text-2xl font-bold text-accent">ai-news</h1>
          {displayRun?.created_at && (
            <span className="text-text-dim text-xs">
              {new Date(displayRun.created_at).toLocaleString('en-US', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>
          )}
        </div>
        <p className="text-text-dim text-sm mt-1">AI industry news, scored and categorized</p>
        {isRunning && (
          <p className="text-xs text-accent mt-2 loading-text">Fetching latest news...</p>
        )}
      </div>

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
          <section key={category} className="mb-8">
            <h2 className="text-xs font-bold text-text-dim uppercase tracking-wider mb-3">
              {category}{' '}
              <span className="text-text-dim/40 font-normal">({items.length})</span>
            </h2>
            <div className="space-y-3">
              {items.map((item, i) => (
                <article key={i} className="border border-border rounded-lg p-4 bg-bg-secondary">
                  <div className="flex items-start gap-3">
                    <span className={`shrink-0 text-xs font-bold px-1.5 py-0.5 rounded mt-0.5 ${scoreBadge(item.score)}`}>
                      {item.score}/10
                    </span>
                    <div className="min-w-0">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-bold hover:text-accent transition-colors leading-snug block"
                      >
                        {item.title}
                      </a>
                      <p className="text-xs text-text-dim mt-1 leading-relaxed">{item.summary}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-text-dim/50">
                        <span>{item.source}</span>
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
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      {displayRun?.status === 'complete' && (
        <p className="text-xs text-text-dim/40 mt-4">
          {displayRun.item_count} items · runs at 08:00 and 20:00 UTC
        </p>
      )}
    </div>
  );
}

function scoreBadge(score: number): string {
  if (score >= 8) return 'bg-success/20 text-success';
  if (score >= 6) return 'bg-warning/20 text-warning';
  return 'bg-text-dim/10 text-text-dim';
}
