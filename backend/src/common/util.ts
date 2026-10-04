export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function parsePage(page?: string | number, size?: string | number, max = 100) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(max, Math.max(1, Number(size) || 20));
  return { skip: (p - 1) * s, take: s, page: p, pageSize: s };
}

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
}

/** yyyy-mm-dd in local time */
export function isoDate(d: Date) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function startOfDay(d = new Date()) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** EAN-13 check digit for a 12-digit body. */
export function ean13(body12: string) {
  const sum = body12.split('').reduce((s, ch, i) => s + Number(ch) * (i % 2 ? 3 : 1), 0);
  return body12 + ((10 - (sum % 10)) % 10);
}
