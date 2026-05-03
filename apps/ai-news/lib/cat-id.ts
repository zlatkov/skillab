export function catId(cat: string) {
  return `cat-${cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}
