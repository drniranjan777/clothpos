import { round2 } from '../../common/util';

/**
 * Supplier invoice maths. Supplier costs are GST-exclusive: the trade discount is spread over the
 * lines (by value) before tax, GST is added per line, then freight/other charges and round-off.
 */
export interface PurchaseLineInput {
  qty: number;
  unitCost: number;
  gstRate: number;
}
export interface PurchaseLine extends PurchaseLineInput {
  gross: number;
  discount: number;
  taxableAmount: number;
  taxAmount: number;
  lineTotal: number;
}
export interface PurchaseTotals {
  lines: PurchaseLine[];
  grossAmount: number;
  discount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  otherCharges: number;
  roundOff: number;
  total: number;
  totalQty: number;
}

export function computePurchase(inputs: PurchaseLineInput[], opts: { discount?: number; otherCharges?: number; interState?: boolean } = {}): PurchaseTotals {
  const gross = inputs.map((l) => round2(l.qty * l.unitCost));
  const grossAmount = round2(gross.reduce((a, b) => a + b, 0));
  const discount = Math.min(round2(opts.discount ?? 0), grossAmount);
  let remaining = discount;
  const last = gross.map((g) => g > 0).lastIndexOf(true);
  const lines = inputs.map((l, i) => {
    const share = i === last ? remaining : grossAmount > 0 ? round2((discount * gross[i]) / grossAmount) : 0;
    remaining = round2(remaining - share);
    const taxableAmount = round2(gross[i] - share);
    const taxAmount = round2((taxableAmount * l.gstRate) / 100);
    return { ...l, gross: gross[i], discount: share, taxableAmount, taxAmount, lineTotal: round2(taxableAmount + taxAmount) };
  });
  const taxableAmount = round2(lines.reduce((s, l) => s + l.taxableAmount, 0));
  const tax = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
  const otherCharges = round2(opts.otherCharges ?? 0);
  const exact = round2(taxableAmount + tax + otherCharges);
  const total = Math.round(exact);
  const cgst = opts.interState ? 0 : round2(tax / 2);
  return {
    lines, grossAmount, discount, taxableAmount, cgst,
    sgst: opts.interState ? 0 : round2(tax - cgst),
    igst: opts.interState ? tax : 0,
    otherCharges, roundOff: round2(total - exact), total,
    totalQty: lines.reduce((s, l) => s + l.qty, 0),
  };
}
