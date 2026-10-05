const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-IN');

/** ₹1,84,560 - pass decimals=true for ₹7,094.00 */
export const inr = (v: number | null | undefined, decimals = false) => (decimals ? inr2 : inr0).format(Number(v ?? 0));
export const n = (v: number | null | undefined) => num.format(Number(v ?? 0));

/** ₹18.4L / ₹2.21Cr / ₹42k - compact Indian units for KPI tiles */
export function inrShort(v: number) {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.?0+$/, '')}Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
  if (a >= 1e4) return `₹${(v / 1e3).toFixed(0)}k`;
  return inr(v);
}

export const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtDay = (d: string | Date) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
export const fmtTime = (d: string | Date) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (d: string | Date) => `${fmtDay(d)} · ${fmtTime(d)}`;

export function relDay(d: string | Date) {
  const day = new Date(d);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(day.toDateString()).getTime()) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return fmtDay(d);
}

export const daysUntil = (d: string) => Math.ceil((new Date(d).getTime() - new Date(new Date().toDateString()).getTime()) / 864e5);

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export const isoToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', card: 'Card', wallet: 'Wallet', bank: 'Bank transfer', store_credit: 'Store credit',
  upi_autopay: 'UPI autopay', netbanking: 'Net banking',
};

/** avatar colours derived from the name so a person keeps the same colour everywhere */
const AV = [['#dbeafe', '#1d4ed8'], ['#fce7f3', '#be185d'], ['#dcfce7', '#15803d'], ['#ede9fe', '#6d28d9'], ['#fef3c7', '#b45309'], ['#e0f2fe', '#0369a1'], ['#fee2e2', '#b91c1c']];
export function avatarColor(name = '') {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV[h % AV.length];
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ' ' + ONES[r % 10] : ''}`;
  return [h ? `${ONES[h]} Hundred` : '', rest].filter(Boolean).join(' ');
}
/** 7094.5 -> "Rupees Seven Thousand Ninety Four and Fifty Paise Only" (Indian lakh / crore grouping) */
export function rupeesInWords(amount: number) {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${crore >= 1000 ? rupeesInWords(crore).replace(/^Rupees | Only$/g, '') : below1000(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  const words = parts.join(' ') || 'Zero';
  return `Rupees ${words}${paise ? ` and ${below1000(paise)} Paise` : ''} Only`;
}
