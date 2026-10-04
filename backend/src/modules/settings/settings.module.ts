import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, Roles, tenantOf } from '../../common/auth';
import { TenantService } from '../../common/tenant.service';
import { paged, parsePage } from '../../common/util';
import { PriceList, ProductPrice, ProductVariant, Store, Tenant } from '../../database/entities';

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

class BusinessDto {
  @IsOptional() @IsString() @Length(2, 80) businessName?: string;
  @IsOptional() @IsString() @Length(2, 60) ownerName?: string;
  @IsOptional() @Matches(/^\d{10}$/) mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @Matches(GSTIN, { message: 'GSTIN format is invalid' }) gstin?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsString() @MaxLength(60) state?: string;
  @IsOptional() @Matches(/^\d{2}$/) stateCode?: string;
}
class RulesDto {
  @IsOptional() @IsBoolean() allowNegativeStock?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(100) cashierDiscountLimitPct?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) returnWindowDays?: number;
  @IsOptional() @IsBoolean() roundOff?: boolean;
  @IsOptional() @IsString() @MaxLength(200) invoiceFooter?: string;
  @IsOptional() @IsIn([58, 80]) receiptWidth?: 58 | 80;
  @IsOptional() @IsNumber() @Min(0) @Max(20) loyaltyPointsPer100?: number;
  @IsOptional() @IsNumber() @Min(0) cashVarianceTolerance?: number;
}
class StoreDto {
  @IsString() @Length(2, 60) name: string;
  @Matches(/^[A-Z]{2,4}$/, { message: 'store code: 2-4 capital letters' }) code: string;
  @IsOptional() @Matches(/^[A-Z0-9]{2,6}$/, { message: 'invoice prefix: 2-6 capital letters/digits' }) invoicePrefix?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @Matches(GSTIN, { message: 'GSTIN format is invalid' }) gstin?: string;
  @IsOptional() @Matches(/^\d{2}$/) stateCode?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) counters?: number;
}
class UpdateStoreDto {
  @IsOptional() @IsString() @Length(2, 60) name?: string;
  @IsOptional() @Matches(/^[A-Z0-9]{2,6}$/) invoicePrefix?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @Matches(GSTIN) gstin?: string;
  @IsOptional() @Matches(/^\d{2}$/) stateCode?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) counters?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class PriceListDto {
  @IsString() @Length(2, 60) name: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class PriceItemDto {
  @IsUUID() variantId: string;
  /** null removes the override (variant falls back to its selling price) */
  @IsOptional() @IsNumber() @Min(0) price: number | null;
}
class PricesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PriceItemDto) items: PriceItemDto[];
}
class PriceRuleDto {
  @IsIn(['selling', 'mrp']) basis: 'selling' | 'mrp';
  @IsNumber() @Min(0) @Max(90) percentOff: number;
  @IsOptional() @IsUUID() categoryId?: string;
  /** round to the nearest ₹9 ending (e.g. 899) - common in apparel retail */
  @IsOptional() @IsBoolean() roundTo9?: boolean;
}

const ADMIN = ['tenant_admin'] as const;

@Injectable()
export class SettingsService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(Tenant) private tenantsRepo: Repository<Tenant>,
    @InjectRepository(Store) private stores: Repository<Store>,
    @InjectRepository(PriceList) private lists: Repository<PriceList>,
    @InjectRepository(ProductPrice) private prices: Repository<ProductPrice>,
    private tenants: TenantService,
    private audit: AuditService,
  ) {}

  async get(user: AuthUser) {
    const tenantId = tenantOf(user);
    const t = await this.tenants.get(tenantId);
    const stores = await this.stores.find({ where: { tenantId }, order: { createdAt: 'ASC' } });
    const sub = await this.tenants.currentSubscription(tenantId);
    return {
      business: { businessName: t.businessName, ownerName: t.ownerName, mobile: t.mobile, email: t.email, gstin: t.gstin, address: t.address, city: t.city, state: t.state, stateCode: t.stateCode },
      rules: this.tenants.settings(t),
      stores,
      limits: { maxStores: sub?.plan.maxStores ?? null, modules: this.tenants.modules(sub?.plan, t) },
    };
  }

  async updateBusiness(user: AuthUser, dto: BusinessDto) {
    const tenantId = tenantOf(user);
    const t = await this.tenants.get(tenantId);
    await this.tenantsRepo.update(tenantId, { ...dto, ...(dto.gstin && !dto.stateCode ? { stateCode: dto.gstin.slice(0, 2) } : {}) });
    await this.audit.log(user, 'settings.business', 'tenant', tenantId, { before: { businessName: t.businessName, gstin: t.gstin }, changes: dto });
    return this.get(user);
  }

  async updateRules(user: AuthUser, dto: RulesDto) {
    const tenantId = tenantOf(user);
    const t = await this.tenants.get(tenantId);
    const before = this.tenants.settings(t);
    await this.tenantsRepo.update(tenantId, { settings: { ...before, ...dto } });
    await this.audit.log(user, 'settings.rules', 'tenant', tenantId, { before, changes: dto });
    return this.get(user);
  }

  async createStore(user: AuthUser, dto: StoreDto) {
    const tenantId = tenantOf(user);
    const [t, sub] = await Promise.all([this.tenants.get(tenantId), this.tenants.currentSubscription(tenantId)]);
    const count = await this.stores.countBy({ tenantId, isActive: true });
    const max = sub?.plan.maxStores;
    if (max != null && count >= max) throw new ForbiddenException(`Your plan allows ${max} store${max === 1 ? '' : 's'}. Upgrade to add more.`);
    if (count >= 1 && !this.tenants.modules(sub?.plan, t).includes('multi_store')) throw new ForbiddenException('Multi-store is not included in your plan');
    if (await this.stores.existsBy({ tenantId, code: dto.code })) throw new ConflictException(`Store code ${dto.code} is already used`);
    if (await this.stores.existsBy({ tenantId, invoicePrefix: dto.invoicePrefix ?? dto.code })) throw new ConflictException(`Invoice prefix ${dto.invoicePrefix ?? dto.code} is already used`);
    const s = await this.stores.save(this.stores.create({ ...dto, tenantId, invoicePrefix: dto.invoicePrefix ?? dto.code, stateCode: dto.stateCode ?? t.stateCode, gstin: dto.gstin ?? t.gstin }));
    await this.audit.log(user, 'store.create', 'store', s.id, { name: s.name, code: s.code });
    return s;
  }

  async updateStore(user: AuthUser, id: string, dto: UpdateStoreDto) {
    const tenantId = tenantOf(user);
    const s = await this.stores.findOneBy({ id, tenantId });
    if (!s) throw new NotFoundException('Store not found');
    if (dto.isActive === false && (await this.stores.countBy({ tenantId, isActive: true })) <= 1) throw new BadRequestException('You need at least one active store');
    // the sequence keeps running across prefix changes, so invoice numbers can never repeat
    if (dto.invoicePrefix && dto.invoicePrefix !== s.invoicePrefix && (await this.stores.existsBy({ tenantId, invoicePrefix: dto.invoicePrefix }))) {
      throw new ConflictException(`Invoice prefix ${dto.invoicePrefix} is used by another store`);
    }
    await this.stores.update(id, dto);
    await this.audit.log(user, 'store.update', 'store', id, { code: s.code, changes: dto });
    return this.stores.findOneBy({ id });
  }

  // ------------------------------------------------------------ price lists
  async listPriceLists(user: AuthUser) {
    const tenantId = tenantOf(user);
    return this.ds.query(
      `SELECT l.id, l.name, l.is_default AS "isDefault", l.is_active AS "isActive", COUNT(p.id)::int AS "priceCount"
       FROM price_lists l LEFT JOIN product_prices p ON p.price_list_id = l.id
       WHERE l.tenant_id = $1 GROUP BY l.id ORDER BY l.is_default DESC, l.name`, [tenantId]);
  }

  async createPriceList(user: AuthUser, dto: PriceListDto) {
    const l = await this.lists.save(this.lists.create({ tenantId: tenantOf(user), name: dto.name, isActive: dto.isActive ?? true }));
    await this.audit.log(user, 'pricelist.create', 'price_list', l.id, { name: l.name });
    return l;
  }

  async updatePriceList(user: AuthUser, id: string, dto: Partial<PriceListDto>) {
    const l = await this.lists.findOneBy({ id, tenantId: tenantOf(user) });
    if (!l) throw new NotFoundException('Price list not found');
    if (l.isDefault && dto.isActive === false) throw new BadRequestException('The default retail list cannot be deactivated');
    await this.lists.update(id, dto);
    return this.lists.findOneBy({ id });
  }

  async listPrices(user: AuthUser, id: string, q: { search?: string; categoryId?: string; page?: string; pageSize?: string }) {
    const tenantId = tenantOf(user);
    const l = await this.lists.findOneBy({ id, tenantId });
    if (!l) throw new NotFoundException('Price list not found');
    const { skip, take, page, pageSize } = parsePage(q.page, q.pageSize ?? 25);
    const params: any[] = [tenantId, id];
    let where = 'v.tenant_id = $1 AND v.is_active AND pr.is_active';
    if (q.search) where += ` AND (pr.name ILIKE $${params.push(`%${q.search}%`)} OR v.sku ILIKE $${params.length})`;
    if (q.categoryId) where += ` AND pr.category_id = $${params.push(q.categoryId)}`;
    const [{ n }] = await this.ds.query(`SELECT COUNT(*)::int n FROM product_variants v JOIN products pr ON pr.id = v.product_id
       LEFT JOIN product_prices p ON p.variant_id = v.id AND p.price_list_id = $2 WHERE ${where}`, params);
    const rows = await this.ds.query(
      `SELECT v.id AS "variantId", v.sku, v.size, v.color, pr.name AS "productName", pr.art_type AS "artType", pr.art_color AS "artColor",
              v.mrp::float, v.selling_price::float AS "sellingPrice", v.purchase_price::float AS "purchasePrice", pr.gst_rate::float AS "gstRate", p.price::float AS "listPrice"
       FROM product_variants v JOIN products pr ON pr.id = v.product_id
       LEFT JOIN product_prices p ON p.variant_id = v.id AND p.price_list_id = $2
       WHERE ${where} ORDER BY pr.name, v.sort_order LIMIT ${take} OFFSET ${skip}`, params);
    return paged(rows, n, page, pageSize);
  }

  async setPrices(user: AuthUser, id: string, dto: PricesDto) {
    const tenantId = tenantOf(user);
    const l = await this.lists.findOneBy({ id, tenantId });
    if (!l) throw new NotFoundException('Price list not found');
    if (l.isDefault) throw new BadRequestException('Edit the selling price on the product for the default retail list');
    const variants = await this.ds.getRepository(ProductVariant).find({ where: { tenantId, id: In(dto.items.map((i) => i.variantId)) } });
    const vmap = new Map(variants.map((v) => [v.id, v]));
    let set = 0, removed = 0;
    await this.ds.transaction(async (em) => {
      for (const i of dto.items) {
        const v = vmap.get(i.variantId);
        if (!v) throw new BadRequestException('Unknown item');
        if (i.price == null) {
          await em.getRepository(ProductPrice).delete({ priceListId: id, variantId: v.id });
          removed++;
          continue;
        }
        if (i.price > v.mrp) throw new BadRequestException(`${v.sku}: price cannot exceed MRP ₹${v.mrp}`);
        await em.createQueryBuilder().insert().into(ProductPrice).values({ tenantId, priceListId: id, variantId: v.id, price: i.price })
          .orUpdate(['price', 'updated_at'], ['price_list_id', 'variant_id']).execute();
        set++;
      }
    });
    await this.audit.log(user, 'pricelist.prices', 'price_list', id, { name: l.name, set, removed });
    return { set, removed };
  }

  /** Bulk rule, e.g. "Festive sale = 10% off selling price, ending in 9". */
  async applyRule(user: AuthUser, id: string, dto: PriceRuleDto) {
    const tenantId = tenantOf(user);
    const l = await this.lists.findOneBy({ id, tenantId });
    if (!l) throw new NotFoundException('Price list not found');
    if (l.isDefault) throw new BadRequestException('Rules apply to additional price lists, not the default retail list');
    const qb = this.ds.getRepository(ProductVariant).createQueryBuilder('v').innerJoin('v.product', 'p')
      .where('v.tenantId = :tenantId AND v.isActive = true AND p.isActive = true', { tenantId });
    if (dto.categoryId) qb.andWhere('p.categoryId = :c', { c: dto.categoryId });
    const variants = await qb.getMany();
    const items = variants.map((v) => {
      let price = (dto.basis === 'mrp' ? v.mrp : v.sellingPrice) * (1 - dto.percentOff / 100);
      if (dto.roundTo9) price = Math.max(9, Math.floor(price / 10) * 10 - 1);
      return { variantId: v.id, price: Math.min(Math.round(price), v.mrp) };
    });
    const r = await this.setPrices(user, id, { items });
    await this.audit.log(user, 'pricelist.rule', 'price_list', id, { ...dto, variants: items.length });
    return r;
  }
}

@Controller()
export class SettingsController {
  constructor(private svc: SettingsService) {}

  @Roles('tenant_admin', 'store_manager', 'accountant') @Get('settings') get(@CurrentUser() u: AuthUser) {
    return this.svc.get(u);
  }
  @Roles(...ADMIN) @Patch('settings/business') business(@CurrentUser() u: AuthUser, @Body() dto: BusinessDto) {
    return this.svc.updateBusiness(u, dto);
  }
  @Roles(...ADMIN) @Patch('settings/rules') rules(@CurrentUser() u: AuthUser, @Body() dto: RulesDto) {
    return this.svc.updateRules(u, dto);
  }
  @Roles(...ADMIN) @Post('stores') createStore(@CurrentUser() u: AuthUser, @Body() dto: StoreDto) {
    return this.svc.createStore(u, dto);
  }
  @Roles(...ADMIN) @Patch('stores/:id') updateStore(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStoreDto) {
    return this.svc.updateStore(u, id, dto);
  }
  @Get('price-lists') priceLists(@CurrentUser() u: AuthUser) {
    return this.svc.listPriceLists(u);
  }
  @Roles('tenant_admin', 'store_manager') @Post('price-lists') createList(@CurrentUser() u: AuthUser, @Body() dto: PriceListDto) {
    return this.svc.createPriceList(u, dto);
  }
  @Roles('tenant_admin', 'store_manager') @Patch('price-lists/:id') updateList(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PriceListDto) {
    return this.svc.updatePriceList(u, id, dto);
  }
  @Roles('tenant_admin', 'store_manager') @Get('price-lists/:id/prices') prices(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: any) {
    return this.svc.listPrices(u, id, q);
  }
  @Roles('tenant_admin', 'store_manager') @Put('price-lists/:id/prices') setPrices(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PricesDto) {
    return this.svc.setPrices(u, id, dto);
  }
  @Roles('tenant_admin', 'store_manager') @Post('price-lists/:id/apply-rule') applyRule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PriceRuleDto) {
    return this.svc.applyRule(u, id, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, Store, PriceList, ProductPrice])],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
