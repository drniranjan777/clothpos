import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser, CurrentUser, Roles, storeScope, tenantOf } from '../../common/auth';
import { addDays, isoDate, round2, startOfDay } from '../../common/util';

/** Builds "AND alias.store_id = ANY($n)" and pushes the param when the caller is store-scoped. */
function storeSql(params: any[], stores: string[] | undefined, alias = 's') {
  return stores ? `AND ${alias}.store_id = ANY($${params.push(stores)})` : '';
}

@Injectable()
export class ReportsService {
  constructor(@InjectDataSource() private ds: DataSource) {}

  async dashboard(user: AuthUser, storeId?: string) {
    const tenantId = tenantOf(user);
    const stores = storeScope(user, storeId);
    const today = startOfDay();
    const tomorrow = addDays(today, 1);
    const lastWeek = addDays(today, -7);

    const kpi = async (from: Date, to: Date) => {
      const p: any[] = [tenantId, from, to];
      const [r] = await this.ds.query(
        `SELECT COALESCE(SUM(total),0)::float AS sales, COUNT(*)::int AS bills, COALESCE(SUM(total_qty),0)::int AS items
         FROM sales s WHERE tenant_id = $1 AND status = 'completed' AND created_at >= $2 AND created_at < $3 ${storeSql(p, stores)}`, p);
      return r;
    };
    const [now, prev] = await Promise.all([kpi(today, tomorrow), kpi(lastWeek, addDays(lastWeek, 1))]);

    const pr: any[] = [tenantId, today];
    const [returns] = await this.ds.query(
      `SELECT COALESCE(SUM(returned_value),0)::float AS value, COUNT(*) FILTER (WHERE type = 'refund')::int AS refunds,
              COUNT(*) FILTER (WHERE type <> 'refund')::int AS exchanges
       FROM sale_returns s WHERE tenant_id = $1 AND created_at >= $2 ${storeSql(pr, stores)}`, pr);

    // 14-day trend + the 14 days before it, for the comparison line
    const pt: any[] = [tenantId, addDays(today, -27)];
    const daily: { d: string; total: number }[] = await this.ds.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d, SUM(total)::float AS total
       FROM sales s WHERE tenant_id = $1 AND status = 'completed' AND created_at >= $2 ${storeSql(pt, stores)} GROUP BY 1`, pt);
    const byDay = new Map(daily.map((r) => [r.d, r.total]));
    const trend = Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i - 13);
      return { date: isoDate(d), total: byDay.get(isoDate(d)) ?? 0, previous: byDay.get(isoDate(addDays(d, -14))) ?? 0 };
    });

    const pp: any[] = [tenantId, today];
    const paymentMix = await this.ds.query(
      `SELECT p.method, SUM(p.amount)::float AS amount, COUNT(DISTINCT s.id)::int AS bills
       FROM sale_payments p JOIN sales s ON s.id = p.sale_id
       WHERE s.tenant_id = $1 AND s.status = 'completed' AND s.created_at >= $2 ${storeSql(pp, stores)} GROUP BY p.method ORDER BY amount DESC`, pp);

    const pv: any[] = [tenantId, addDays(today, -6)];
    const topVariants = await this.ds.query(
      `SELECT si.variant_id AS "variantId", si.product_name AS "productName", si.size, si.color, p.art_type AS "artType", p.art_color AS "artColor",
              SUM(si.qty - si.returned_qty)::int AS qty, SUM(si.line_total)::float AS sales
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN product_variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id
       WHERE s.tenant_id = $1 AND s.status = 'completed' AND s.created_at >= $2 ${storeSql(pv, stores)}
       GROUP BY 1,2,3,4,5,6 ORDER BY qty DESC, sales DESC LIMIT 5`, pv);

    const pl: any[] = [tenantId];
    const invStore = stores ? `AND i.store_id = ANY($${pl.push(stores)})` : '';
    const lowStock = await this.ds.query(
      `SELECT v.id, v.sku, v.size, v.color, p.name AS "productName", COALESCE(SUM(i.quantity),0)::int AS stock, COALESCE(v.min_stock, p.min_stock) AS "minStock"
       FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN inventory i ON i.variant_id = v.id ${invStore}
       WHERE v.tenant_id = $1 AND v.is_active AND p.is_active GROUP BY v.id, p.id
       HAVING COALESCE(SUM(i.quantity),0) <= COALESCE(v.min_stock, p.min_stock)
       ORDER BY stock ASC, p.name LIMIT 6`, pl);
    const pc: any[] = [tenantId];
    const [counts] = await this.ds.query(
      `SELECT COUNT(*) FILTER (WHERE q <= 0)::int AS "outOfStock", COUNT(*) FILTER (WHERE q > 0 AND q <= m)::int AS "lowStock"
       FROM (SELECT COALESCE(SUM(i.quantity),0) q, COALESCE(v.min_stock, p.min_stock) m FROM product_variants v JOIN products p ON p.id = v.product_id
             LEFT JOIN inventory i ON i.variant_id = v.id ${stores ? `AND i.store_id = ANY($${pc.push(stores)})` : ''}
             WHERE v.tenant_id = $1 AND v.is_active AND p.is_active GROUP BY v.id, p.min_stock) x`, pc);

    const ps: any[] = [tenantId];
    const liveCounters = await this.ds.query(
      `SELECT sh.id, sh.counter, sh.opened_at AS "openedAt", u.name AS "userName", st.name AS "storeName",
              COALESCE((SELECT SUM(total) FROM sales WHERE shift_id = sh.id AND status = 'completed'),0)::float AS sales
       FROM cashier_shifts sh JOIN users u ON u.id = sh.user_id JOIN stores st ON st.id = sh.store_id
       WHERE sh.tenant_id = $1 AND sh.status = 'open' ${storeSql(ps, stores, 'sh')} ORDER BY sales DESC`, ps);
    const ph: any[] = [tenantId];
    const [{ held }] = await this.ds.query(`SELECT COUNT(*)::int AS held FROM held_bills s WHERE tenant_id = $1 ${storeSql(ph, stores)}`, ph);

    const pct = (a: number, b: number) => (b ? round2(((a - b) / b) * 100) : null);
    return {
      today: { ...now, avgBill: now.bills ? round2(now.sales / now.bills) : 0, salesChangePct: pct(now.sales, prev.sales), billsChange: now.bills - prev.bills },
      returns, stock: counts, trend, paymentMix, topVariants, lowStock, liveCounters, heldBills: held,
    };
  }

  async sales(user: AuthUser, q: { from?: string; to?: string; storeId?: string }) {
    const tenantId = tenantOf(user);
    const stores = storeScope(user, q.storeId);
    const to = q.to ? addDays(new Date(q.to), 1) : addDays(startOfDay(), 1);
    const from = q.from ? new Date(q.from) : addDays(to, -30);
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);

    const kpis = async (a: Date, b: Date) => {
      const p: any[] = [tenantId, a, b];
      const sf = storeSql(p, stores);
      const [r] = await this.ds.query(
        `SELECT COALESCE(SUM(s.total),0)::float AS sales, COUNT(*)::int AS invoices,
                COALESCE(SUM(s.item_discount + s.bill_discount),0)::float AS discounts,
                COALESCE(SUM(s.cgst + s.sgst + s.igst),0)::float AS tax,
                COALESCE((SELECT SUM(si.taxable_amount - v.purchase_price * si.qty) FROM sale_items si JOIN product_variants v ON v.id = si.variant_id
                          JOIN sales s2 ON s2.id = si.sale_id WHERE s2.tenant_id = $1 AND s2.status = 'completed' AND s2.created_at >= $2 AND s2.created_at < $3
                          ${stores ? 'AND s2.store_id = ANY($4)' : ''}),0)::float AS margin,
                COALESCE(SUM(s.taxable_amount),0)::float AS taxable
         FROM sales s WHERE s.tenant_id = $1 AND s.status = 'completed' AND s.created_at >= $2 AND s.created_at < $3 ${sf}`, p);
      const pr: any[] = [tenantId, a, b];
      const [ret] = await this.ds.query(
        `SELECT COALESCE(SUM(returned_value),0)::float AS value, COUNT(*)::int AS count FROM sale_returns s
         WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3 ${storeSql(pr, stores)}`, pr);
      const net = round2(r.sales - ret.value);
      return {
        netSales: net, grossSales: r.sales, invoices: r.invoices, avgBill: r.invoices ? round2(r.sales / r.invoices) : 0,
        discounts: r.discounts, tax: r.tax, marginPct: r.taxable ? round2((r.margin / r.taxable) * 100) : 0,
        returnValue: ret.value, returnCount: ret.count, returnRatePct: r.sales ? round2((ret.value / r.sales) * 100) : 0,
      };
    };
    const [current, previous] = await Promise.all([kpis(from, to), kpis(prevFrom, from)]);

    const base = (extra = '') => {
      const p: any[] = [tenantId, from, to];
      return { p, where: `s.tenant_id = $1 AND s.status = 'completed' AND s.created_at >= $2 AND s.created_at < $3 ${storeSql(p, stores)} ${extra}` };
    };
    let b = base();
    const byStoreDaily = await this.ds.query(
      `SELECT to_char(date_trunc('day', s.created_at), 'YYYY-MM-DD') AS date, st.name AS store, SUM(s.total)::float AS total
       FROM sales s JOIN stores st ON st.id = s.store_id WHERE ${b.where} GROUP BY 1, 2 ORDER BY 1`, b.p);
    b = base();
    const byCategory = await this.ds.query(
      `SELECT COALESCE(c.name, 'Uncategorised') AS name, SUM(si.line_total)::float AS total, SUM(si.qty)::int AS qty
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN product_variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id
       LEFT JOIN categories c ON c.id = p.category_id WHERE ${b.where} GROUP BY 1 ORDER BY total DESC`, b.p);
    b = base();
    const bySize = await this.ds.query(
      `SELECT si.size, SUM(si.qty)::int AS qty FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE ${b.where} AND si.size IS NOT NULL GROUP BY 1 ORDER BY qty DESC LIMIT 12`, b.p);
    b = base();
    const byColor = await this.ds.query(
      `SELECT si.color, MAX(v.color_hex) AS hex, SUM(si.qty)::int AS qty FROM sale_items si JOIN sales s ON s.id = si.sale_id
       JOIN product_variants v ON v.id = si.variant_id WHERE ${b.where} AND si.color IS NOT NULL GROUP BY 1 ORDER BY qty DESC LIMIT 8`, b.p);
    b = base();
    const byCashier = await this.ds.query(
      `SELECT u.name, COUNT(*)::int AS bills, SUM(s.total)::float AS sales,
              CASE WHEN SUM(s.gross_total) > 0 THEN ROUND((100 * SUM(s.item_discount + s.bill_discount) / SUM(s.gross_total))::numeric, 1) ELSE 0 END::float AS "discountPct"
       FROM sales s JOIN users u ON u.id = s.cashier_id WHERE ${b.where} GROUP BY u.id, u.name ORDER BY sales DESC`, b.p);
    b = base();
    const byPayment = await this.ds.query(
      `SELECT p.method, SUM(p.amount)::float AS amount, COUNT(*)::int AS count FROM sale_payments p JOIN sales s ON s.id = p.sale_id
       WHERE ${b.where} GROUP BY 1 ORDER BY amount DESC`, b.p);
    b = base();
    const topProducts = await this.ds.query(
      `SELECT si.product_name AS name, SUM(si.qty)::int AS qty, SUM(si.line_total)::float AS sales FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE ${b.where} GROUP BY 1 ORDER BY qty DESC LIMIT 10`, b.p);
    const pv: any[] = [tenantId, from, to];
    const cashVariance = await this.ds.query(
      `SELECT u.name, COALESCE(SUM((sh.summary->>'variance')::numeric),0)::float AS variance FROM cashier_shifts sh JOIN users u ON u.id = sh.user_id
       WHERE sh.tenant_id = $1 AND sh.closed_at >= $2 AND sh.closed_at < $3 ${storeSql(pv, stores, 'sh')} GROUP BY u.name`, pv);
    const variance = new Map(cashVariance.map((r: any) => [r.name, r.variance]));

    return {
      range: { from: isoDate(from), to: isoDate(addDays(to, -1)) },
      current, previous, byStoreDaily, byCategory, bySize, byColor, byPayment, topProducts,
      byCashier: byCashier.map((c: any) => ({ ...c, variance: variance.get(c.name) ?? 0 })),
    };
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private svc: ReportsService) {}

  @Get('dashboard') dashboard(@CurrentUser() u: AuthUser, @Query('storeId') storeId?: string) {
    return this.svc.dashboard(u, storeId || undefined);
  }
  @Roles('tenant_admin', 'store_manager', 'accountant')
  @Get('sales') sales(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.svc.sales(u, { ...q, storeId: q.storeId || undefined });
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
