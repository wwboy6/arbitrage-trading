// just to fix typing of vscode
export function setIntersection<T>(set0: Set<T>, set1: Set<T>): Set<T> {
  return (set0 as any).intersection(set1)
}

export function arrayContains<T>(array: T[], value: T): boolean {
  return array.indexOf(value) >= 0
}

export function randomSelect<T>(items: T[], count: number): T[] {
  if (count < 0) throw new Error("Count must be non-negative");
  if (count > items.length) return items

  if (count === 0) return [];

  // Fisher-Yates shuffle (partial) for unbiased random selection
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (items.length - i));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return items.slice(0, count);
}
