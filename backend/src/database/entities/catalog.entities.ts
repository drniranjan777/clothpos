import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity, money, rate } from '../base';

@Entity('categories')
export class Category extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Column() name: string;
  @Column({ type: 'uuid', nullable: true }) parentId: string | null;
  @Column({ default: 0 }) sortOrder: number;
  @Column({ default: true }) isActive: boolean;
}

@Entity('brands')
export class Brand extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Column() name: string;
}

/** Size & colour masters (BRD §13) - variants copy the label so history survives renames. */
@Entity('sizes')
export class Size extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Column() name: string;
  @Column({ default: 0 }) sortOrder: number;
}

@Entity('colors')
export class Color extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Column() name: string;
  @Column({ default: '#94a3b8' }) hex: string;
}

@Entity('products')
@Index(['tenantId', 'code'], { unique: true })
export class Product extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Column() name: string;
  @Column() code: string;
  @Column({ type: 'uuid', nullable: true }) categoryId: string | null;
  @ManyToOne(() => Category, { nullable: true }) @JoinColumn() category?: Category;
  @Column({ type: 'uuid', nullable: true }) brandId: string | null;
  @ManyToOne(() => Brand, { nullable: true }) @JoinColumn() brand?: Brand;
  @Column({ nullable: true }) gender?: string;
  @Column({ nullable: true }) season?: string;
  @Column({ nullable: true }) fabric?: string;
  @Column({ nullable: true }) hsnCode?: string;
  @Column(rate) gstRate: number;
  @Column({ nullable: true }) description?: string;
  @Column({ nullable: true }) imageUrl?: string;
  /** drawn illustration used when there is no photo: shirt | tshirt | jeans | ... */
  @Column({ default: 'tshirt' }) artType: string;
  @Column({ default: '#64748b' }) artColor: string;
  @Column({ default: 0 }) minStock: number;
  @Column({ default: true }) isActive: boolean;
  @OneToMany(() => ProductVariant, (v) => v.product) variants: ProductVariant[];
}

@Entity('product_variants')
@Index(['tenantId', 'sku'], { unique: true })
@Index(['tenantId', 'barcode'], { unique: true })
export class ProductVariant extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Index() @Column('uuid') productId: string;
  @ManyToOne(() => Product, (p) => p.variants, { onDelete: 'CASCADE' }) @JoinColumn() product: Product;
  @Column() sku: string;
  @Column() barcode: string;
  @Column({ nullable: true }) size?: string;
  @Column({ nullable: true }) color?: string;
  @Column({ nullable: true }) colorHex?: string;
  @Column(money) purchasePrice: number;
  @Column(money) mrp: number;
  @Column(money) sellingPrice: number;
  /** overrides product.minStock when set */
  @Column({ type: 'int', nullable: true }) minStock: number | null;
  @Column({ default: 0 }) sortOrder: number;
  @Column({ default: true }) isActive: boolean;
}

@Entity('price_lists')
export class PriceList extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Column() name: string;
  @Column({ default: false }) isDefault: boolean;
  @Column({ default: true }) isActive: boolean;
}

@Entity('product_prices')
@Index(['priceListId', 'variantId'], { unique: true })
export class ProductPrice extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Column('uuid') priceListId: string;
  @Column('uuid') variantId: string;
  @Column(money) price: number;
}
