import {
  BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { assertStore, AuthUser, CurrentUser, Roles, storeScope, tenantOf } from '../../common/auth';
import { RequireModule } from '../../common/modules';
import { TenantService } from '../../common/tenant.service';
import { addDays, isoDate, paged, parsePage, round2 } from '../../common/util';
import { ProductVariant, Purchase, PurchaseItem, Store, Supplier, SupplierPayment } from '../../database/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { StockService } from '../inventory/stock.service';
import { computePurchase } from './purchase-calc';

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const BUYER_ROLES = ['tenant_admin', 'store_manager', 'inventory_user'] as const;
const PAY_ROLES = ['tenant_admin', 'store_manager', 'accountant'] as const;

class SupplierDto {
  @IsString() @Length(2, 80) name: string;
  @IsOptional() @IsString() @MaxLength(60) contactName?: string;
  @IsOptional() @Matches(/^\d{10}$/, { message: 'mobile must be 10 digits' }) mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @Matches(GSTIN, { message: 'GSTIN format is invalid' }) gstin?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @Matches(/^\d{2}$/) stateCode?: string;
  @IsOptional() @IsInt() @Min(0) paymentTermsDays?: number;
  @IsOptional() @IsNumber() @Min(0) openingBalance?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateSupplierDto extends PartialType(SupplierDto) {}

class PurchaseItemDto {
  @IsUUID() variantId: string;
  @IsInt() @Min(1) qty: number;
  @IsNumber() @Min(0) unitCost: number;
  @IsOptional() @IsNumber() @IsIn([0, 3, 5, 12, 18, 28]) gstRate?: number;
}
class PurchaseDto {
  @IsUUID() storeId: string;
  @IsUUID() supplierId: string;
  @IsOptional() @IsString() @MaxLength(40) supplierInvoiceNo?: string;
  @IsOptional() @IsDateString() supplierInvoiceDate?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PurchaseItemDto) items: PurchaseItemDto[];
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsNumber() @Min(0) otherCharges?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  /** receive into stock immediately instead of saving a draft */
  @IsOptional() @IsBoolean() receive?: boolean;
  /** on receipt, update each variant's purchase price to this cost (default true) */
  @IsOptional() @IsBoolean() updateCost?: boolean;
}
class ReceiveDto {
  @IsOptional() @IsBoolean() updateCost?: boolean;
}
class CancelDto {
  @IsString() @Length(3, 200) reason: string;
}
class PaymentDto {
  @IsNumber() @Min(1) amount: number;
  @IsIn(['cash', 'upi', 'bank', 'cheque', 'card']) method: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @IsDateString() paidOn?: string;
  /** pay a specific bill; otherwise the oldest unpaid bills are settled first */
  @IsOptional() @IsUUID() purchaseId?: string;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

@Injectable()
export class PurchasesService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(Supplier) private suppliers: Repository<Supplier>,
    @InjectRepository(Purchase) private purchases: Repository<Purchase>,
    private tenants: TenantService,
    private stock: StockService,
    private audit: AuditService,
  ) {}

  // ------------------------------------------------------------ suppliers
  async listSuppliers(user: AuthUser, q: { search?: string; status?: string }) {
    const tenantId = tenantOf(user);
    const params: any[] = [tenantId];
    let where = 's.tenant_id = $1';
    if (q.search) where += ` AND (s.name ILIKE $${params.push(`%${q.search}%`)} OR s.mobile LIKE $${params.length} OR s.gstin ILIKE $${params.length})`;
    if (q.status !== 'all') where += ' AND s.is_active';
    return this.ds.query(
      `SELECT s.id, s.name, s.contact_name AS "contactName", s.mobile, s.gstin, s.city, s.is_active AS "isActive", s.payment_terms_days AS "paymentTermsDays",
              COALESCE(p.billed,0)::float AS billed, COALESCE(p.bills,0)::int AS bills, p.last_purchase AS "lastPurchase",
              (s.opening_balance + COALESCE(p.billed,0) - COALESCE(pay.paid,0))::float AS outstanding,
              COALESCE(p.overdue,0)::float AS overdue
       FROM suppliers s
       LEFT JOIN (SELECT supplier_id, SUM(total) billed, COUNT(*) bills, MAX(created_at) last_purchase,
                         SUM(total - paid_amount) FILTER (WHERE due_date < CURRENT_DATE) overdue
                  FROM purchases WHERE status = 'received' GROUP BY supplier_id) p ON p.supplier_id = s.id
       LEFT JOIN (SELECT supplier_id, SUM(amount) paid FROM supplier_payments GROUP BY supplier_id) pay ON pay.supplier_id = s.id
       WHERE ${where} ORDER BY outstanding DESC, s.name`, params);
  }

  async getSupplier(user: AuthUser, id: string) {
    const tenantId = tenantOf(user);
    const s = await this.suppliers.findOneBy({ id, tenantId });
    if (!s) throw new NotFoundException('Supplier not found');
    const [row] = (await this.listSuppliers(user, { status: 'all' })).filter((r: any) => r.id === id);
    const purchases = await this.purchases.find({ where: { tenantId, supplierId: id }, order: { createdAt: 'DESC' }, take: 20 });
    const payments = await this.ds.getRepository(SupplierPayment).find({ where: { tenantId, supplierId: id }, order: { paidOn: 'DESC', createdAt: 'DESC' }, take: 20 });
    return { ...s, ...row, purchases, payments };
  }

  async createSupplier(user: AuthUser, dto: SupplierDto) {
    const tenantId = tenantOf(user);
    const s = await this.suppliers.save(this.suppliers.create({ ...dto, tenantId, stateCode: dto.stateCode ?? dto.gstin?.slice(0, 2) }));
    await this.audit.log(user, 'supplier.create', 'supplier', s.id, { name: s.name });
    return s;
  }

  async updateSupplier(user: AuthUser, id: string, dto: UpdateSupplierDto) {
    const tenantId = tenantOf(user);
    const s = await this.suppliers.findOneBy({ id, tenantId });
    if (!s) throw new NotFoundException('Supplier not found');
    await this.suppliers.update(id, { ...dto, ...(dto.gstin && !dto.stateCode ? { stateCode: dto.gstin.slice(0, 2) } : {}) });
    return this.getSupplier(user, id);
  }

  // ------------------------------------------------------------ purchases
  async list(user: AuthUser, q: { storeId?: string; supplierId?: string; status?: string; search?: string; payment?: string; page?: string; pageSize?: string }) {
    const tenantId = tenantOf(user);
    const stores = storeScope(user, q.storeId);
    const { skip, take, page, pageSize } = parsePage(q.page, q.pageSize);
    const qb = this.purchases.createQueryBuilder('p')
      .leftJoin('p.supplier', 's').addSelect(['s.id', 's.name'])
      .leftJoin('p.store', 'st').addSelect(['st.id', 'st.name', 'st.code'])
      .where('p.tenantId = :tenantId', { tenantId }).orderBy('p.createdAt', 'DESC').skip(skip).take(take);
    if (stores) qb.andWhere('p.storeId IN (:...stores)', { stores });
    if (q.supplierId) qb.andWhere('p.supplierId = :sid', { sid: q.supplierId });
    if (q.status) qb.andWhere('p.status = :st', { st: q.status });
    if (q.payment === 'unpaid') qb.andWhere("p.status = 'received' AND p.paidAmount < p.total");
    if (q.search) qb.andWhere('(p.purchaseNo ILIKE :s OR p.supplierInvoiceNo ILIKE :s OR s.name ILIKE :s)', { s: `%${q.search}%` });
    const [items, total] = await qb.getManyAndCount();
    return paged(items, total, page, pageSize);
  }

  async get(user: AuthUser, id: string) {
    const p = await this.purchases.findOne({ where: { id, tenantId: tenantOf(user) }, relations: { items: true, supplier: true, store: true } });
    if (!p) throw new NotFoundException('Purchase not found');
    assertStore(user, p.storeId);
    const payments = await this.ds.getRepository(SupplierPayment).find({ where: { purchaseId: id }, order: { paidOn: 'ASC' } });
    p.items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return { ...p, payments };
  }

  async create(user: AuthUser, dto: PurchaseDto) {
    const tenantId = tenantOf(user);
    assertStore(user, dto.storeId);
    const id = await this.ds.transaction(async (em) => {
      const store = await em.getRepository(Store).createQueryBuilder('s').setLock('pessimistic_write').where('s.id = :id AND s.tenantId = :t', { id: dto.storeId, t: tenantId }).getOne();
      if (!store) throw new NotFoundException('Store not found');
      store.purchaseSeq += 1;
      await em.getRepository(Store).update(store.id, { purchaseSeq: store.purchaseSeq });
      const purchase = em.getRepository(Purchase).create({
        tenantId, storeId: store.id, purchaseNo: `PO-${store.code}-${new Date().getFullYear()}-${String(store.purchaseSeq).padStart(4, '0')}`,
        status: 'draft', createdById: user.sub, createdByName: user.name,
      });
      await this.fill(em, tenantId, store, purchase, dto);
      const saved = await em.getRepository(Purchase).save(purchase);
      await this.audit.log(user, 'purchase.create', 'purchase', saved.id, { purchaseNo: saved.purchaseNo, total: saved.total }, em);
      if (dto.receive) await this.doReceive(em, user, saved.id, dto.updateCost !== false);
      return saved.id;
    });
    return this.get(user, id);
  }

  async update(user: AuthUser, id: string, dto: PurchaseDto) {
    const tenantId = tenantOf(user);
    await this.ds.transaction(async (em) => {
      const p = await em.getRepository(Purchase).findOne({ where: { id, tenantId }, relations: { items: true } });
      if (!p) throw new NotFoundException('Purchase not found');
      if (p.status !== 'draft') throw new BadRequestException('Only draft purchases can be edited');
      assertStore(user, p.storeId);
      const store = await em.getRepository(Store).findOneByOrFail({ id: p.storeId });
      await em.getRepository(PurchaseItem).delete({ purchaseId: id });
      await this.fill(em, tenantId, store, p, { ...dto, storeId: p.storeId });
      await em.getRepository(Purchase).save(p);
      if (dto.receive) await this.doReceive(em, user, id, dto.updateCost !== false);
    });
    return this.get(user, id);
  }

  /** Validates lines, snapshots variant details and computes totals onto the purchase entity. */
  private async fill(em: EntityManager, tenantId: string, store: Store, p: Purchase, dto: PurchaseDto) {
    const supplier = await em.getRepository(Supplier).findOneBy({ id: dto.supplierId, tenantId });
    if (!supplier) throw new BadRequestException('Supplier not found');
    const variants = await em.getRepository(ProductVariant).find({ where: { tenantId, id: In(dto.items.map((i) => i.variantId)) }, relations: { product: true } });
    const vmap = new Map(variants.map((v) => [v.id, v]));
    if (dto.items.some((i) => !vmap.has(i.variantId))) throw new BadRequestException('Unknown item on the purchase');
    const interState = !!(supplier.stateCode && store.stateCode && supplier.stateCode !== store.stateCode);
    const calc = computePurchase(
      dto.items.map((i) => ({ qty: i.qty, unitCost: i.unitCost, gstRate: i.gstRate ?? vmap.get(i.variantId)!.product.gstRate })),
      { discount: dto.discount, otherCharges: dto.otherCharges, interState },
    );
    const invDate = dto.supplierInvoiceDate ?? isoDate(new Date());
    Object.assign(p, {
      supplierId: supplier.id, supplierInvoiceNo: dto.supplierInvoiceNo, supplierInvoiceDate: dto.supplierInvoiceDate ?? null,
      dueDate: isoDate(addDays(new Date(invDate), supplier.paymentTermsDays)), isInterState: interState,
      taxableAmount: calc.taxableAmount, cgst: calc.cgst, sgst: calc.sgst, igst: calc.igst, otherCharges: calc.otherCharges,
      discount: calc.discount, roundOff: calc.roundOff, total: calc.total, totalQty: calc.totalQty, notes: dto.notes,
      items: dto.items.map((i, k) => {
        const v = vmap.get(i.variantId)!;
        const l = calc.lines[k];
        return em.getRepository(PurchaseItem).create({
          variantId: v.id, productName: v.product.name, sku: v.sku, size: v.size, color: v.color, qty: i.qty, unitCost: i.unitCost,
          gstRate: l.gstRate, taxableAmount: l.taxableAmount, taxAmount: l.taxAmount, lineTotal: l.lineTotal, purchaseId: p.id,
        });
      }),
    });
  }

  async receive(user: AuthUser, id: string, dto: ReceiveDto) {
    await this.ds.transaction((em) => this.doReceive(em, user, id, dto.updateCost !== false));
    return this.get(user, id);
  }

  private async doReceive(em: EntityManager, user: AuthUser, id: string, updateCost: boolean) {
    const p = await em.getRepository(Purchase).createQueryBuilder('p').setLock('pessimistic_write').where('p.id = :id AND p.tenantId = :t', { id, t: tenantOf(user) }).getOne();
    if (!p) throw new NotFoundException('Purchase not found');
    assertStore(user, p.storeId);
    if (p.status !== 'draft') throw new BadRequestException(`Purchase is already ${p.status}`);
    const items = await em.getRepository(PurchaseItem).find({ where: { purchaseId: id } });
    const byVariant = new Map<string, { qty: number; cost: number }>();
    for (const i of items) {
      const cur = byVariant.get(i.variantId) ?? { qty: 0, cost: i.unitCost };
      byVariant.set(i.variantId, { qty: cur.qty + i.qty, cost: i.unitCost });
    }
    for (const vid of [...byVariant.keys()].sort()) {
      const { qty, cost } = byVariant.get(vid)!;
      await this.stock.move(em, { tenantId: p.tenantId, storeId: p.storeId, variantId: vid, qty, type: 'purchase', referenceType: 'purchase', referenceId: p.id, referenceNo: p.purchaseNo }, user);
      if (updateCost) await em.getRepository(ProductVariant).update(vid, { purchasePrice: cost });
    }
    await em.getRepository(Purchase).update(p.id, { status: 'received', receivedAt: new Date(), receivedByName: user.name });
    await this.audit.log(user, 'purchase.receive', 'purchase', p.id, { purchaseNo: p.purchaseNo, units: p.totalQty, total: p.total, updateCost }, em);
  }

  async cancel(user: AuthUser, id: string, dto: CancelDto) {
    const p = await this.purchases.findOneBy({ id, tenantId: tenantOf(user) });
    if (!p) throw new NotFoundException('Purchase not found');
    assertStore(user, p.storeId);
    if (p.status !== 'draft') throw new BadRequestException('Received purchases cannot be cancelled - record a stock adjustment or supplier return instead');
    await this.purchases.update(id, { status: 'cancelled', cancelReason: dto.reason });
    await this.audit.log(user, 'purchase.cancel', 'purchase', id, { purchaseNo: p.purchaseNo, reason: dto.reason });
    return this.get(user, id);
  }

  // ------------------------------------------------------------ supplier payments
  async pay(user: AuthUser, supplierId: string, dto: PaymentDto) {
    const tenantId = tenantOf(user);
    await this.ds.transaction(async (em) => {
      const supplier = await em.getRepository(Supplier).findOneBy({ id: supplierId, tenantId });
      if (!supplier) throw new NotFoundException('Supplier not found');
      const unpaid = await em.getRepository(Purchase).createQueryBuilder('p').setLock('pessimistic_write')
        .where("p.tenantId = :t AND p.supplierId = :s AND p.status = 'received' AND p.paidAmount < p.total", { t: tenantId, s: supplierId })
        .andWhere(dto.purchaseId ? 'p.id = :pid' : '1=1', { pid: dto.purchaseId })
        .orderBy('p.createdAt', 'ASC').getMany();
      if (dto.purchaseId && !unpaid.length) throw new BadRequestException('That bill is already fully paid');
      // allocate oldest-first; anything left over reduces the opening balance / is an advance
      let left = dto.amount;
      const allocations: { purchaseId: string; amount: number }[] = [];
      for (const p of unpaid) {
        if (left <= 0) break;
        const take = round2(Math.min(left, p.total - p.paidAmount));
        await em.getRepository(Purchase).update(p.id, { paidAmount: round2(p.paidAmount + take) });
        allocations.push({ purchaseId: p.id, amount: take });
        left = round2(left - take);
      }
      if (left > 0) allocations.push({ purchaseId: null as unknown as string, amount: left });
      const paidOn = dto.paidOn ?? isoDate(new Date());
      for (const a of allocations) {
        await em.getRepository(SupplierPayment).insert({
          tenantId, supplierId, purchaseId: a.purchaseId ?? null, amount: a.amount, method: dto.method, reference: dto.reference,
          paidOn, notes: dto.notes, userId: user.sub, userName: user.name,
        });
      }
      await this.audit.log(user, 'supplier.payment', 'supplier', supplierId, { amount: dto.amount, method: dto.method, allocations }, em);
    });
    return this.getSupplier(user, supplierId);
  }
}

@RequireModule('purchases')
@Controller()
export class PurchasesController {
  constructor(private svc: PurchasesService) {}

  @Get('suppliers') suppliers(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.svc.listSuppliers(u, q);
  }
  @Get('suppliers/:id') supplier(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getSupplier(u, id);
  }
  @Roles(...BUYER_ROLES) @Post('suppliers') createSupplier(@CurrentUser() u: AuthUser, @Body() dto: SupplierDto) {
    return this.svc.createSupplier(u, dto);
  }
  @Roles(...BUYER_ROLES) @Patch('suppliers/:id') updateSupplier(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.svc.updateSupplier(u, id, dto);
  }
  @Roles(...PAY_ROLES) @Post('suppliers/:id/payments') pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentDto) {
    return this.svc.pay(u, id, dto);
  }
  @Get('purchases') list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.svc.list(u, q);
  }
  @Get('purchases/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }
  @Roles(...BUYER_ROLES) @Post('purchases') create(@CurrentUser() u: AuthUser, @Body() dto: PurchaseDto) {
    return this.svc.create(u, dto);
  }
  @Roles(...BUYER_ROLES) @Patch('purchases/:id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PurchaseDto) {
    return this.svc.update(u, id, dto);
  }
  @Roles(...BUYER_ROLES) @Post('purchases/:id/receive') receive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveDto) {
    return this.svc.receive(u, id, dto);
  }
  @Roles(...BUYER_ROLES) @Post('purchases/:id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.svc.cancel(u, id, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Supplier, Purchase, PurchaseItem, SupplierPayment]), InventoryModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}
