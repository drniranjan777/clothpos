import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { assertStore, AuthUser, MANAGER_ROLES, storeScope, tenantOf } from '../../common/auth';
import { TenantService } from '../../common/tenant.service';
import { paged, parsePage, round2 } from '../../common/util';
import {
  CashierShift, Customer, HeldBill, ProductPrice, ProductVariant, Sale, SaleItem, SalePayment, Store,
} from '../../database/entities';
import { StockService } from '../inventory/stock.service';
import { computeBill } from './billing';
import { CancelSaleDto, CreateSaleDto, HoldBillDto } from './sales.dto';

@Injectable()
export class SalesService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(Sale) private sales: Repository<Sale>,
    @InjectRepository(HeldBill) private held: Repository<HeldBill>,
    private tenants: TenantService,
    private stock: StockService,
    private audit: AuditService,
  ) {}

  /** BRD §30 billing workflow - one atomic transaction. `at` is only used by the seeder to backdate history. */
  async create(user: AuthUser, dto: CreateSaleDto, at?: Date) {
    const tenantId = tenantOf(user);
    assertStore(user, dto.storeId);
    const { tenant } = await this.tenants.assertCanTransact(tenantId);
    const settings = this.tenants.settings(tenant);

    if (dto.clientRef) {
      const dup = await this.sales.findOne({ where: { tenantId, clientRef: dto.clientRef } });
      if (dup) return this.get(user, dup.id); // offline retry - never bill twice
    }

    // offline sale being synced: keep the real sale time; stock is allowed to go negative (the goods already left)
    let when = at;
    if (dto.offline) {
      if (!dto.clientRef) throw new BadRequestException('Offline sales need a clientRef');
      const t = new Date(dto.offline.at);
      if (t.getTime() > Date.now() + 5 * 60_000 || t.getTime() < Date.now() - 7 * 864e5) {
        throw new BadRequestException('Offline sale time is outside the 7-day sync window - enter it manually');
      }
      when = t;
    }
    const priceNotes: { sku: string; charged: number; current: number }[] = [];
    let stockConflict = false;

    const saleId = await this.ds.transaction(async (em) => {
      const store = await em.getRepository(Store).createQueryBuilder('s').setLock('pessimistic_write')
        .where('s.id = :id AND s.tenantId = :t', { id: dto.storeId, t: tenantId }).getOne();
      if (!store) throw new NotFoundException('Store not found');

      const shift = await em.getRepository(CashierShift).findOne({ where: { tenantId, storeId: store.id, userId: user.sub, status: 'open' } });
      if (!shift && user.role === 'cashier' && !when) throw new BadRequestException('Open your shift before billing');

      // ---- items: price & tax always come from the server, never from the client
      const ids = [...new Set(dto.items.map((i) => i.variantId))];
      const variants = await em.getRepository(ProductVariant).find({ where: { id: In(ids), tenantId }, relations: { product: true } });
      const vmap = new Map(variants.map((v) => [v.id, v]));
      for (const i of dto.items) {
        const v = vmap.get(i.variantId);
        if (!v || !v.isActive || !v.product.isActive) throw new BadRequestException('One of the items is no longer available for sale');
      }
      const listPrices = dto.priceListId
        ? new Map((await em.getRepository(ProductPrice).find({ where: { tenantId, priceListId: dto.priceListId, variantId: In(ids) } })).map((p) => [p.variantId, p.price]))
        : new Map<string, number>();

      const customer = await this.resolveCustomer(em, tenantId, dto);
      const interState = !!(customer?.gstin && store.stateCode && customer.gstin.slice(0, 2) !== store.stateCode);
      const bill = computeBill(
        dto.items.map((i) => {
          const v = vmap.get(i.variantId)!;
          const current = listPrices.get(v.id) ?? v.sellingPrice;
          let unitPrice = current;
          if (dto.offline && i.unitPrice !== undefined && i.unitPrice !== current) {
            // honour the price the customer paid offline, but never above MRP
            unitPrice = Math.min(i.unitPrice, v.mrp);
            priceNotes.push({ sku: v.sku, charged: unitPrice, current });
          }
          return { unitPrice, qty: i.qty, mrp: v.mrp, gstRate: v.product.gstRate, itemDiscount: i.discount ?? 0 };
        }),
        dto.billDiscount,
        { interState, roundOff: settings.roundOff },
      );

      // ---- cashier discount limit (BRD §15)
      const discount = bill.itemDiscount + bill.billDiscount;
      const pct = bill.grossTotal > 0 ? (discount / bill.grossTotal) * 100 : 0;
      if (!MANAGER_ROLES.includes(user.role) && pct > settings.cashierDiscountLimitPct + 0.001) {
        throw new ForbiddenException(`Discount of ${pct.toFixed(1)}% exceeds your limit of ${settings.cashierDiscountLimitPct}%. Ask a manager.`);
      }

      // ---- payments
      const paid = round2(dto.payments.reduce((s, p) => s + p.amount, 0));
      if (Math.abs(paid - bill.total) > 0.009) throw new BadRequestException(`Payments (₹${paid}) must equal the bill total (₹${bill.total})`);
      let change = 0;
      for (const p of dto.payments) {
        if (p.method === 'cash') {
          const tendered = p.tendered ?? p.amount;
          if (tendered < p.amount) throw new BadRequestException('Cash tendered is less than the cash amount');
          change = round2(change + tendered - p.amount);
        }
      }
      const creditUsed = round2(dto.payments.filter((p) => p.method === 'store_credit').reduce((s, p) => s + p.amount, 0));
      if (creditUsed > 0) {
        if (!customer) throw new BadRequestException('Select the customer to pay with store credit');
        if (creditUsed > customer.storeCredit + 0.001) throw new BadRequestException(`Store credit balance is only ₹${customer.storeCredit}`);
      }

      // ---- invoice number (store row is locked, so the sequence is gap-free per store)
      store.invoiceSeq += 1;
      await em.getRepository(Store).update(store.id, { invoiceSeq: store.invoiceSeq });
      const year = (when ?? new Date()).getFullYear();
      const invoiceNo = `${store.invoicePrefix}-${year}-${String(store.invoiceSeq).padStart(5, '0')}`;

      const loyaltyEarned = customer ? Math.floor((bill.total / 100) * settings.loyaltyPointsPer100) : 0;
      const stamp = when ? { createdAt: when, updatedAt: when } : {};
      const sale = await em.getRepository(Sale).save(
        em.getRepository(Sale).create({
          tenantId, storeId: store.id, invoiceNo, customerId: customer?.id ?? null, cashierId: user.sub, shiftId: shift?.id ?? null,
          counter: dto.counter ?? shift?.counter ?? 1, status: 'completed',
          mrpTotal: bill.mrpTotal, grossTotal: bill.grossTotal, itemDiscount: bill.itemDiscount, billDiscount: bill.billDiscount,
          taxableAmount: bill.taxableAmount, cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst, roundOff: bill.roundOff, total: bill.total,
          paidAmount: round2(paid + change), changeAmount: change, totalQty: bill.totalQty, itemCount: dto.items.length,
          isInterState: interState, loyaltyEarned, notes: dto.notes, clientRef: dto.clientRef ?? null, offlineRef: dto.offline?.ref ?? null, ...stamp,
          items: dto.items.map((i, idx) => {
            const v = vmap.get(i.variantId)!;
            const l = bill.lines[idx];
            return em.getRepository(SaleItem).create({
              variantId: v.id, productName: v.product.name, sku: v.sku, barcode: v.barcode, size: v.size, color: v.color,
              hsnCode: v.product.hsnCode, qty: l.qty, mrp: l.mrp, unitPrice: l.unitPrice, itemDiscount: l.itemDiscount,
              billDiscount: l.billDiscount, gstRate: l.gstRate, taxableAmount: l.taxableAmount, taxAmount: l.taxAmount, lineTotal: l.lineTotal, ...stamp,
            });
          }),
          payments: dto.payments.map((p) =>
            em.getRepository(SalePayment).create({ method: p.method, amount: p.amount, tendered: p.method === 'cash' ? (p.tendered ?? p.amount) : p.amount, reference: p.reference, ...stamp }),
          ),
        }),
      );

      // ---- stock: lock rows in a fixed order to avoid deadlocks between concurrent counters
      const qtyByVariant = new Map<string, number>();
      for (const i of dto.items) qtyByVariant.set(i.variantId, (qtyByVariant.get(i.variantId) ?? 0) + i.qty);
      for (const vid of [...qtyByVariant.keys()].sort()) {
        const v = vmap.get(vid)!;
        const balance = await this.stock.move(em, {
          tenantId, storeId: store.id, variantId: vid, qty: -qtyByVariant.get(vid)!, type: 'sale',
          referenceType: 'sale', referenceId: sale.id, referenceNo: invoiceNo, allowNegative: settings.allowNegativeStock || !!dto.offline,
          label: `${v.product.name} (${[v.size, v.color].filter(Boolean).join(' / ')})`,
        }, user, when);
        if (balance < 0 && dto.offline) stockConflict = true;
      }

      if (customer) {
        await em.getRepository(Customer).update(customer.id, {
          loyaltyPoints: customer.loyaltyPoints + loyaltyEarned,
          storeCredit: round2(customer.storeCredit - creditUsed),
        });
      }
      if (dto.heldBillId) await em.getRepository(HeldBill).delete({ id: dto.heldBillId, tenantId });
      if (dto.offline) {
        if (stockConflict) await em.getRepository(Sale).update(sale.id, { stockConflict: true });
        await this.audit.log(user, 'sale.offline_sync', 'sale', sale.id, { invoiceNo, offlineRef: dto.offline.ref, soldAt: dto.offline.at, stockConflict, priceNotes }, em);
      }
      if (pct > settings.cashierDiscountLimitPct) {
        await this.audit.log(user, 'sale.large_discount', 'sale', sale.id, { invoiceNo, discount, pct: round2(pct) }, em);
      }
      return sale.id;
    });
    return this.get(user, saleId);
  }

  private async resolveCustomer(em: EntityManager, tenantId: string, dto: CreateSaleDto) {
    const repo = em.getRepository(Customer);
    if (dto.customerId) {
      const c = await repo.findOneBy({ id: dto.customerId, tenantId });
      if (!c) throw new BadRequestException('Customer not found');
      return c;
    }
    if (dto.customer) {
      const existing = await repo.findOneBy({ tenantId, mobile: dto.customer.mobile });
      return existing ?? repo.save(repo.create({ tenantId, name: dto.customer.name.trim(), mobile: dto.customer.mobile }));
    }
    return null;
  }

  async list(user: AuthUser, q: { from?: string; to?: string; storeId?: string; status?: string; search?: string; page?: string; pageSize?: string }) {
    const tenantId = tenantOf(user);
    const { skip, take, page, pageSize } = parsePage(q.page, q.pageSize);
    const stores = storeScope(user, q.storeId);
    const qb = this.sales.createQueryBuilder('s')
      .leftJoinAndSelect('s.customer', 'c')
      .leftJoin('s.cashier', 'u').addSelect(['u.id', 'u.name'])
      .leftJoin('s.store', 'st').addSelect(['st.id', 'st.name', 'st.code'])
      .where('s.tenantId = :tenantId', { tenantId })
      .orderBy('s.createdAt', 'DESC').skip(skip).take(take);
    if (stores) qb.andWhere('s.storeId IN (:...stores)', { stores });
    if (q.from) qb.andWhere('s.createdAt >= :from', { from: q.from });
    if (q.to) qb.andWhere("s.createdAt < (:to::date + interval '1 day')", { to: q.to });
    if (q.status) qb.andWhere('s.status = :status', { status: q.status });
    if (q.search) {
      qb.andWhere(new Brackets((b) => b.where('s.invoiceNo ILIKE :s', { s: `%${q.search}%` }).orWhere('c.mobile LIKE :s').orWhere('c.name ILIKE :s')));
    }
    const [items, total] = await qb.getManyAndCount();
    return paged(items, total, page, pageSize);
  }

  async get(user: AuthUser, id: string) {
    const tenantId = tenantOf(user);
    const sale = await this.sales.createQueryBuilder('s')
      .leftJoinAndSelect('s.items', 'i')
      .leftJoinAndSelect('s.payments', 'p')
      .leftJoinAndSelect('s.customer', 'c')
      .leftJoinAndSelect('s.store', 'st')
      .leftJoin('s.cashier', 'u').addSelect(['u.id', 'u.name'])
      .where('s.id = :id AND s.tenantId = :tenantId', { id, tenantId })
      .orderBy('i.createdAt', 'ASC')
      .getOne();
    if (!sale) throw new NotFoundException('Invoice not found');
    assertStore(user, sale.storeId);
    return sale;
  }

  async getByInvoice(user: AuthUser, invoiceNo: string) {
    const s = await this.sales.findOne({ where: { tenantId: tenantOf(user), invoiceNo: invoiceNo.trim().toUpperCase() } });
    if (!s) throw new NotFoundException(`No invoice ${invoiceNo}`);
    return this.get(user, s.id);
  }

  /** BRD §27: no hard delete - cancel restores stock and is audited. */
  async cancel(user: AuthUser, id: string, dto: CancelSaleDto) {
    if (!MANAGER_ROLES.includes(user.role)) throw new ForbiddenException('Only a manager can cancel invoices');
    const sale = await this.get(user, id);
    if (sale.status === 'cancelled') throw new BadRequestException('Invoice is already cancelled');
    if (sale.items.some((i) => i.returnedQty > 0)) throw new BadRequestException('Invoice has returns - use Returns instead of cancelling');
    await this.ds.transaction(async (em) => {
      await em.getRepository(Sale).update(sale.id, { status: 'cancelled', cancelReason: dto.reason });
      for (const i of [...sale.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
        await this.stock.move(em, {
          tenantId: sale.tenantId, storeId: sale.storeId, variantId: i.variantId, qty: i.qty, type: 'sale_cancel',
          referenceType: 'sale', referenceId: sale.id, referenceNo: sale.invoiceNo, note: dto.reason,
        }, user);
      }
      if (sale.customerId) {
        const credit = round2(sale.payments.filter((p) => p.method === 'store_credit').reduce((s, p) => s + p.amount, 0));
        await em.getRepository(Customer).createQueryBuilder().update()
          .set({ storeCredit: () => `store_credit + ${credit}`, loyaltyPoints: () => `GREATEST(loyalty_points - ${sale.loyaltyEarned}, 0)` })
          .where('id = :id', { id: sale.customerId }).execute();
      }
      await this.audit.log(user, 'sale.cancel', 'sale', sale.id, { invoiceNo: sale.invoiceNo, total: sale.total, reason: dto.reason }, em);
    });
    return this.get(user, id);
  }

  // ---- held bills (BRD §11 hold / resume)
  listHeld(user: AuthUser, storeId: string) {
    assertStore(user, storeId);
    return this.held.find({ where: { tenantId: tenantOf(user), storeId }, order: { createdAt: 'DESC' } });
  }
  hold(user: AuthUser, dto: HoldBillDto) {
    assertStore(user, dto.storeId);
    return this.held.save(this.held.create({ ...dto, tenantId: tenantOf(user), userId: user.sub, userName: user.name }));
  }
  async removeHeld(user: AuthUser, id: string) {
    await this.held.delete({ id, tenantId: tenantOf(user) });
    return { ok: true };
  }
}
