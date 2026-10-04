import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min, ValidateNested } from 'class-validator';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { assertStore, AuthUser, canAccessStore, CurrentUser, Roles, tenantOf } from '../../common/auth';
import { RequireModule } from '../../common/modules';
import { paged, parsePage } from '../../common/util';
import { ProductVariant, StockTransfer, StockTransferItem, Store } from '../../database/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { StockService } from '../inventory/stock.service';

const ROLES = ['tenant_admin', 'store_manager', 'inventory_user'] as const;

class TransferItemDto {
  @IsUUID() variantId: string;
  @IsInt() @Min(1) qty: number;
}
class CreateTransferDto {
  @IsUUID() fromStoreId: string;
  @IsUUID() toStoreId: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => TransferItemDto) items: TransferItemDto[];
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  /** send immediately (stock leaves the source store now) */
  @IsOptional() @IsBoolean() dispatch?: boolean;
}
class ReceiveLineDto {
  @IsUUID() itemId: string;
  @IsInt() @Min(0) receivedQty: number;
}
class ReceiveDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) items: ReceiveLineDto[];
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class CancelDto {
  @IsString() @Length(3, 200) reason: string;
}

@Injectable()
export class TransfersService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(StockTransfer) private transfers: Repository<StockTransfer>,
    private stock: StockService,
    private audit: AuditService,
  ) {}

  async list(user: AuthUser, q: { storeId?: string; status?: string; direction?: 'in' | 'out'; page?: string; pageSize?: string }) {
    const tenantId = tenantOf(user);
    const { skip, take, page, pageSize } = parsePage(q.page, q.pageSize);
    const qb = this.transfers.createQueryBuilder('t')
      .leftJoin('t.fromStore', 'f').addSelect(['f.id', 'f.name', 'f.code'])
      .leftJoin('t.toStore', 'd').addSelect(['d.id', 'd.name', 'd.code'])
      .where('t.tenantId = :tenantId', { tenantId }).orderBy('t.createdAt', 'DESC').skip(skip).take(take);
    if (q.storeId) {
      assertStore(user, q.storeId);
      if (q.direction === 'in') qb.andWhere('t.toStoreId = :s', { s: q.storeId });
      else if (q.direction === 'out') qb.andWhere('t.fromStoreId = :s', { s: q.storeId });
      else qb.andWhere(new Brackets((b) => b.where('t.fromStoreId = :s').orWhere('t.toStoreId = :s')), { s: q.storeId });
    } else if (!['tenant_admin', 'accountant'].includes(user.role)) {
      qb.andWhere(new Brackets((b) => b.where('t.fromStoreId IN (:...ids)').orWhere('t.toStoreId IN (:...ids)')), { ids: user.storeIds.length ? user.storeIds : ['00000000-0000-0000-0000-000000000000'] });
    }
    if (q.status) qb.andWhere('t.status = :st', { st: q.status });
    const [items, total] = await qb.getManyAndCount();
    return paged(items, total, page, pageSize);
  }

  async get(user: AuthUser, id: string) {
    const t = await this.transfers.findOne({ where: { id, tenantId: tenantOf(user) }, relations: { items: true, fromStore: true, toStore: true } });
    if (!t) throw new NotFoundException('Transfer not found');
    if (!canAccessStore(user, t.fromStoreId) && !canAccessStore(user, t.toStoreId)) throw new ForbiddenException('You do not have access to this transfer');
    return t;
  }

  async create(user: AuthUser, dto: CreateTransferDto) {
    const tenantId = tenantOf(user);
    assertStore(user, dto.fromStoreId);
    if (dto.fromStoreId === dto.toStoreId) throw new BadRequestException('Choose a different destination store');
    const id = await this.ds.transaction(async (em) => {
      const from = await em.getRepository(Store).createQueryBuilder('s').setLock('pessimistic_write').where('s.id = :id AND s.tenantId = :t', { id: dto.fromStoreId, t: tenantId }).getOne();
      const to = await em.getRepository(Store).findOneBy({ id: dto.toStoreId, tenantId, isActive: true });
      if (!from || !to) throw new NotFoundException('Store not found');
      const merged = new Map<string, number>();
      for (const i of dto.items) merged.set(i.variantId, (merged.get(i.variantId) ?? 0) + i.qty);
      const variants = await em.getRepository(ProductVariant).find({ where: { tenantId, id: In([...merged.keys()]) }, relations: { product: true } });
      if (variants.length !== merged.size) throw new BadRequestException('Unknown item on the transfer');
      from.transferSeq += 1;
      await em.getRepository(Store).update(from.id, { transferSeq: from.transferSeq });
      const t = await em.getRepository(StockTransfer).save(em.getRepository(StockTransfer).create({
        tenantId, transferNo: `TR-${from.code}-${new Date().getFullYear()}-${String(from.transferSeq).padStart(4, '0')}`,
        fromStoreId: from.id, toStoreId: to.id, status: 'draft', notes: dto.notes, createdByName: user.name,
        totalQty: [...merged.values()].reduce((a, b) => a + b, 0),
        items: variants.map((v) => em.getRepository(StockTransferItem).create({
          variantId: v.id, productName: v.product.name, sku: v.sku, size: v.size, color: v.color, qty: merged.get(v.id)!, receivedQty: null,
        })),
      }));
      await this.audit.log(user, 'transfer.create', 'stock_transfer', t.id, { transferNo: t.transferNo, from: from.code, to: to.code, units: t.totalQty }, em);
      if (dto.dispatch) await this.doDispatch(em, user, t.id);
      return t.id;
    });
    return this.get(user, id);
  }

  async dispatch(user: AuthUser, id: string) {
    await this.ds.transaction((em) => this.doDispatch(em, user, id));
    return this.get(user, id);
  }

  private async lock(em: EntityManager, user: AuthUser, id: string) {
    const t = await em.getRepository(StockTransfer).createQueryBuilder('t').setLock('pessimistic_write').where('t.id = :id AND t.tenantId = :tid', { id, tid: tenantOf(user) }).getOne();
    if (!t) throw new NotFoundException('Transfer not found');
    return { t, items: await em.getRepository(StockTransferItem).find({ where: { transferId: id } }) };
  }

  private async doDispatch(em: EntityManager, user: AuthUser, id: string) {
    const { t, items } = await this.lock(em, user, id);
    assertStore(user, t.fromStoreId);
    if (t.status !== 'draft') throw new BadRequestException(`Transfer is already ${t.status.replace('_', ' ')}`);
    for (const i of [...items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      await this.stock.move(em, {
        tenantId: t.tenantId, storeId: t.fromStoreId, variantId: i.variantId, qty: -i.qty, type: 'transfer_out',
        referenceType: 'transfer', referenceId: t.id, referenceNo: t.transferNo, label: `${i.productName} (${[i.size, i.color].filter(Boolean).join(' / ')})`,
      }, user);
    }
    await em.getRepository(StockTransfer).update(t.id, { status: 'in_transit', dispatchedAt: new Date(), dispatchedByName: user.name });
    await this.audit.log(user, 'transfer.dispatch', 'stock_transfer', t.id, { transferNo: t.transferNo, units: t.totalQty }, em);
  }

  /** Destination confirms what arrived; shortfalls are recorded (stock already left the source). */
  async receive(user: AuthUser, id: string, dto: ReceiveDto) {
    await this.ds.transaction(async (em) => {
      const { t, items } = await this.lock(em, user, id);
      assertStore(user, t.toStoreId);
      if (t.status !== 'in_transit') throw new BadRequestException('Only transfers in transit can be received');
      const got = new Map(dto.items.map((r) => [r.itemId, r.receivedQty]));
      const shortages: { sku: string; short: number }[] = [];
      for (const i of [...items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
        const received = got.get(i.id) ?? i.qty;
        if (received > i.qty) throw new BadRequestException(`${i.sku}: received more than was sent`);
        if (received > 0) {
          await this.stock.move(em, {
            tenantId: t.tenantId, storeId: t.toStoreId, variantId: i.variantId, qty: received, type: 'transfer_in',
            referenceType: 'transfer', referenceId: t.id, referenceNo: t.transferNo,
          }, user);
        }
        if (received < i.qty) shortages.push({ sku: i.sku, short: i.qty - received });
        await em.getRepository(StockTransferItem).update(i.id, { receivedQty: received });
      }
      await em.getRepository(StockTransfer).update(t.id, {
        status: 'received', receivedAt: new Date(), receivedByName: user.name,
        notes: [t.notes, dto.note, shortages.length ? `Short: ${shortages.map((s) => `${s.sku} ×${s.short}`).join(', ')}` : ''].filter(Boolean).join(' · '),
      });
      await this.audit.log(user, 'transfer.receive', 'stock_transfer', t.id, { transferNo: t.transferNo, shortages }, em);
    });
    return this.get(user, id);
  }

  /** Draft: just cancelled. In transit: the goods go back into the source store. */
  async cancel(user: AuthUser, id: string, dto: CancelDto) {
    await this.ds.transaction(async (em) => {
      const { t, items } = await this.lock(em, user, id);
      assertStore(user, t.fromStoreId);
      if (!['draft', 'in_transit'].includes(t.status)) throw new BadRequestException(`A ${t.status} transfer cannot be cancelled`);
      if (t.status === 'in_transit') {
        for (const i of [...items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
          await this.stock.move(em, {
            tenantId: t.tenantId, storeId: t.fromStoreId, variantId: i.variantId, qty: i.qty, type: 'transfer_in',
            referenceType: 'transfer', referenceId: t.id, referenceNo: t.transferNo, note: `Cancelled: ${dto.reason}`,
          }, user);
        }
      }
      await em.getRepository(StockTransfer).update(t.id, { status: 'cancelled', cancelReason: dto.reason });
      await this.audit.log(user, 'transfer.cancel', 'stock_transfer', t.id, { transferNo: t.transferNo, wasInTransit: t.status === 'in_transit', reason: dto.reason }, em);
    });
    return this.get(user, id);
  }
}

@RequireModule('multi_store')
@Controller('transfers')
export class TransfersController {
  constructor(private svc: TransfersService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.svc.list(u, q);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }
  @Roles(...ROLES) @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateTransferDto) {
    return this.svc.create(u, dto);
  }
  @Roles(...ROLES) @Post(':id/dispatch') dispatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.dispatch(u, id);
  }
  @Roles(...ROLES) @Post(':id/receive') receive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveDto) {
    return this.svc.receive(u, id, dto);
  }
  @Roles(...ROLES) @Post(':id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.svc.cancel(u, id, dto);
  }
}

@Module({ imports: [TypeOrmModule.forFeature([StockTransfer, StockTransferItem]), InventoryModule], controllers: [TransfersController], providers: [TransfersService] })
export class TransfersModule {}
