import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { assertStore, AuthUser, CurrentUser, MANAGER_ROLES, storeScope, tenantOf } from '../../common/auth';
import { TenantService } from '../../common/tenant.service';
import { paged, parsePage, round2 } from '../../common/util';
import { Customer, ProductVariant, Sale, SaleItem, SaleReturn, SaleReturnItem, Store } from '../../database/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { StockService } from '../inventory/stock.service';

class ReturnItemDto {
  @IsUUID() saleItemId: string;
  @IsInt() @Min(1) qty: number;
  @IsOptional() @IsString() @MaxLength(80) reason?: string;
  /** set to exchange this item for another size/colour */
  @IsOptional() @IsUUID() exchangeVariantId?: string;
}
class CollectDto {
  @IsIn(['cash', 'upi', 'card']) method: 'cash' | 'upi' | 'card';
  @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
}
class CreateReturnDto {
  @IsUUID() saleId: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReturnItemDto) items: ReturnItemDto[];
  @IsIn(['cash', 'original', 'store_credit']) refundMethod: 'cash' | 'original' | 'store_credit';
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  /** when the exchange items cost more than the returned items */
  @IsOptional() @ValidateNested() @Type(() => CollectDto) collect?: CollectDto;
}

@Injectable()
export class ReturnsService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(SaleReturn) private returns: Repository<SaleReturn>,
    private tenants: TenantService,
    private stock: StockService,
    private audit: AuditService,
  ) {}

  async create(user: AuthUser, dto: CreateReturnDto) {
    const tenantId = tenantOf(user);
    const { tenant } = await this.tenants.assertCanTransact(tenantId);
    const settings = this.tenants.settings(tenant);
    const isManager = MANAGER_ROLES.includes(user.role);

    const id = await this.ds.transaction(async (em) => {
      const sale = await em.getRepository(Sale).findOne({ where: { id: dto.saleId, tenantId }, relations: { items: true } });
      if (!sale) throw new NotFoundException('Invoice not found');
      assertStore(user, sale.storeId);
      if (sale.status !== 'completed') throw new BadRequestException('Cancelled invoices cannot be returned');
      const ageDays = (Date.now() - sale.createdAt.getTime()) / 864e5;
      if (ageDays > settings.returnWindowDays && !isManager) {
        throw new ForbiddenException(`Invoice is older than the ${settings.returnWindowDays}-day return window - manager approval required`);
      }

      // lock the sale lines so two counters cannot return the same piece twice
      const lines = await em.getRepository(SaleItem).createQueryBuilder('i').setLock('pessimistic_write').where('i.saleId = :id', { id: sale.id }).getMany();
      const exchangeIds = dto.items.map((i) => i.exchangeVariantId).filter(Boolean) as string[];
      const exVariants = exchangeIds.length
        ? new Map((await em.getRepository(ProductVariant).find({ where: { id: In(exchangeIds), tenantId }, relations: { product: true } })).map((v) => [v.id, v]))
        : new Map<string, ProductVariant>();

      let returnedValue = 0, exchangeValue = 0, taxReversed = 0;
      const items: Partial<SaleReturnItem>[] = [];
      for (const r of dto.items) {
        const line = lines.find((l) => l.id === r.saleItemId);
        if (!line) throw new BadRequestException('Item does not belong to this invoice');
        if (r.qty > line.qty - line.returnedQty) throw new BadRequestException(`${line.productName}: only ${line.qty - line.returnedQty} can be returned`);
        // refund what the customer actually paid for the piece (after item + bill discounts)
        const amount = round2((line.lineTotal * r.qty) / line.qty);
        const tax = round2((line.taxAmount * r.qty) / line.qty);
        returnedValue += amount;
        taxReversed += tax;
        let ex: ProductVariant | undefined;
        if (r.exchangeVariantId) {
          ex = exVariants.get(r.exchangeVariantId);
          if (!ex || !ex.isActive) throw new BadRequestException('Exchange item not found');
          exchangeValue += ex.sellingPrice * r.qty;
        }
        items.push({ saleItemId: line.id, variantId: line.variantId, productName: line.productName, sku: line.sku, qty: r.qty, amount, taxAmount: tax, reason: r.reason, exchangeVariantId: ex?.id ?? null, exchangeSku: ex?.sku });
        line.returnedQty += r.qty;
      }
      returnedValue = round2(returnedValue);
      exchangeValue = round2(exchangeValue);
      const net = round2(returnedValue - exchangeValue);

      const customer = sale.customerId ? await em.getRepository(Customer).findOneBy({ id: sale.customerId }) : null;
      if (net > 0) {
        if (dto.refundMethod === 'store_credit' && !customer) throw new BadRequestException('Store credit needs a customer on the invoice');
        if (dto.refundMethod !== 'store_credit' && !isManager) throw new ForbiddenException('Cash / original-mode refunds need a manager. Offer store credit or ask a manager.');
      }
      if (net < 0 && (!dto.collect || Math.abs(dto.collect.amount + net) > 0.009)) {
        throw new BadRequestException(`Collect ₹${-net} from the customer for the price difference`);
      }

      const store = await em.getRepository(Store).createQueryBuilder('s').setLock('pessimistic_write').where('s.id = :id', { id: sale.storeId }).getOneOrFail();
      store.returnSeq += 1;
      await em.getRepository(Store).update(store.id, { returnSeq: store.returnSeq });
      const returnNo = `RT-${store.code}-${new Date().getFullYear()}-${String(store.returnSeq).padStart(5, '0')}`;
      const type = exchangeValue === 0 ? 'refund' : items.every((i) => i.exchangeVariantId) ? 'exchange' : 'mixed';

      const saved = await em.getRepository(SaleReturn).save(em.getRepository(SaleReturn).create({
        tenantId, storeId: sale.storeId, returnNo, saleId: sale.id, customerId: sale.customerId, type,
        refundMethod: net > 0 ? dto.refundMethod : undefined, returnedValue, exchangeValue, netAmount: net, taxReversed: round2(taxReversed),
        collectMethod: net < 0 ? dto.collect!.method : undefined, collectedAmount: net < 0 ? -net : 0,
        reason: dto.reason, userId: user.sub, userName: user.name,
        items: items.map((i) => em.getRepository(SaleReturnItem).create(i)),
      }));

      for (const l of lines) await em.getRepository(SaleItem).update(l.id, { returnedQty: l.returnedQty });
      const moves = [
        ...items.map((i) => ({ variantId: i.variantId!, qty: i.qty!, type: 'return' as const, label: i.productName })),
        ...items.filter((i) => i.exchangeVariantId).map((i) => ({ variantId: i.exchangeVariantId!, qty: -i.qty!, type: 'exchange_out' as const, label: exVariants.get(i.exchangeVariantId!)!.product.name })),
      ].sort((a, b) => a.variantId.localeCompare(b.variantId));
      for (const m of moves) {
        await this.stock.move(em, {
          tenantId, storeId: sale.storeId, variantId: m.variantId, qty: m.qty, type: m.type, label: m.label,
          referenceType: 'return', referenceId: saved.id, referenceNo: returnNo, allowNegative: settings.allowNegativeStock,
        }, user);
      }

      if (customer) {
        const pointsBack = Math.floor(returnedValue / 100);
        await em.getRepository(Customer).update(customer.id, {
          loyaltyPoints: Math.max(customer.loyaltyPoints - pointsBack, 0),
          storeCredit: round2(customer.storeCredit + (net > 0 && dto.refundMethod === 'store_credit' ? net : 0)),
        });
      }
      await this.audit.log(user, 'sale.return', 'sale_return', saved.id, { returnNo, invoiceNo: sale.invoiceNo, returnedValue, exchangeValue, net, refundMethod: dto.refundMethod, collect: dto.collect }, em);
      return saved.id;
    });
    return this.get(user, id);
  }

  async list(user: AuthUser, q: { storeId?: string; from?: string; to?: string; page?: string; pageSize?: string }) {
    const tenantId = tenantOf(user);
    const stores = storeScope(user, q.storeId);
    const { skip, take, page, pageSize } = parsePage(q.page, q.pageSize);
    const qb = this.returns.createQueryBuilder('r').leftJoinAndSelect('r.items', 'i')
      .leftJoin('r.sale', 's').addSelect(['s.id', 's.invoiceNo'])
      .where('r.tenantId = :tenantId', { tenantId }).orderBy('r.createdAt', 'DESC').skip(skip).take(take);
    if (stores) qb.andWhere('r.storeId IN (:...stores)', { stores });
    if (q.from) qb.andWhere('r.createdAt >= :from', { from: q.from });
    if (q.to) qb.andWhere("r.createdAt < (:to::date + interval '1 day')", { to: q.to });
    const [items, total] = await qb.getManyAndCount();
    return paged(items, total, page, pageSize);
  }

  async get(user: AuthUser, id: string) {
    const r = await this.returns.findOne({ where: { id, tenantId: tenantOf(user) }, relations: { items: true, sale: true } });
    if (!r) throw new NotFoundException('Return not found');
    assertStore(user, r.storeId);
    return r;
  }
}

@Controller('returns')
export class ReturnsController {
  constructor(private svc: ReturnsService) {}

  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateReturnDto) {
    return this.svc.create(u, dto);
  }
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.svc.list(u, q);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }
}

@Module({ imports: [TypeOrmModule.forFeature([SaleReturn]), InventoryModule], controllers: [ReturnsController], providers: [ReturnsService] })
export class ReturnsModule {}
