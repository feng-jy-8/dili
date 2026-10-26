/** Stable repository tags only; prereleases never replace a stable installation. */
export function stableVersion(value: string): number[] | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}
export function compareVersions(a: string, b: string): number {
  const left = stableVersion(a), right = stableVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! > right[i]! ? 1 : -1;
  return 0;
}
export function latestStableTag(tags: unknown): string | null {
  if (!Array.isArray(tags)) throw new Error('无法读取仓库版本');
  return tags.map(row => row?.name).filter((name): name is string => typeof name === 'string' && !!stableVersion(name)).sort((a, b) => compareVersions(b, a))[0] ?? null;
}
