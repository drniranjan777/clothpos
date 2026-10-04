import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { assertStore, AuthUser, tenantOf } from '../../common/auth';
import { paged, parsePage } from '../../common/util';
import { Category, Inventory, PriceList, Product, ProductPrice, ProductVariant } from '../../database/entities';

@Injectable()
export class PosService {
  constructor(
    @InjectRepository(Category) private categories: Repository<Category>,
    @InjectRepository(Product) private products: Repository<Product>,
    @InjectRepository(ProductVariant) private variants: Repository<ProductVariant>,
    @InjectRepository(Inventory) private inventory: Repository<Inventory>,
    @InjectRepository(PriceList) private priceLists: Repository<PriceList>,
    @InjectRepository(ProductPrice) private prices: Repository<ProductPrice>,
  ) {}

  async listCategories(user: AuthUser) {
    const tenantId = tenantOf(user);
    const rows = await this.categories.createQueryBuilder('c')
      .leftJoin(Product, 'p', 'p.categoryId = c.id AND p.isActive = true')
      .select(['c.id AS id', 'c.name AS name', 'c.sortOrder AS "sortOrder"', 'COUNT(p.id)::int AS "productCount"'])
      .where('c.tenantId = :tenantId AND c.isActive = true', { tenantId })
      .groupBy('c.id').orderBy('c.sortOrder').addOrderBy('c.name')
      .getRawMany();
    return rows;
  }

  listPriceLists(user: AuthUser) {
    return this.priceLists.find({ where: { tenantId: tenantOf(user), isActive: true }, order: { isDefault: 'DESC', name: 'ASC' } });
  }

  /** Product grid for the POS: active products with variants, store stock and the effective price. */
  async browse(user: AuthUser, q: { storeId: string; categoryId?: string; search?: string; priceListId?: string; page?: string; pageSize?: string }) {
    const tenantId = tenantOf(user);
    assertStore(user, q.storeId);
    const { skip, take, page, pageSize } = parsePage(q.page, q.pageSize ?? 24, 60);
    const qb = this.products.createQueryBuilder('p')
      .leftJoinAndSelect('p.brand', 'b')
      .where('p.tenantId = :tenantId AND p.isActive = true', { tenantId });
    if (q.categoryId) qb.andWhere('p.categoryId = :cat', { cat: q.categoryId });
    if (q.search) {
      qb.andWhere(
        `(p.name ILIKE :s OR p.code ILIKE :s OR b.name ILIKE :s OR EXISTS (
           SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (v.sku ILIKE :s OR v.barcode = :exact)))`,
        { s: `%${q.search}%`, exact: q.search.trim() },
      );
    }
    // best sellers first so the most popular items are one tap away
    qb.addSelect((sq) => sq.select('COALESCE(SUM(si.qty),0)').from('sale_items', 'si').innerJoin('product_variants', 'pv', 'pv.id = si.variant_id').where('pv.product_id = p.id'), 'sold')
      .orderBy('sold', 'DESC').addOrderBy('p.name', 'ASC').offset(skip).limit(take);
    const [items, total] = await qb.getManyAndCount();
    return paged(await this.withVariants(tenantId, q.storeId, items, q.priceListId), total, page, pageSize);
  }

  /** Whole sellable catalogue of a store (compact) - cached by the POS for offline scanning (BRD §23). */
  async catalog(user: AuthUser, storeId: string, priceListId?: string) {
    const tenantId = tenantOf(user);
    assertStore(user, storeId);
    const products = await this.products.find({ where: { tenantId, isActive: true }, relations: { brand: true }, order: { name: 'ASC' } });
    return { storeId, priceListId: priceListId ?? null, generatedAt: new Date().toISOString(), products: await this.withVariants(tenantId, storeId, products, priceListId) };
  }

  /** Barcode-first lookup (BRD §12): exact barcode, else SKU. */
  async scan(user: AuthUser, code: string, storeId: string, priceListId?: string) {
    const tenantId = tenantOf(user);
    assertStore(user, storeId);
    const c = code.trim();
    const variant = await this.variants.createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .where('v.tenantId = :tenantId AND v.isActive = true AND p.isActive = true', { tenantId })
      .andWhere('(v.barcode = :c OR UPPER(v.sku) = UPPER(:c))', { c })
      .getOne();
    if (!variant) throw new NotFoundException(`No item found for barcode "${c}"`);
    const [p] = await this.withVariants(tenantId, storeId, [variant.product], priceListId);
    return { product: p, variantId: variant.id };
  }

  private async withVariants(tenantId: string, storeId: string, products: Product[], priceListId?: string) {
    if (!products.length) return [];
    const variants = await this.variants.find({
      where: { tenantId, productId: In(products.map((p) => p.id)), isActive: true },
      order: { sortOrder: 'ASC' },
    });
    const ids = variants.map((v) => v.id);
    const stock = new Map((await this.inventory.find({ where: { storeId, variantId: In(ids) } })).map((i) => [i.variantId, i.quantity]));
    const listPrice = priceListId
      ? new Map((await this.prices.find({ where: { tenantId, priceListId, variantId: In(ids) } })).map((p) => [p.variantId, p.price]))
      : new Map<string, number>();
    return products.map((p) => ({
      id: p.id, name: p.name, code: p.code, categoryId: p.categoryId, brand: p.brand?.name, hsnCode: p.hsnCode, gstRate: p.gstRate,
      imageUrl: p.imageUrl, artType: p.artType, artColor: p.artColor, minStock: p.minStock,
      variants: variants.filter((v) => v.productId === p.id).map((v) => ({
        id: v.id, sku: v.sku, barcode: v.barcode, size: v.size, color: v.color, colorHex: v.colorHex,
        mrp: v.mrp, price: listPrice.get(v.id) ?? v.sellingPrice, stock: stock.get(v.id) ?? 0, minStock: v.minStock ?? p.minStock,
      })),
    }));
  }
}
