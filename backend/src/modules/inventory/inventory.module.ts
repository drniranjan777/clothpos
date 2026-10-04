import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Post, Query } from '@nestjs/common';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min, ValidateNested } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { assertStore, AuthUser, CurrentUser, Roles, storeScope, tenantOf } from '../../common/auth';
import { paged, parsePage } from '../../common/util';
import { Inventory, InventoryTransaction, ProductVariant, Store } from '../../database/entities';
import { StockService } from './stock.service';

class AdjustmentDto {
  @IsUUID() storeId: string;
  @IsUUID() variantId: string;
  @IsIn(['damage', 'found', 'recount']) type: 'damage' | 'found' | 'recount';
  /** damage/found: units removed/added; recount: the physically counted quantity */
  @IsInt() @Min(0) qty: number;
  @IsString() @Length(3, 200) reason: string;
}
class ReceiveItemDto {
  @IsUUID() variantId: string;
  @IsInt() @Min(1) qty: number;
}
class ReceiveDto {
  @IsUUID() storeId: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReceiveItemDto) items: ReceiveItemDto[];
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

const STOCK_ROLES = ['tenant_admin', 'store_manager', 'inventory_user'] as const;

@Injectable()
export class InventoryService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(Inventory) private inv: Repository<Inventory>,
    @InjectRepository(InventoryTransaction) private txns: Repository<InventoryTransaction>,
    @InjectRepository(ProductVariant) private variants: Repository<ProductVariant>,
    private stock: StockService,
    private audit: AuditService,
  ) {}

  async summary(user: AuthUser, storeId?: string) {
    const tenantId = tenantOf(user);
    const stores = storeScope(user, storeId);
    const params: any[] = [tenantId];
    let storeFilter = '';
    if (stores) {
      params.push(stores);
      storeFilter = 'AND i.store_id = ANY($2)';
    }
    const [row] = await this.ds.query(
      `WITH s AS (
         SELECT v.id, COALESCE(SUM(i.quantity),0)::int AS qty, COALESCE(v.min_stock, p.min_stock) AS min_stock, v.purchase_price, v.mrp
         FROM product_variants v JOIN products p ON p.id = v.product_id
         LEFT JOIN inventory i ON i.variant_id = v.id ${storeFilter}
         WHERE v.tenant_id = $1 AND v.is_active AND p.is_active
         GROUP BY v.id, p.min_stock)
       SELECT COUNT(*)::int AS skus,
              COALESCE(SUM(GREATEST(qty,0) * purchase_price),0)::float AS "costValue",
              COALESCE(SUM(GREATEST(qty,0) * mrp),0)::float AS "mrpValue",
              COALESCE(SUM(GREATEST(qty,0)),0)::int AS units,
              COUNT(*) FILTER (WHERE qty > 0 AND qty <= min_stock)::int AS "lowStock",
              COUNT(*) FILTER (WHERE qty <= 0)::int AS "outOfStock"
       FROM s`,
      params,
    );
    const products = await this.ds.query(`SELECT COUNT(*)::int AS n FROM products WHERE tenant_id = $1 AND is_active`, [tenantId]);
    return { ...row, products: products[0].n };
  }

  /** Current stock per variant (BRD §14 low / out-of-stock alerts). */
  async stockList(user: AuthUser, q: { storeId?: string; search?: string; filter?: 'low' | 'out' | 'all'; page?: string; pageSize?: string }) {
    const tenantId = tenantOf(user);
    const stores = storeScope(user, q.storeId);
    const { skip, take, page, pageSize } = parsePage(q.page, q.pageSize);
    const params: any[] = [tenantId];
    const storeFilter = stores ? `AND i.store_id = ANY($${params.push(stores)})` : '';
    let where = 'v.tenant_id = $1 AND v.is_active AND p.is_active';
    if (q.search) where += ` AND (p.name ILIKE $${params.push(`%${q.search}%`)} OR v.sku ILIKE $${params.length} OR v.barcode = $${params.push(q.search.trim())})`;
    const having = q.filter === 'out' ? 'HAVING COALESCE(SUM(i.quantity),0) <= 0'
      : q.filter === 'low' ? 'HAVING COALESCE(SUM(i.quantity),0) <= COALESCE(v.min_stock, p.min_stock)' : '';
    const base = `FROM product_variants v JOIN products p ON p.id = v.product_id
                  LEFT JOIN inventory i ON i.variant_id = v.id ${storeFilter}
                  WHERE ${where} GROUP BY v.id, p.id ${having}`;
    const [{ n }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM (SELECT v.id ${base}) x`, params);
    const rows = await this.ds.query(
      `SELECT v.id, v.sku, v.barcode, v.size, v.color, v.color_hex AS "colorHex", v.mrp::float, v.selling_price::float AS "sellingPrice",
              v.purchase_price::float AS "purchasePrice", p.gst_rate::float AS "gstRate", p.id AS "productId", p.name AS "productName", p.art_type AS "artType", p.art_color AS "artColor",
              COALESCE(v.min_stock, p.min_stock) AS "minStock", COALESCE(SUM(i.quantity),0)::int AS stock
       ${base} ORDER BY stock ASC, p.name LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paged(rows, n, page, pageSize);
  }

  async ledger(user: AuthUser, q: { storeId?: string; variantId?: string; type?: string; search?: string; page?: string; pageSize?: string }) {
    const tenantId = tenantOf(user);
    const stores = storeScope(user, q.storeId);
    const { skip, take, page, pageSize } = parsePage(q.page, q.pageSize);
    const qb = this.txns.createQueryBuilder('t')
      .innerJoinAndSelect('t.variant', 'v').innerJoinAndSelect('v.product', 'p')
      .where('t.tenantId = :tenantId', { tenantId })
      .orderBy('t.createdAt', 'DESC').skip(skip).take(take);
    if (stores) qb.andWhere('t.storeId IN (:...stores)', { stores });
    if (q.variantId) qb.andWhere('t.variantId = :vid', { vid: q.variantId });
    if (q.type) qb.andWhere('t.type = :type', { type: q.type });
    if (q.search) qb.andWhere('(v.sku ILIKE :s OR v.barcode = :e OR p.name ILIKE :s OR t.referenceNo ILIKE :s)', { s: `%${q.search}%`, e: q.search.trim() });
    const [items, total] = await qb.getManyAndCount();
    return paged(items.map((t) => ({
      id: t.id, createdAt: t.createdAt, type: t.type, quantity: t.quantity, balanceAfter: t.balanceAfter, referenceNo: t.referenceNo,
      referenceType: t.referenceType, referenceId: t.referenceId, note: t.note, userName: t.userName, storeId: t.storeId,
      variant: { id: t.variant.id, sku: t.variant.sku, size: t.variant.size, color: t.variant.color },
      product: { id: t.variant.product.id, name: t.variant.product.name, artType: t.variant.product.artType, artColor: t.variant.product.artColor },
    })), total, page, pageSize);
  }

  async lookup(user: AuthUser, code: string, storeId: string) {
    const tenantId = tenantOf(user);
    assertStore(user, storeId);
    const v = await this.variants.createQueryBuilder('v').innerJoinAndSelect('v.product', 'p')
      .where('v.tenantId = :tenantId AND (v.barcode = :c OR UPPER(v.sku) = UPPER(:c))', { tenantId, c: code.trim() }).getOne();
    if (!v) throw new NotFoundException(`No item found for "${code}"`);
    const row = await this.inv.findOneBy({ storeId, variantId: v.id });
    return { variant: { id: v.id, sku: v.sku, barcode: v.barcode, size: v.size, color: v.color }, product: { id: v.product.id, name: v.product.name, artType: v.product.artType, artColor: v.product.artColor }, stock: row?.quantity ?? 0 };
  }

  async adjust(user: AuthUser, dto: AdjustmentDto) {
    const tenantId = tenantOf(user);
    assertStore(user, dto.storeId);
    const v = await this.variants.findOne({ where: { id: dto.variantId, tenantId }, relations: { product: true } });
    if (!v) throw new NotFoundException('Item not found');
    return this.ds.transaction(async (em) => {
      const store = await em.getRepository(Store).createQueryBuilder('s').setLock('pessimistic_write').where('s.id = :id AND s.tenantId = :t', { id: dto.storeId, t: tenantId }).getOneOrFail();
      const current = (await em.getRepository(Inventory).findOneBy({ storeId: dto.storeId, variantId: v.id }))?.quantity ?? 0;
      const delta = dto.type === 'damage' ? -dto.qty : dto.type === 'found' ? dto.qty : dto.qty - current;
      if (delta === 0) throw new BadRequestException('Counted quantity equals current stock - nothing to adjust');
      store.adjustmentSeq += 1;
      await em.getRepository(Store).update(store.id, { adjustmentSeq: store.adjustmentSeq });
      const refNo = `ADJ-${store.code}-${String(store.adjustmentSeq).padStart(4, '0')}`;
      const balance = await this.stock.move(em, {
        tenantId, storeId: dto.storeId, variantId: v.id, qty: delta, type: `adjustment_${dto.type}`,
        referenceType: 'adjustment', referenceNo: refNo, note: dto.reason, label: v.product.name,
      }, user);
      await this.audit.log(user, 'inventory.adjust', 'product_variant', v.id, { sku: v.sku, type: dto.type, delta, balance, reason: dto.reason, refNo }, em);
      return { referenceNo: refNo, delta, balance };
    });
  }

  async receive(user: AuthUser, dto: ReceiveDto) {
    const tenantId = tenantOf(user);
    assertStore(user, dto.storeId);
    return this.ds.transaction(async (em) => {
      const result: { variantId: string; balance: number }[] = [];
      for (const i of [...dto.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
        const v = await em.getRepository(ProductVariant).findOneBy({ id: i.variantId, tenantId });
        if (!v) throw new BadRequestException('Unknown item in receipt');
        const balance = await this.stock.move(em, {
          tenantId, storeId: dto.storeId, variantId: v.id, qty: i.qty, type: 'purchase',
          referenceType: 'receipt', referenceNo: dto.reference, note: dto.note,
        }, user);
        result.push({ variantId: v.id, balance });
      }
      await this.audit.log(user, 'inventory.receive', 'store', dto.storeId, { reference: dto.reference, lines: dto.items.length, units: dto.items.reduce((s, i) => s + i.qty, 0) }, em);
      return result;
    });
  }
}

@Controller('inventory')
export class InventoryController {
  constructor(private svc: InventoryService) {}

  @Get('summary') summary(@CurrentUser() u: AuthUser, @Query('storeId') storeId?: string) {
    return this.svc.summary(u, storeId || undefined);
  }
  @Get('stock') stock(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.svc.stockList(u, q);
  }
  @Get('ledger') ledger(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.svc.ledger(u, q);
  }
  @Get('lookup') lookup(@CurrentUser() u: AuthUser, @Query('code') code: string, @Query('storeId') storeId: string) {
    return this.svc.lookup(u, code, storeId);
  }
  @Roles(...STOCK_ROLES) @Post('adjustments') adjust(@CurrentUser() u: AuthUser, @Body() dto: AdjustmentDto) {
    return this.svc.adjust(u, dto);
  }
  @Roles(...STOCK_ROLES) @Post('receive') receive(@CurrentUser() u: AuthUser, @Body() dto: ReceiveDto) {
    return this.svc.receive(u, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Inventory, InventoryTransaction, ProductVariant, Store])],
  controllers: [InventoryController],
  providers: [StockService, InventoryService],
  exports: [StockService],
})
export class InventoryModule {}
