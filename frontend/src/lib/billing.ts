// Mirror of backend/src/modules/sales/billing.ts for the live cart preview - keep the two in sync.
// The server recalculates every bill; this copy only drives what the cashier sees before paying.
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;


/**
 * GST-inclusive bill calculation (BRD §15). Prices already include GST, so tax is
 * extracted: taxable = net * 100 / (100 + rate). A bill discount is spread over lines
 * in proportion to their net value so each HSN/rate keeps a correct tax amount.
 * The frontend mirrors this function for the live cart preview; the server result is authoritative.
 */
export interface BillLineInput {
  unitPrice: number;
  qty: number;
  mrp: number;
  gstRate: number;
  /** total discount on this line (rupees) */
  itemDiscount?: number;
}

export interface BillLine extends Required<BillLineInput> {
  gross: number;
  billDiscount: number;
  lineTotal: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface BillResult {
  lines: BillLine[];
  mrpTotal: number;
  grossTotal: number;
  itemDiscount: number;
  billDiscount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  totalQty: number;
  savings: number;
}

export type BillDiscount = { type: 'flat' | 'percent'; value: number } | null | undefined;

export function computeBill(inputs: BillLineInput[], discount: BillDiscount, opts: { interState?: boolean; roundOff?: boolean } = {}): BillResult {
  const base = inputs.map((l) => {
    const gross = round2(l.unitPrice * l.qty);
    const itemDiscount = Math.min(round2(l.itemDiscount ?? 0), gross);
    return { ...l, itemDiscount, gross, net: round2(gross - itemDiscount) };
  });
  const sumNet = round2(base.reduce((s, l) => s + l.net, 0));

  let billDiscount = 0;
  if (discount && discount.value > 0) {
    billDiscount = discount.type === 'percent' ? round2((sumNet * Math.min(discount.value, 100)) / 100) : round2(discount.value);
    billDiscount = Math.min(billDiscount, sumNet);
  }

  // allocate bill discount; the last non-zero line absorbs rounding so the shares add up exactly
  let remaining = billDiscount;
  const lastIdx = base.map((l) => l.net > 0).lastIndexOf(true);
  const lines: BillLine[] = base.map((l, i) => {
    const share = i === lastIdx ? remaining : sumNet > 0 ? round2((billDiscount * l.net) / sumNet) : 0;
    remaining = round2(remaining - share);
    const lineTotal = round2(l.net - share);
    const taxableAmount = round2((lineTotal * 100) / (100 + l.gstRate));
    return {
      unitPrice: l.unitPrice, qty: l.qty, mrp: l.mrp, gstRate: l.gstRate, itemDiscount: l.itemDiscount,
      gross: l.gross, billDiscount: share, lineTotal, taxableAmount, taxAmount: round2(lineTotal - taxableAmount),
    };
  });

  const exact = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const tax = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
  const total = opts.roundOff === false ? exact : Math.round(exact);
  const cgst = opts.interState ? 0 : round2(tax / 2);
  const mrpTotal = round2(lines.reduce((s, l) => s + l.mrp * l.qty, 0));
  return {
    lines,
    mrpTotal,
    grossTotal: round2(lines.reduce((s, l) => s + l.gross, 0)),
    itemDiscount: round2(lines.reduce((s, l) => s + l.itemDiscount, 0)),
    billDiscount,
    taxableAmount: round2(lines.reduce((s, l) => s + l.taxableAmount, 0)),
    cgst,
    sgst: opts.interState ? 0 : round2(tax - cgst),
    igst: opts.interState ? tax : 0,
    roundOff: round2(total - exact),
    total,
    totalQty: lines.reduce((s, l) => s + l.qty, 0),
    savings: round2(mrpTotal - total),
  };
}
