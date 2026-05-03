const CLOSED_SOURCE_PREFIXES = ['anthropic/', 'openai/', 'x-ai/'];
const CLOSED_GOOGLE_PATTERNS = ['gemini-pro', 'gemini-flash', 'gemini-ultra', 'gemini-1.', 'gemini-2.', 'gemini-exp'];

export function isOssModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (CLOSED_SOURCE_PREFIXES.some(p => lower.startsWith(p))) return false;
  if (lower.startsWith('google/') && CLOSED_GOOGLE_PATTERNS.some(p => lower.includes(p))) return false;
  return true;
}

export function inferFamily(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes('codellama') || lower.includes('llama')) return 'llama';
  if (lower.includes('mixtral') || lower.includes('mistral')) return 'mistral';
  if (lower.includes('qwen')) return 'qwen';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('gemma')) return 'gemma';
  if (lower.includes('phi-') || lower.includes('/phi')) return 'phi';
  if (lower.includes('falcon')) return 'falcon';
  if (lower.includes('command')) return 'command';
  if (lower.includes('solar')) return 'solar';
  if (lower.includes('yi-') || lower.includes('/yi-')) return 'yi';
  if (lower.includes('wizard')) return 'wizard';
  if (lower.includes('zephyr')) return 'zephyr';
  if (lower.includes('orca')) return 'orca';
  if (lower.includes('openchat')) return 'openchat';
  if (lower.includes('nous')) return 'nous';
  return 'other';
}

export function inferParams(modelId: string): string | null {
  const lower = modelId.toLowerCase();
  const moe = lower.match(/(\d+)x(\d+)b/);
  if (moe) return `${moe[1]}x${moe[2]}b`;
  const dense = lower.match(/(\d+(?:\.\d+)?)b/);
  if (dense) return `${dense[1]}b`;
  return null;
}

export function groupKey(modelId: string): string {
  const lower = modelId.toLowerCase().replace(/^[^/]+\//, '');
  const family = inferFamily(modelId);
  const params = inferParams(modelId);

  const versionMatch = lower.match(/[_-](\d+)[._-](\d+)/);
  const majorMatch = lower.match(/[_-v](\d+)[^._-\d]/);
  const version = versionMatch
    ? `${versionMatch[1]}.${versionMatch[2]}`
    : majorMatch
      ? majorMatch[1]
      : '';

  return `${family}-${version}-${params ?? ''}`.replace(/-+/g, '-').replace(/(^-|-$)/g, '');
}

export function cleanModelName(modelId: string): string {
  const withoutOrg = modelId.replace(/^[^/]+\//, '');
  const words = withoutOrg
    .replace(/[-_]/g, ' ')
    .replace(/\b(instruct|chat|hf|it|preview|turbo|versatile|bf16|fp16|gguf)\b/gi, '')
    .replace(/\bv(\d)/gi, 'v$1')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(' ');
}

export function formatPrice(price: number | null): string {
  if (price === null || price === undefined) return '—';
  if (price === 0) return 'free';
  if (price < 0.001) return `$${price.toFixed(5)}`;
  if (price < 0.1) return `$${price.toFixed(3)}`;
  return `$${price.toFixed(2)}`;
}

export function formatContext(tokens: number | null): string {
  if (!tokens) return '';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

export function perTokenToPerMillion(price: number | string): number {
  return parseFloat(String(price)) * 1_000_000;
}
