/**
 * Guards list UIs against malformed API payloads (null / non-array data).
 */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

export function matchesEntitySearch(
  search: string,
  fields: Array<string | null | undefined>,
): boolean {
  if (!search.trim()) return true;
  const q = search.trim().toLowerCase();
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}
