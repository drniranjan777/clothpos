import { computePurchase } from './purchase-calc';

describe('computePurchase (GST-exclusive supplier bills)', () => {
  it('adds GST on top of cost and splits CGST/SGST', () => {
    const p = computePurchase([{ qty: 10, unitCost: 500, gstRate: 5 }]);
    expect(p.taxableAmount).toBe(5000);
    expect(p.cgst).toBe(125);
    expect(p.sgst).toBe(125);
    expect(p.total).toBe(5250);
    expect(p.totalQty).toBe(10);
  });

  it('applies the trade discount before tax, spread by line value', () => {
    const p = computePurchase(
      [
        { qty: 10, unitCost: 300, gstRate: 5 },
        { qty: 2, unitCost: 3000, gstRate: 18 },
      ],
      { discount: 900 },
    );
    expect(p.lines[0].discount).toBe(300);
    expect(p.lines[1].discount).toBe(600);
    expect(p.lines[0].taxAmount).toBe(135); // (3000-300) * 5%
    expect(p.lines[1].taxAmount).toBe(972); // (6000-600) * 18%
    expect(p.total).toBe(8100 + 135 + 972);
  });

  it('uses IGST for an out-of-state supplier and adds freight after tax', () => {
    const p = computePurchase([{ qty: 1, unitCost: 1000, gstRate: 12 }], { interState: true, otherCharges: 250 });
    expect(p.igst).toBe(120);
    expect(p.cgst).toBe(0);
    expect(p.total).toBe(1370);
  });

  it('rounds the bill total and records round-off', () => {
    const p = computePurchase([{ qty: 3, unitCost: 33.33, gstRate: 5 }]);
    expect(p.total).toBe(105);
    expect(p.roundOff).toBe(0.01);
  });
});
