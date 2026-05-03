import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type { NewsItem } from './types';

const BRAVE_QUERIES = [
  'AI company acquisition merger this week',
  'AI startup funding round 2026',
  'new large language model release announcement',
  'AI product launch announcement',
  'AI engineering tools framework release',
  'AI infrastructure MLOps platform update',
  'AI regulation policy government',
  'AI partnership deal collaboration',
  'open source AI model release',
  'AI agent framework developer tools',
];

async function fetchHN(): Promise<object[]> {
  const res = await fetch(
    'https://hn.algolia.com/api/v1/search?query=AI+LLM+artificial+intelligence&tags=story&hitsPerPage=50',
    { signal: AbortSignal.timeout(10000) },
  );
  if (!res.ok) return [];
  const data = await res.json() as { hits: Array<Record<string, unknown>> };
  return (data.hits ?? [])
    .filter(h => (h.points as number) >= 10)
    .map(h => ({
      title: h.title,
      url: h.url,
      points: h.points,
      comments: h.num_comments,
      hn_url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    }));
}

async function fetchBrave(query: string): Promise<object[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&search_lang=en&freshness=pw`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': process.env.BRAVE_API_KEY ?? '',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json() as { web?: { results: Array<Record<string, unknown>> } };
  return (data.web?.results ?? []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    source: (r.meta_url as Record<string, string> | undefined)?.hostname
      ?? (() => { try { return new URL(r.url as string).hostname; } catch { return ''; } })(),
    query,
  }));
}

const SYSTEM_PROMPT = `You are an AI news analyst. You will receive a JSON object with raw news items from Hacker News ("hn") and Brave Search ("brave").

Your task:
1. Deduplicate items that cover the same story — keep the most informative version, note if it appeared on HN
2. Assign each unique item exactly one category: M&A, Funding, Product Launch, Model Release, AI Engineering, Research, Regulation, Partnership, Open Source, or Industry
3. Score each item 1-10 for relevance and importance to the AI industry
4. Write a one-sentence summary explaining why it matters

Scoring:
- 9-10: Industry-defining event (major acquisition, breakthrough model, significant regulation)
- 7-8: Major announcement (significant funding $50M+, important model release, widely-used tool launch)
- 6: Noteworthy development (new tools, partnerships, policy updates)
- Below 6: Do not include in output

Prioritize: foundation model releases, AI engineering tools, funding $50M+, open source releases from major labs.

Respond with ONLY a valid JSON array, no markdown, no other text:
[{"title":"...","url":"...","category":"...","score":8,"summary":"one sentence why this matters","source":"domain.com","hn_points":null,"hn_comments":null,"hn_url":null}]`;

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
}

export async function runNewsAgent(): Promise<NewsItem[]> {
  const openrouter = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    headers: {
      'HTTP-Referer': 'https://ainews.zlatkov.ai',
      'X-Title': 'ai-news',
    },
  });

  const model = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash';

  // Fetch all sources in parallel
  const [hnResult, ...braveResults] = await Promise.allSettled([
    fetchHN(),
    ...BRAVE_QUERIES.map(q => fetchBrave(q)),
  ]);

  const hnItems = hnResult.status === 'fulfilled' ? hnResult.value : [];
  const braveItems = braveResults
    .filter((r): r is PromiseFulfilledResult<object[]> => r.status === 'fulfilled')
    .flatMap(r => r.value);

  const { text } = await generateText({
    model: openrouter(model),
    system: SYSTEM_PROMPT,
    prompt: JSON.stringify({ hn: hnItems, brave: braveItems }),
  });

  const parsed = JSON.parse(stripFences(text));
  if (!Array.isArray(parsed)) throw new Error('LLM did not return a JSON array');
  return parsed as NewsItem[];
}
