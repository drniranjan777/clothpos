import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsHexColor, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { randomInt } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, Roles, tenantOf } from '../../common/auth';
import { TenantService } from '../../common/tenant.service';
import { ean13, paged, parsePage } from '../../common/util';
import { Brand, Category, Color, Inventory, PriceList, Product, ProductPrice, ProductVariant, Size, Store } from '../../database/entities';

export const ART_TYPES = ['shirt', 'plaid', 'tshirt', 'jacket', 'hoodie', 'kurta', 'jeans', 'shorts', 'dress', 'saree', 'shoe', 'heels', 'jewel', 'bag'];

class VariantDto {
  @IsOptional() @IsString() @MaxLength(20) size?: string;
  @IsOptional() @IsString() @MaxLength(30) color?: string;
  @IsOptional() @IsHexColor() colorHex?: string;
  @IsOptional() @Matches(/^[A-Z0-9-]{2,40}$/i, { message: 'SKU may contain letters, digits and dashes' }) sku?: string;
  @IsOptional() @Matches(/^\d{8,14}$/, { message: 'barcode must be 8-14 digits' }) barcode?: string;
  @IsNumber() @Min(0) purchasePrice: number;
  @IsNumber() @Min(0) mrp: number;
  @IsNumber() @Min(0) sellingPrice: number;
  @IsOptional() @IsInt() @Min(0) minStock?: number;
}
class ProductDto {
  @IsString() @Length(2, 120) name: string;
  @IsOptional() @Matches(/^[A-Z0-9-]{2,20}$/i) code?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() brandId?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsString() @MaxLength(20) season?: string;
  @IsOptional() @IsString() @MaxLength(40) fabric?: string;
  @IsOptional() @Matches(/^\d{4,8}$/, { message: 'HSN code must be 4-8 digits' }) hsnCode?: string;
  @IsNumber() @IsIn([0, 3, 5, 12, 18, 28]) gstRate: number;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsIn(ART_TYPES) artType?: string;
  @IsOptional() @IsHexColor() artColor?: string;
  @IsOptional() @IsInt() @Min(0) minStock?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class CreateProductDto extends ProductDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => VariantDto) variants: VariantDto[];
}
class UpdateProductDto extends PartialType(ProductDto) {}
class AddVariantsDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => VariantDto) variants: VariantDto[];
}
class UpdateVariantDto {
  @IsOptional() @IsNumber() @Min(0) purchasePrice?: number;
  @IsOptional() @IsNumber() @Min(0) mrp?: number;
  @IsOptional() @IsNumber() @Min(0) sellingPrice?: number;
  @IsOptional() @IsInt() @Min(0) minStock?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class NameDto {
  @IsString() @Length(1, 60) name: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsHexColor() hex?: string;
  @IsOptional() @IsUUID() parentId?: string;
}

const CATALOG_ROLES = ['tenant_admin', 'store_manager', 'inventory_user'] as const;
const slug = (s?: string) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

@Injectable()
export class CatalogService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(Product) private products: Repository<Product>,
    @InjectRepository(ProductVariant) private variants: Repository<ProductVariant>,
    @InjectRepository(Category) private categories: Repository<Category>,
    @InjectRepository(Brand) private brands: Repository<Brand>,
    @InjectRepository(Size) private sizes: Repository<Size>,
    @InjectRepository(Color) private colors: Repository<Color>,
    private tenants: TenantService,
    private audit: AuditService,
  ) {}

  async list(user: AuthUser, q: { search?: string; categoryId?: string; brandId?: string; status?: string; page?: string; pageSize?: string }) {
    const tenantId = tenantOf(user);
    const { skip, take, page, pageSize } = parsePage(q.page, q.pageSize);
    const qb = this.products.createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'c').leftJoinAndSelect('p.brand', 'b')
      .where('p.tenantId = :tenantId', { tenantId })
      .orderBy('p.name').offset(skip).limit(take);
    if (q.search) qb.andWhere(`(p.name ILIKE :s OR p.code ILIKE :s OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (v.sku ILIKE :s OR v.barcode = :e)))`, { s: `%${q.search}%`, e: q.search.trim() });
    if (q.categoryId) qb.andWhere('p.categoryId = :cat', { cat: q.categoryId });
    if (q.brandId) qb.andWhere('p.brandId = :brand', { brand: q.brandId });
    if (q.status === 'active') qb.andWhere('p.isActive = true');
    if (q.status === 'inactive') qb.andWhere('p.isActive = false');
    const [items, total] = await qb.getManyAndCount();
    const ids = items.map((p) => p.id);
    const stats: any[] = ids.length ? await this.ds.query(
      `SELECT v.product_id AS id, COUNT(DISTINCT v.id)::int AS variants, COALESCE(SUM(i.quantity),0)::int AS stock,
              MIN(v.selling_price)::float AS "minPrice", MAX(v.selling_price)::float AS "maxPrice", MAX(v.mrp)::float AS mrp,
              COUNT(DISTINCT v.id) FILTER (WHERE COALESCE(inv.q,0) <= 0)::int AS "outVariants"
       FROM product_variants v
       LEFT JOIN inventory i ON i.variant_id = v.id
       LEFT JOIN (SELECT variant_id, SUM(quantity) q FROM inventory GROUP BY variant_id) inv ON inv.variant_id = v.id
       WHERE v.product_id = ANY($1) AND v.is_active GROUP BY v.product_id`, [ids]) : [];
    const sm = new Map(stats.map((s) => [s.id, s]));
    return paged(items.map((p) => ({
      id: p.id, name: p.name, code: p.code, category: p.category?.name, categoryId: p.categoryId, brand: p.brand?.name, brandId: p.brandId,
      hsnCode: p.hsnCode, gstRate: p.gstRate, artType: p.artType, artColor: p.artColor, isActive: p.isActive, minStock: p.minStock,
      variants: sm.get(p.id)?.variants ?? 0, stock: sm.get(p.id)?.stock ?? 0, outVariants: sm.get(p.id)?.outVariants ?? 0,
      minPrice: sm.get(p.id)?.minPrice ?? 0, maxPrice: sm.get(p.id)?.maxPrice ?? 0, mrp: sm.get(p.id)?.mrp ?? 0,
    })), total, page, pageSize);
  }

  async get(user: AuthUser, id: string) {
    const tenantId = tenantOf(user);
    const p = await this.products.findOne({ where: { id, tenantId }, relations: { category: true, brand: true } });
    if (!p) throw new NotFoundException('Product not found');
    const variants = await this.variants.find({ where: { productId: id, tenantId }, order: { sortOrder: 'ASC' } });
    const ids = variants.map((v) => v.id);
    const stores = await this.ds.getRepository(Store).find({ where: { tenantId, isActive: true }, order: { name: 'ASC' } });
    const inv = ids.length ? await this.ds.getRepository(Inventory).find({ where: { variantId: In(ids) } }) : [];
    const lists = await this.ds.getRepository(PriceList).find({ where: { tenantId, isActive: true }, order: { isDefault: 'DESC' } });
    const prices = ids.length ? await this.ds.getRepository(ProductPrice).find({ where: { tenantId, variantId: In(ids) } }) : [];
    return {
      ...p,
      category: p.category?.name, brand: p.brand?.name,
      stores: stores.map((s) => ({ id: s.id, name: s.name, code: s.code })),
      priceLists: lists.map((l) => ({ id: l.id, name: l.name, isDefault: l.isDefault })),
      variants: variants.map((v) => ({
        ...v,
        stockByStore: Object.fromEntries(stores.map((s) => [s.id, inv.find((i) => i.variantId === v.id && i.storeId === s.id)?.quantity ?? 0])),
        prices: Object.fromEntries(prices.filter((pr) => pr.variantId === v.id).map((pr) => [pr.priceListId, pr.price])),
      })),
    };
  }

  async create(user: AuthUser, dto: CreateProductDto) {
    const tenantId = tenantOf(user);
    await this.assertSkuLimit(tenantId, dto.variants.length);
    const code = (dto.code ?? (await this.nextCode(tenantId, dto.name))).toUpperCase();
    if (await this.products.existsBy({ tenantId, code })) throw new ConflictException(`Product code ${code} already exists`);
    const id = await this.ds.transaction(async (em) => {
      const { variants, ...fields } = dto;
      const p = await em.getRepository(Product).save(em.getRepository(Product).create({ ...fields, code, tenantId, gstRate: dto.gstRate }));
      await this.insertVariants(em, tenantId, p, variants);
      await this.audit.log(user, 'product.create', 'product', p.id, { code, variants: variants.length }, em);
      return p.id;
    });
    return this.get(user, id);
  }

  async update(user: AuthUser, id: string, dto: UpdateProductDto) {
    const tenantId = tenantOf(user);
    const p = await this.products.findOneBy({ id, tenantId });
    if (!p) throw new NotFoundException('Product not found');
    if (dto.code && dto.code.toUpperCase() !== p.code && (await this.products.existsBy({ tenantId, code: dto.code.toUpperCase() }))) {
      throw new ConflictException('Product code already exists');
    }
    await this.products.update(id, { ...dto, ...(dto.code ? { code: dto.code.toUpperCase() } : {}) });
    if (dto.gstRate !== undefined && dto.gstRate !== p.gstRate) {
      await this.audit.log(user, 'product.tax_change', 'product', id, { from: p.gstRate, to: dto.gstRate });
    }
    return this.get(user, id);
  }

  async addVariants(user: AuthUser, id: string, dto: AddVariantsDto) {
    const tenantId = tenantOf(user);
    const p = await this.products.findOneBy({ id, tenantId });
    if (!p) throw new NotFoundException('Product not found');
    await this.assertSkuLimit(tenantId, dto.variants.length);
    await this.ds.transaction((em) => this.insertVariants(em, tenantId, p, dto.variants));
    return this.get(user, id);
  }

  async updateVariant(user: AuthUser, id: string, dto: UpdateVariantDto) {
    const tenantId = tenantOf(user);
    const v = await this.variants.findOneBy({ id, tenantId });
    if (!v) throw new NotFoundException('Variant not found');
    const mrp = dto.mrp ?? v.mrp;
    const price = dto.sellingPrice ?? v.sellingPrice;
    if (price > mrp) throw new BadRequestException('Selling price cannot exceed MRP');
    await this.variants.update(id, dto);
    if (dto.sellingPrice !== undefined || dto.mrp !== undefined) {
      await this.audit.log(user, 'product.price_change', 'product_variant', id, { sku: v.sku, from: { mrp: v.mrp, price: v.sellingPrice }, to: { mrp, price } });
    }
    return this.variants.findOneBy({ id });
  }

  private async insertVariants(em: EntityManager, tenantId: string, p: Product, list: VariantDto[]) {
    const repo = em.getRepository(ProductVariant);
    const start = await repo.countBy({ productId: p.id });
    for (const [idx, v] of list.entries()) {
      if (v.sellingPrice > v.mrp) throw new BadRequestException(`Selling price cannot exceed MRP (${v.size ?? ''} ${v.color ?? ''})`);
      const sku = (v.sku ?? [p.code, slug(v.color).slice(0, 3), slug(v.size)].filter(Boolean).join('-')).toUpperCase();
      if (await repo.existsBy({ tenantId, sku })) throw new ConflictException(`SKU ${sku} already exists`);
      let barcode = v.barcode;
      if (barcode) {
        if (await repo.existsBy({ tenantId, barcode })) throw new ConflictException(`Barcode ${barcode} is already used`);
      } else {
        // in-store EAN-13 range (prefix 2) - unique per tenant
        do barcode = ean13('2' + String(randomInt(0, 1e11)).padStart(11, '0'));
        while (await repo.existsBy({ tenantId, barcode }));
      }
      await repo.save(repo.create({
        tenantId, productId: p.id, sku, barcode, size: v.size, color: v.color, colorHex: v.colorHex,
        purchasePrice: v.purchasePrice, mrp: v.mrp, sellingPrice: v.sellingPrice, minStock: v.minStock ?? null, sortOrder: start + idx,
      }));
    }
  }

  private async nextCode(tenantId: string, name: string) {
    const prefix = slug(name.split(/\s+/).map((w) => w[0]).join('')).slice(0, 3).padEnd(2, 'X');
    const n = await this.products.createQueryBuilder('p').where('p.tenantId = :tenantId AND p.code LIKE :pre', { tenantId, pre: `${prefix}-%` }).getCount();
    return `${prefix}-${String(n + 1).padStart(3, '0')}`;
  }

  /** Plan entitlement: maximum products/SKUs (BRD §6). */
  private async assertSkuLimit(tenantId: string, adding: number) {
    const sub = await this.tenants.currentSubscription(tenantId);
    const max = sub?.plan.maxSkus;
    if (max == null) return;
    const count = await this.variants.countBy({ tenantId, isActive: true });
    if (count + adding > max) throw new ForbiddenException(`Your plan allows ${max} SKUs (${count} used). Upgrade to add more.`);
  }

  // ---- masters
  listCategories(user: AuthUser) {
    return this.categories.find({ where: { tenantId: tenantOf(user) }, order: { sortOrder: 'ASC', name: 'ASC' } });
  }
  createCategory(user: AuthUser, dto: NameDto) {
    return this.categories.save(this.categories.create({ tenantId: tenantOf(user), name: dto.name, sortOrder: dto.sortOrder ?? 99, parentId: dto.parentId ?? null }));
  }
  listBrands(user: AuthUser) {
    return this.brands.find({ where: { tenantId: tenantOf(user) }, order: { name: 'ASC' } });
  }
  createBrand(user: AuthUser, dto: NameDto) {
    return this.brands.save(this.brands.create({ tenantId: tenantOf(user), name: dto.name }));
  }
  listSizes(user: AuthUser) {
    return this.sizes.find({ where: { tenantId: tenantOf(user) }, order: { sortOrder: 'ASC' } });
  }
  createSize(user: AuthUser, dto: NameDto) {
    return this.sizes.save(this.sizes.create({ tenantId: tenantOf(user), name: dto.name, sortOrder: dto.sortOrder ?? 99 }));
  }
  listColors(user: AuthUser) {
    return this.colors.find({ where: { tenantId: tenantOf(user) }, order: { name: 'ASC' } });
  }
  createColor(user: AuthUser, dto: NameDto) {
    return this.colors.save(this.colors.create({ tenantId: tenantOf(user), name: dto.name, hex: dto.hex ?? '#94a3b8' }));
  }
}

@Controller('catalog')
export class CatalogController {
  constructor(private svc: CatalogService) {}

  @Get('products') list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.svc.list(u, q);
  }
  @Get('products/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }
  @Roles(...CATALOG_ROLES) @Post('products') create(@CurrentUser() u: AuthUser, @Body() dto: CreateProductDto) {
    return this.svc.create(u, dto);
  }
  @Roles(...CATALOG_ROLES) @Patch('products/:id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.svc.update(u, id, dto);
  }
  @Roles(...CATALOG_ROLES) @Post('products/:id/variants') addVariants(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddVariantsDto) {
    return this.svc.addVariants(u, id, dto);
  }
  @Roles(...CATALOG_ROLES) @Patch('variants/:id') updateVariant(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVariantDto) {
    return this.svc.updateVariant(u, id, dto);
  }
  @Get('categories') categories(@CurrentUser() u: AuthUser) {
    return this.svc.listCategories(u);
  }
  @Roles(...CATALOG_ROLES) @Post('categories') createCategory(@CurrentUser() u: AuthUser, @Body() dto: NameDto) {
    return this.svc.createCategory(u, dto);
  }
  @Get('brands') brands(@CurrentUser() u: AuthUser) {
    return this.svc.listBrands(u);
  }
  @Roles(...CATALOG_ROLES) @Post('brands') createBrand(@CurrentUser() u: AuthUser, @Body() dto: NameDto) {
    return this.svc.createBrand(u, dto);
  }
  @Get('sizes') sizes(@CurrentUser() u: AuthUser) {
    return this.svc.listSizes(u);
  }
  @Roles(...CATALOG_ROLES) @Post('sizes') createSize(@CurrentUser() u: AuthUser, @Body() dto: NameDto) {
    return this.svc.createSize(u, dto);
  }
  @Get('colors') colors(@CurrentUser() u: AuthUser) {
    return this.svc.listColors(u);
  }
  @Roles(...CATALOG_ROLES) @Post('colors') createColor(@CurrentUser() u: AuthUser, @Body() dto: NameDto) {
    return this.svc.createColor(u, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductVariant, Category, Brand, Size, Color])],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
