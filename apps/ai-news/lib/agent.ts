import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { Langfuse } from 'langfuse';
import type { NewsItem } from './types';

// --- Sources ---

const BRAVE_QUERIES = [
  'AI company acquisition merger this week',
  'AI startup funding round this week',
  'new large language model release announcement',
  'AI product launch announcement',
  'AI engineering tools framework release',
  'AI infrastructure MLOps platform update',
  'AI regulation policy government',
  'AI partnership deal collaboration',
  'open source AI model release',
  'AI agent framework developer tools',
];

const RSS_FEEDS = [
  { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', name: 'The Verge' },
  { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', name: 'TechCrunch' },
  { url: 'https://venturebeat.com/category/ai/feed/', name: 'VentureBeat' },
  { url: 'https://a16z.com/feed/', name: 'a16z' },
  { url: 'https://huggingface.co/blog/feed.xml', name: 'Hugging Face' },
  { url: 'https://www.deeplearning.ai/the-batch/feed/', name: 'The Batch' },
  { url: 'https://www.technologyreview.com/feed/', name: 'MIT Tech Review' },
];

// Key AI figures to monitor on X
const X_ACCOUNTS = [
  'sama', 'karpathy', 'gdb', 'DarioAmodei',
  'hwchase17', 'jerryjliu0', 'rauchg', 'ilyasut',
];

// --- Fetchers ---

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
      published_at: h.created_at,
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

async function fetchX(): Promise<object[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return [];

  const query = `(${X_ACCOUNTS.map(a => `from:${a}`).join(' OR ')}) (AI OR LLM OR agent OR model) -is:retweet lang:en`;
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    query,
    max_results: '20',
    'tweet.fields': 'created_at,public_metrics,author_id',
    expansions: 'author_id',
    'user.fields': 'name,username',
    start_time: oneDayAgo,
  });

  const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];

  const data = await res.json() as {
    data?: Array<{
      id: string;
      text: string;
      author_id: string;
      public_metrics: { like_count: number; retweet_count: number };
    }>;
    includes?: { users?: Array<{ id: string; username: string; name: string }> };
  };

  const users = new Map((data.includes?.users ?? []).map(u => [u.id, u]));

  return (data.data ?? [])
    .map(tweet => {
      const user = users.get(tweet.author_id);
      return {
        text: tweet.text,
        url: `https://x.com/${user?.username ?? 'unknown'}/status/${tweet.id}`,
        author: `@${user?.username ?? 'unknown'} (${user?.name ?? ''})`,
        likes: tweet.public_metrics?.like_count ?? 0,
        retweets: tweet.public_metrics?.retweet_count ?? 0,
      };
    })
    .filter(t => t.likes + t.retweets >= 5);
}

// --- RSS parser (no external dependencies) ---

function extractXMLField(block: string, tag: string): string {
  // <tag>content</tag> or <![CDATA[...]]>
  const tagMatch = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (tagMatch) {
    return tagMatch[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .trim();
  }
  // Atom self-closing: <link href="..."/>
  const hrefMatch = block.match(new RegExp(`<${tag}[^>]+href=["']([^"']+)["']`, 'i'));
  return hrefMatch ? hrefMatch[1] : '';
}

function parseRSSFeed(xml: string, sourceName: string): object[] {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const items: object[] = [];

  // Match both RSS <item> and Atom <entry>
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi),
                  ...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];

  for (const [, block] of blocks) {
    const title = extractXMLField(block, 'title');
    const link = extractXMLField(block, 'link') || extractXMLField(block, 'guid');
    const snippet = extractXMLField(block, 'description') || extractXMLField(block, 'summary');
    const pubDate = extractXMLField(block, 'pubDate') || extractXMLField(block, 'published') || extractXMLField(block, 'updated');

    if (!title || !link || !link.startsWith('http')) continue;

    if (pubDate) {
      const ts = new Date(pubDate).getTime();
      if (!isNaN(ts) && ts < sevenDaysAgo) continue;
    }

    items.push({ title, url: link, snippet: snippet.slice(0, 300), source: sourceName, published_at: pubDate || null });
  }

  return items.slice(0, 10);
}

async function fetchRSS(feedUrl: string, name: string): Promise<object[]> {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': 'ai-news/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  return parseRSSFeed(xml, name);
}

// --- LLM scoring ---

const FALLBACK_SYSTEM_PROMPT = `You are an AI news analyst. You will receive a JSON object with raw news items from multiple sources:
- "hn": Hacker News stories (title, url, points, hn_url)
- "brave": Brave Search results (title, url, snippet, source, query)
- "rss": Articles from AI publications (title, url, snippet, source)
- "x": Recent tweets from key AI figures (text, url, author, likes, retweets) — may be empty

Your task:
1. Deduplicate items that cover the same story — keep the most informative version
2. Assign each unique item exactly one category: M&A, Funding, Product Launch, Model Release, AI Engineering, Research, Regulation, Partnership, Open Source, or Industry
3. Score each item 1-10 for relevance and importance to the AI industry
4. Write a one-sentence summary explaining why it matters

Scoring:
- 9-10: Industry-defining event (major acquisition, breakthrough model, significant regulation)
- 7-8: Major announcement (significant funding $50M+, important model release, widely-used tool launch)
- 6: Noteworthy development (new tools, partnerships, policy updates, high-engagement tweets from key figures)
- Below 6: Do not include in output

Prioritize: foundation model releases, AI engineering tools, funding $50M+, open source releases from major labs, high-signal tweets from key AI researchers.
For X tweets, factor in engagement (likes + retweets) as a quality signal.

Respond with ONLY a valid JSON array, no markdown, no other text:
[{"title":"...","url":"...","category":"...","score":8,"summary":"one sentence why this matters","source":"domain.com","published_at":"<ISO 8601 from source or null>","hn_points":null,"hn_comments":null,"hn_url":null}]

For "published_at": extract the publication date from the source data (RSS pubDate, HN submission time, tweet created_at). Use ISO 8601 format. Set to null if unavailable.
For X tweets use the tweet text as the title and "@username" as the source.`;

async function getSystemPrompt(): Promise<string> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return FALLBACK_SYSTEM_PROMPT;

  try {
    const langfuse = new Langfuse({ publicKey, secretKey, baseUrl: process.env.LANGFUSE_BASE_URL });
    const prompt = await langfuse.getPrompt('ai-news-system-prompt');
    return prompt.compile();
  } catch {
    return FALLBACK_SYSTEM_PROMPT;
  }
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
}

// --- Main ---

export async function runNewsAgent(): Promise<NewsItem[]> {
  const openrouter = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    headers: {
      'HTTP-Referer': 'https://ainews.zlatkov.ai',
      'X-Title': 'ai-news',
    },
  });

  const model = process.env.OPENROUTER_MODEL ?? 'openrouter/auto';

  // Fetch all sources in parallel
  const [hnResult, xResult, ...rest] = await Promise.allSettled([
    fetchHN(),
    fetchX(),
    ...BRAVE_QUERIES.map(q => fetchBrave(q)),
    ...RSS_FEEDS.map(f => fetchRSS(f.url, f.name)),
  ]);

  const braveResults = rest.slice(0, BRAVE_QUERIES.length);
  const rssResults = rest.slice(BRAVE_QUERIES.length);

  const rawData = {
    hn: hnResult.status === 'fulfilled' ? hnResult.value : [],
    x: xResult.status === 'fulfilled' ? xResult.value : [],
    brave: braveResults
      .filter((r): r is PromiseFulfilledResult<object[]> => r.status === 'fulfilled')
      .flatMap(r => r.value),
    rss: rssResults
      .filter((r): r is PromiseFulfilledResult<object[]> => r.status === 'fulfilled')
      .flatMap(r => r.value),
  };

  const systemPrompt = await getSystemPrompt();

  const { text } = await generateText({
    model: openrouter(model),
    system: systemPrompt,
    prompt: JSON.stringify(rawData),
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'news-scoring',
      metadata: {
        hn_count: rawData.hn.length,
        brave_count: rawData.brave.length,
        rss_count: rawData.rss.length,
        x_count: rawData.x.length,
      },
    },
  });

  const parsed = JSON.parse(stripFences(text));
  if (!Array.isArray(parsed)) throw new Error('LLM did not return a JSON array');
  return parsed as NewsItem[];
}
