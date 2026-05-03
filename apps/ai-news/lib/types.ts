export interface NewsItem {
  title: string;
  url: string;
  category: string;
  score: number;
  summary: string;
  source: string;
  published_at?: string | null;
  hn_points?: number | null;
  hn_comments?: number | null;
  hn_url?: string | null;
}

export interface NewsRun {
  id: string;
  created_at: string;
  status: 'running' | 'complete' | 'error';
  items: NewsItem[];
  item_count: number;
  error?: string | null;
}

export const CATEGORIES = [
  'Model Release',
  'AI Engineering',
  'Funding',
  'Product Launch',
  'Open Source',
  'M&A',
  'Research',
  'Regulation',
  'Partnership',
  'Industry',
] as const;
