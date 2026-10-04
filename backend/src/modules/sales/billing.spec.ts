import { computeBill } from './billing';

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('computeBill (GST-inclusive retail billing)', () => {
  it('extracts GST from inclusive prices and splits CGST/SGST equally', () => {
    const b = computeBill([{ unitPrice: 1050, qty: 1, mrp: 1499, gstRate: 5 }], null);
    expect(b.taxableAmount).toBe(1000);
    expect(b.cgst).toBe(25);
    expect(b.sgst).toBe(25);
    expect(b.igst).toBe(0);
    expect(b.total).toBe(1050);
    expect(b.savings).toBe(449);
  });

  it('uses IGST for inter-state bills', () => {
    const b = computeBill([{ unitPrice: 1180, qty: 1, mrp: 1180, gstRate: 18 }], null, { interState: true });
    expect(b.igst).toBe(180);
    expect(b.cgst + b.sgst).toBe(0);
  });

  it('spreads a flat bill discount across lines so the shares add up exactly', () => {
    const b = computeBill(
      [
        { unitPrice: 999, qty: 1, mrp: 1499, gstRate: 5 },
        { unitPrice: 1599, qty: 1, mrp: 2199, gstRate: 5 },
        { unitPrice: 449, qty: 2, mrp: 599, gstRate: 5 },
      ],
      { type: 'flat', value: 200 },
    );
    expect(b.billDiscount).toBe(200);
    expect(sum(b.lines.map((l) => l.billDiscount))).toBe(200);
    expect(b.total).toBe(999 + 1599 + 898 - 200);
    // every line: taxable + tax = what the customer pays for it
    for (const l of b.lines) expect(Math.round((l.taxableAmount + l.taxAmount) * 100) / 100).toBe(l.lineTotal);
  });

  it('keeps tax correct per rate when lines have different GST rates', () => {
    const b = computeBill(
      [
        { unitPrice: 1000, qty: 1, mrp: 1000, gstRate: 5 },
        { unitPrice: 5900, qty: 1, mrp: 5900, gstRate: 18 },
      ],
      { type: 'percent', value: 10 },
    );
    expect(b.billDiscount).toBe(690);
    expect(b.lines[0].lineTotal).toBe(900);
    expect(b.lines[1].lineTotal).toBe(5310);
    expect(b.lines[1].taxAmount).toBe(810); // 5310 * 18/118
    expect(b.total).toBe(6210);
  });

  it('applies item discounts before the bill discount and caps them at the line value', () => {
    const b = computeBill([{ unitPrice: 500, qty: 2, mrp: 600, gstRate: 5, itemDiscount: 5000 }], { type: 'flat', value: 50 });
    expect(b.itemDiscount).toBe(1000);
    expect(b.billDiscount).toBe(0); // nothing left to discount
    expect(b.total).toBe(0);
  });

  it('rounds the payable to the rupee and records the round-off', () => {
    const b = computeBill([{ unitPrice: 333.33, qty: 3, mrp: 400, gstRate: 5 }], null);
    expect(b.total).toBe(1000);
    expect(b.roundOff).toBe(0.01);
    const exact = computeBill([{ unitPrice: 333.33, qty: 3, mrp: 400, gstRate: 5 }], null, { roundOff: false });
    expect(exact.total).toBe(999.99);
    expect(exact.roundOff).toBe(0);
  });

  it('never lets a percent discount exceed 100%', () => {
    const b = computeBill([{ unitPrice: 100, qty: 1, mrp: 100, gstRate: 5 }], { type: 'percent', value: 150 });
    expect(b.total).toBe(0);
  });

  it('handles an empty cart', () => {
    const b = computeBill([], { type: 'flat', value: 100 });
    expect(b.total).toBe(0);
    expect(b.totalQty).toBe(0);
  });
});
