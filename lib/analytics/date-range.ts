export function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function parseRange(searchParams: URLSearchParams, opts?: { defaultDays?: number }) {
  const defaultDays = opts?.defaultDays ?? 30;
  const now = new Date();
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const end = to ? endOfDay(new Date(to)) : endOfDay(now);
  const start = from ? startOfDay(new Date(from)) : startOfDay(new Date(end.getTime() - defaultDays * 86400000));

  return { start, end };
}

