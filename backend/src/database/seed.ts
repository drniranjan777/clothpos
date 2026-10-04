/**
 * Development seed - DROPS and recreates every table in the configured database, then loads demo data:
 * platform plans + Super Admin, the demo tenant "Vastra Fashions" (2 stores, staff, catalogue, stock,
 * customers, ~45 days of sales history, returns, an open shift, held bills) and a set of other tenants
 * in different subscription states for the Super Admin console.
 *
 *   npm run seed
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import type { AuthUser } from '../common/auth';
import { addDays, ean13, isoDate, startOfDay } from '../common/util';
import { ReturnsService } from '../modules/returns/returns.module';
import { StockService } from '../modules/inventory/stock.service';
import { SalesService } from '../modules/sales/sales.service';
import { PurchasesService } from '../modules/purchases/purchases.module';
import { TransfersService } from '../modules/transfers/transfers.module';
import { SettingsService } from '../modules/settings/settings.module';
import { dataSourceOptions } from './data-source';
import {
  Brand, CashierShift, Category, Color, Customer, HeldBill, Plan, PriceList, Product, ProductPrice, ProductVariant, Sale, Size, Store,
  Subscription, SubscriptionPayment, Tenant, User,
} from './entities';

// deterministic pseudo-random numbers so every seed run produces the same demo
let seedState = 20261004;
const rnd = () => {
  seedState |= 0; seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

export const DEMO_PASSWORDS = { superAdmin: 'Admin@1234', owner: 'Owner@1234', manager: 'Manager@1234', cashier: 'Cashier@1234' };

const COLORS: Record<string, string> = {
  White: '#f8fafc', Black: '#0f172a', Navy: '#1e3a8a', Indigo: '#1e3a8a', Maroon: '#9f1239', Olive: '#4d7c0f', Green: '#15803d',
  Teal: '#0f766e', Pink: '#db2777', Mustard: '#ca8a04', Red: '#dc2626', Blue: '#1e40af', Grey: '#64748b', Charcoal: '#334155',
  Tan: '#b45309', Brown: '#92400e', Beige: '#d6a77a', Purple: '#7c3aed', Gold: '#d4a017', Cream: '#f5f5f4', Orange: '#f59e0b', Lavender: '#a78bfa',
};

interface P { name: string; code: string; cat: string; brand: string; art: string; hsn: string; gst: number; mrp: number; price: number; cost: number; sizes: string[]; colors: string[]; gender?: string; fabric?: string; min?: number }
const APPAREL = ['S', 'M', 'L', 'XL'];
const PRODUCTS: P[] = [
  { name: 'Checked Casual Shirt', code: 'SH-CHK', cat: 'Shirts & Kurtas', brand: 'Vastra Basics', art: 'plaid', hsn: '6205', gst: 5, mrp: 1499, price: 999, cost: 520, sizes: [...APPAREL, '2XL'], colors: ['Maroon', 'Navy', 'Olive'], gender: 'Men', fabric: 'Cotton' },
  { name: 'Oxford Cotton Shirt', code: 'SH-OXF', cat: "Men's Wear", brand: 'Vastra Basics', art: 'shirt', hsn: '6205', gst: 5, mrp: 1799, price: 1299, cost: 640, sizes: ['M', 'L', 'XL', '2XL'], colors: ['Blue', 'White'], gender: 'Men', fabric: 'Cotton' },
  { name: 'Classic Bomber Jacket', code: 'JK-BMB', cat: "Men's Wear", brand: 'North Loom', art: 'jacket', hsn: '6201', gst: 5, mrp: 3299, price: 2499, cost: 1350, sizes: APPAREL, colors: ['Cream', 'Black'], gender: 'Men', fabric: 'Polyester' },
  { name: 'Track Jacket', code: 'JK-TRK', cat: 'Activewear', brand: 'Stride', art: 'jacket', hsn: '6211', gst: 5, mrp: 1999, price: 1299, cost: 610, sizes: ['M', 'L', 'XL'], colors: ['Green', 'Navy'], gender: 'Men', fabric: 'Polyester' },
  { name: 'Cotton Crew T-Shirt', code: 'TS-CRW', cat: 'T-Shirts & Tops', brand: 'Vastra Basics', art: 'tshirt', hsn: '6109', gst: 5, mrp: 599, price: 449, cost: 190, sizes: APPAREL, colors: ['White', 'Black', 'Navy', 'Grey'], gender: 'Unisex', fabric: 'Cotton' },
  { name: 'Graphic Polo Tee', code: 'TS-POL', cat: 'T-Shirts & Tops', brand: 'Urban Denim', art: 'tshirt', hsn: '6109', gst: 5, mrp: 1099, price: 799, cost: 360, sizes: APPAREL, colors: ['Orange', 'Teal'], gender: 'Men', fabric: 'Cotton' },
  { name: 'Slim Fit Denim Jeans', code: 'JN-SLM', cat: 'Jeans & Trousers', brand: 'Urban Denim', art: 'jeans', hsn: '6203', gst: 5, mrp: 2199, price: 1599, cost: 780, sizes: ['30', '32', '34', '36'], colors: ['Indigo', 'Black'], gender: 'Men', fabric: 'Denim' },
  { name: 'Chino Shorts', code: 'SR-CHN', cat: "Men's Wear", brand: 'Urban Denim', art: 'shorts', hsn: '6203', gst: 5, mrp: 1299, price: 899, cost: 420, sizes: ['30', '32', '34'], colors: ['Black', 'Beige'], gender: 'Men', fabric: 'Cotton' },
  { name: 'Cotton Beach Shorts', code: 'SR-BCH', cat: "Men's Wear", brand: 'Vastra Basics', art: 'shorts', hsn: '6203', gst: 5, mrp: 999, price: 699, cost: 300, sizes: APPAREL, colors: ['Red', 'Blue'], gender: 'Men', fabric: 'Cotton' },
  { name: 'Linen Festive Kurta', code: 'KR-LIN', cat: 'Shirts & Kurtas', brand: 'Utsav', art: 'kurta', hsn: '6211', gst: 5, mrp: 2499, price: 1799, cost: 860, sizes: ['M', 'L', 'XL'], colors: ['Teal', 'Maroon', 'Cream'], gender: 'Men', fabric: 'Linen' },
  { name: 'Fleece Pullover Hoodie', code: 'WW-HOD', cat: 'Winter Wear', brand: 'North Loom', art: 'hoodie', hsn: '6110', gst: 5, mrp: 1999, price: 1499, cost: 700, sizes: APPAREL, colors: ['Charcoal', 'Navy'], gender: 'Unisex', fabric: 'Fleece' },
  { name: 'Wool Blend Overcoat', code: 'WW-OVC', cat: 'Winter Wear', brand: 'North Loom', art: 'jacket', hsn: '6201', gst: 18, mrp: 5999, price: 4499, cost: 2400, sizes: ['M', 'L', 'XL'], colors: ['Brown', 'Charcoal'], gender: 'Men', fabric: 'Wool blend', min: 2 },
  { name: 'Floral Midi Dress', code: 'DR-FLR', cat: 'Dresses & Ethnic Wear', brand: 'Bloom', art: 'dress', hsn: '6204', gst: 5, mrp: 2499, price: 1799, cost: 820, sizes: ['S', 'M', 'L'], colors: ['Pink', 'Mustard'], gender: 'Women', fabric: 'Rayon' },
  { name: 'Rayon A-Line Kurti', code: 'KT-ALN', cat: "Women's Wear", brand: 'Utsav', art: 'kurta', hsn: '6211', gst: 5, mrp: 1299, price: 899, cost: 380, sizes: ['S', 'M', 'L', 'XL'], colors: ['Lavender', 'Mustard', 'Red'], gender: 'Women', fabric: 'Rayon' },
  { name: 'Banarasi Silk Saree', code: 'SR-BNR', cat: 'Dresses & Ethnic Wear', brand: 'Utsav', art: 'saree', hsn: '5007', gst: 18, mrp: 6999, price: 5499, cost: 3100, sizes: ['Free'], colors: ['Purple', 'Maroon', 'Green'], gender: 'Women', fabric: 'Silk', min: 2 },
  { name: "Women's Skinny Jeans", code: 'JN-SKN', cat: "Women's Wear", brand: 'Urban Denim', art: 'jeans', hsn: '6204', gst: 5, mrp: 1999, price: 1499, cost: 700, sizes: ['26', '28', '30', '32'], colors: ['Blue', 'Black'], gender: 'Women', fabric: 'Denim' },
  { name: 'Ribbed Crop Top', code: 'TP-CRP', cat: 'T-Shirts & Tops', brand: 'Bloom', art: 'tshirt', hsn: '6109', gst: 5, mrp: 799, price: 549, cost: 220, sizes: ['XS', 'S', 'M', 'L'], colors: ['Black', 'Pink', 'Cream'], gender: 'Women', fabric: 'Cotton' },
  { name: 'Dry-Fit Running Tee', code: 'AC-RUN', cat: 'Activewear', brand: 'Stride', art: 'tshirt', hsn: '6109', gst: 5, mrp: 999, price: 699, cost: 300, sizes: APPAREL, colors: ['Blue', 'Black', 'Orange'], gender: 'Unisex', fabric: 'Polyester' },
  { name: 'Jogger Track Pants', code: 'AC-JOG', cat: 'Activewear', brand: 'Stride', art: 'jeans', hsn: '6103', gst: 5, mrp: 1499, price: 999, cost: 450, sizes: APPAREL, colors: ['Black', 'Grey'], gender: 'Unisex', fabric: 'Cotton blend' },
  { name: 'Leather Oxford Shoes', code: 'FW-OXF', cat: 'Footwear', brand: 'Stride', art: 'shoe', hsn: '6403', gst: 5, mrp: 3499, price: 2499, cost: 1300, sizes: ['UK 7', 'UK 8', 'UK 9', 'UK 10'], colors: ['Tan', 'Black'], gender: 'Men', fabric: 'Leather' },
  { name: 'Block Heel Sandals', code: 'FW-BHS', cat: 'Footwear', brand: 'Bloom', art: 'heels', hsn: '6402', gst: 5, mrp: 1899, price: 1399, cost: 650, sizes: ['UK 4', 'UK 5', 'UK 6', 'UK 7'], colors: ['Beige', 'Black'], gender: 'Women' },
  { name: 'Kundan Pendant Set', code: 'JW-KND', cat: 'Jewellery', brand: 'Aabha', art: 'jewel', hsn: '7117', gst: 3, mrp: 1299, price: 899, cost: 380, sizes: ['Free'], colors: ['Red', 'Green'], gender: 'Women' },
  { name: 'Oxidised Jhumka Earrings', code: 'JW-JHM', cat: 'Jewellery', brand: 'Aabha', art: 'jewel', hsn: '7117', gst: 3, mrp: 599, price: 399, cost: 140, sizes: ['Free'], colors: ['Grey'], gender: 'Women' },
  { name: 'Vegan Leather Tote', code: 'AC-TOT', cat: 'Fashion Add-ons', brand: 'Carry Co.', art: 'bag', hsn: '4202', gst: 18, mrp: 1799, price: 1199, cost: 560, sizes: ['Free'], colors: ['Brown', 'Black'], gender: 'Women' },
  { name: 'Festive Nehru Jacket', code: 'SC-NHR', cat: 'Seasonal Collections', brand: 'Utsav', art: 'jacket', hsn: '6211', gst: 5, mrp: 2999, price: 2199, cost: 1050, sizes: ['M', 'L', 'XL'], colors: ['Gold', 'Maroon'], gender: 'Men', fabric: 'Jacquard' },
  { name: 'Cotton Summer Shirt', code: 'SH-SUM', cat: "Men's Wear", brand: 'Vastra Basics', art: 'shirt', hsn: '6205', gst: 5, mrp: 1399, price: 949, cost: 430, sizes: APPAREL, colors: ['Beige', 'Teal'], gender: 'Men', fabric: 'Cotton' },
];

const CATEGORIES = ["Men's Wear", "Women's Wear", 'Dresses & Ethnic Wear', 'T-Shirts & Tops', 'Shirts & Kurtas', 'Jeans & Trousers', 'Winter Wear', 'Activewear', 'Footwear', 'Jewellery', 'Fashion Add-ons', 'Seasonal Collections'];
const SIZE_MASTER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '26', '28', '30', '32', '34', '36', 'UK 4', 'UK 5', 'UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'Free'];

const CUSTOMERS: [string, string, string?][] = [
  ['Vijay Sharma', '9876543210'], ['Meera Krishnan', '9900122334'], ['Arjun Nair', '9845011782'], ['Shreya Trends', '8012345678', '29AAKFS4321L1Z8'],
  ['Rohan Patel', '9739155620'], ['Fatima Ali', '9986034120'], ['Karthik Das', '9008077341'], ['Neha Iyer', '9886120419'], ['Sanjay Gupta', '9945281730'],
  ['Divya Menon', '9740466218'], ['Ananya Reddy', '9611023456'], ['Mumbai Fashion Mart', '9820098200', '27AABCM1234D1Z2'], ['Kiran Rao', '9535012345'], ['Pooja Shetty', '9449012345'],
  ['Rahul Verma', '9741100221'], ['Sneha Kulkarni', '9845522310'], ['Imran Sheikh', '9886033442'], ['Lakshmi Iyengar', '9902144553'], ['Deepak Joshi', '9535255664'],
  ['Priyanka Das', '9620366775'], ['Mohammed Rafi', '9731477886'], ['Asha Pillai', '9844588997'], ['Varun Hegde', '9008699008'], ['Nisha Agarwal', '9741700119'],
  ['Gaurav Malhotra', '9886811220'], ['Ritu Saxena', '9945922331'], ['Suresh Babu', '9448033442'], ['Kavya Gowda', '9611144553'], ['Tanvi Shah', '9902255664'],
  ['Abdul Kareem', '9535366775'], ['Bhavana Rao', '9620477886'], ['Chetan Kumar', '9731588997'], ['Farah Khan', '9844699008'], ['Harsha Vardhan', '9008700119'],
];

/** Drops every table, then rebuilds the schema from the migrations (same path as production). */
async function resetSchema() {
  const ds = new DataSource({ ...dataSourceOptions, synchronize: false, migrationsRun: false, logging: false });
  await ds.initialize();
  await ds.dropDatabase();
  const ran = await ds.runMigrations();
  console.log(`> schema rebuilt from ${ran.length} migration(s)`);
  await ds.destroy();
}

async function main() {
  console.log('> resetting schema in database', dataSourceOptions.database);
  await resetSchema();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const ds = app.get(DataSource);
  const sales = app.get(SalesService);
  const returns = app.get(ReturnsService);
  const stock = app.get(StockService);
  const purchasesSvc = app.get(PurchasesService);
  const transfersSvc = app.get(TransfersService);
  const settingsSvc = app.get(SettingsService);
  const hash = (p: string) => bcrypt.hash(p, 10);
  const today = startOfDay();

  // ---------------- platform
  const plans = await ds.getRepository(Plan).save([
    { name: 'Starter', code: 'starter', description: 'Single-counter boutiques', priceMonthly: 999, priceYearly: 9990, trialDays: 14, graceDays: 7, maxStores: 1, maxUsers: 3, maxSkus: 2000, maxMonthlyTransactions: 5000, modules: ['pos', 'inventory', 'reports', 'customers', 'returns', 'offline'], supportLevel: 'Email', sortOrder: 1 },
    { name: 'Professional', code: 'professional', description: 'Growing multi-counter stores', priceMonthly: 2499, priceYearly: 24990, trialDays: 14, graceDays: 7, maxStores: 5, maxUsers: 25, maxSkus: 10000, maxMonthlyTransactions: 25000, modules: ['pos', 'inventory', 'reports', 'customers', 'returns', 'offline', 'purchases', 'multi_store'], supportLevel: 'Email + Chat', isPopular: true, sortOrder: 2 },
    { name: 'Enterprise', code: 'enterprise', description: 'Chains & franchise networks', priceMonthly: 9999, priceYearly: 99990, trialDays: 0, graceDays: 15, maxStores: null, maxUsers: null, maxSkus: null, maxMonthlyTransactions: null, modules: ['pos', 'inventory', 'reports', 'customers', 'returns', 'offline', 'purchases', 'multi_store', 'loyalty', 'whatsapp'], supportLevel: 'Phone · 4h SLA', sortOrder: 3 },
  ] as Partial<Plan>[]);
  const [starter, pro, enterprise] = plans;
  await ds.getRepository(User).save({ tenantId: null, name: 'Platform Admin', email: 'admin@clothpos.in', mobile: '9000000001', passwordHash: await hash(DEMO_PASSWORDS.superAdmin), role: 'super_admin', stores: [] });

  // ---------------- demo tenant
  const tenant = await ds.getRepository(Tenant).save({
    businessName: 'Vastra Fashions', code: 'VASTRA', ownerName: 'Anita Rao', mobile: '9845012345', email: 'anita@vastrafashions.in',
    gstin: '29ABCDE1234F1Z5', address: '42, MG Road', city: 'Bengaluru', state: 'Karnataka', stateCode: '29', status: 'active', createdAt: new Date('2025-03-18'),
  } as Partial<Tenant>);
  const tid = tenant.id;
  const subStart = new Date('2025-11-12');
  await ds.getRepository(Subscription).save([
    { tenantId: tid, planId: starter.id, status: 'cancelled', billingCycle: 'monthly', startDate: '2025-03-18', endDate: '2025-08-02', amount: 999, isCurrent: false },
    { tenantId: tid, planId: pro.id, status: 'active', billingCycle: 'yearly', startDate: isoDate(subStart), endDate: isoDate(addDays(today, 39)), amount: 24990, isCurrent: true },
  ] as Partial<Subscription>[]);
  // saved one by one so the flagship store is the oldest (default selection in the app)
  const mg = await ds.getRepository(Store).save({ tenantId: tid, name: 'MG Road Store', code: 'MG', invoicePrefix: 'MG', address: '42, MG Road, Bengaluru 560001', phone: '080-41234567', stateCode: '29', counters: 3, createdAt: new Date('2025-03-18') } as Partial<Store>);
  const inr = await ds.getRepository(Store).save({ tenantId: tid, name: 'Indiranagar Store', code: 'IN', invoicePrefix: 'IN', address: '100 Feet Road, Indiranagar, Bengaluru 560038', phone: '080-42345678', stateCode: '29', counters: 2, createdAt: new Date('2025-09-01') } as Partial<Store>);
  const staff = await ds.getRepository(User).save([
    { tenantId: tid, name: 'Anita Rao', email: 'anita@vastrafashions.in', mobile: '9845012345', role: 'tenant_admin', passwordHash: await hash(DEMO_PASSWORDS.owner), stores: [mg, inr] },
    { tenantId: tid, name: 'Priya S.', email: 'priya@vastrafashions.in', mobile: '9845000002', role: 'store_manager', passwordHash: await hash(DEMO_PASSWORDS.manager), stores: [mg] },
    { tenantId: tid, name: 'Vijay Kumar', email: 'vijay@vastrafashions.in', mobile: '9876500001', role: 'cashier', passwordHash: await hash(DEMO_PASSWORDS.cashier), stores: [mg] },
    { tenantId: tid, name: 'Rahul M.', email: 'rahul@vastrafashions.in', mobile: '9876500002', role: 'cashier', passwordHash: await hash(DEMO_PASSWORDS.cashier), stores: [mg] },
    { tenantId: tid, name: 'Sneha P.', email: 'sneha@vastrafashions.in', mobile: '9876500003', role: 'cashier', passwordHash: await hash(DEMO_PASSWORDS.cashier), stores: [inr] },
    { tenantId: tid, name: 'Imran K.', email: 'imran@vastrafashions.in', mobile: '9876500004', role: 'store_manager', passwordHash: await hash(DEMO_PASSWORDS.manager), stores: [inr] },
  ] as Partial<User>[]);
  const claims = (u: User, stores: Store[]): AuthUser => ({ sub: u.id, name: u.name, role: u.role, tenantId: tid, storeIds: stores.map((s) => s.id) });
  const owner = claims(staff[0], [mg, inr]);
  const priya = claims(staff[1], [mg]);
  const cashiers = { MG: [claims(staff[2], [mg]), claims(staff[3], [mg]), priya], IN: [claims(staff[4], [inr]), claims(staff[5], [inr])] };

  // ---------------- catalogue
  const cats = await ds.getRepository(Category).save(CATEGORIES.map((name, i) => ({ tenantId: tid, name, sortOrder: i + 1, parentId: null })));
  const brandNames = [...new Set(PRODUCTS.map((p) => p.brand))];
  const brands = await ds.getRepository(Brand).save(brandNames.map((name) => ({ tenantId: tid, name })));
  await ds.getRepository(Size).save(SIZE_MASTER.map((name, i) => ({ tenantId: tid, name, sortOrder: i })));
  await ds.getRepository(Color).save(Object.entries(COLORS).map(([name, hex]) => ({ tenantId: tid, name, hex })));
  const [retail, festive, wholesale] = await ds.getRepository(PriceList).save([
    { tenantId: tid, name: 'Retail – MRP inclusive GST', isDefault: true },
    { tenantId: tid, name: 'Festive Sale (Diwali)' },
    { tenantId: tid, name: 'Wholesale (10+ pcs)' },
  ]);
  void retail;

  let barcodeSeq = 1;
  const variants: (ProductVariant & { productName: string; special?: 'low' | 'out' })[] = [];
  for (const def of PRODUCTS) {
    const product = await ds.getRepository(Product).save({
      tenantId: tid, name: def.name, code: def.code, categoryId: cats.find((c) => c.name === def.cat)!.id, brandId: brands.find((b) => b.name === def.brand)!.id,
      gender: def.gender, season: 'AW-26', fabric: def.fabric, hsnCode: def.hsn, gstRate: def.gst, artType: def.art,
      artColor: COLORS[def.colors[0]], minStock: def.min ?? 4,
    } as Partial<Product>);
    let order = 0;
    for (const color of def.colors) {
      for (const size of def.sizes) {
        const v = await ds.getRepository(ProductVariant).save({
          tenantId: tid, productId: product.id, sku: `${def.code}-${color.slice(0, 3).toUpperCase()}-${size.replace(/\s/g, '')}`,
          barcode: ean13('8901234' + String(barcodeSeq++).padStart(5, '0')), size, color, colorHex: COLORS[color],
          purchasePrice: def.cost, mrp: def.mrp, sellingPrice: def.price, sortOrder: order++,
        } as Partial<ProductVariant>);
        variants.push(Object.assign(v, { productName: def.name }));
      }
    }
  }
  // festive & wholesale price lists
  await ds.getRepository(ProductPrice).save(variants.map((v) => ({ tenantId: tid, priceListId: wholesale.id, variantId: v.id, price: Math.round(v.sellingPrice * 0.78) })));

  // a few SKUs are deliberately low / out of stock so alerts have something to show
  const specials: Record<string, 'low' | 'out'> = {
    'SH-OXF-BLU-2XL': 'out', 'WW-HOD-CHA-XL': 'out', 'JW-KND-RED-Free': 'out', 'KR-LIN-TEA-L': 'low', 'SH-OXF-BLU-M': 'low',
    'DR-FLR-PIN-L': 'low', 'WW-OVC-BRO-M': 'low', 'FW-OXF-TAN-UK10': 'low', 'SH-CHK-MAR-2XL': 'low',
  };
  for (const v of variants) v.special = specials[v.sku];

  console.log(`> ${PRODUCTS.length} products, ${variants.length} variants - loading opening stock`);
  const openingAt = addDays(today, -50);
  for (const store of [mg, inr]) {
    await ds.transaction(async (em) => {
      for (const v of variants) {
        const qty = v.special === 'out' ? 0 : v.special === 'low' ? int(2, 3) + (store === mg ? 0 : 1) : store === mg ? int(30, 60) : int(18, 36);
        if (qty > 0) await stock.move(em, { tenantId: tid, storeId: store.id, variantId: v.id, qty, type: 'opening', referenceType: 'opening', referenceNo: 'OPENING-STOCK' }, owner, openingAt);
      }
    });
  }

  const customers = await ds.getRepository(Customer).save(CUSTOMERS.map(([name, mobile, gstin], i) => ({
    tenantId: tid, name, mobile, gstin, email: gstin ? undefined : `${name.split(' ')[0].toLowerCase()}@mail.com`,
    createdAt: addDays(today, -int(20, 300)), storeCredit: i === 0 ? 350 : 0,
  } as Partial<Customer>)));

  // ---------------- sales history (through the real billing service)
  const sellable = variants.filter((v) => !v.special);
  const popular = sellable.filter((v) => ['TS-CRW', 'JN-SLM', 'SH-CHK', 'DR-FLR', 'KT-ALN'].some((c) => v.sku.startsWith(c)));
  const makeSale = async (cashier: AuthUser, store: Store, at: Date) => {
    const lines = int(1, 4);
    const items = new Map<string, number>();
    for (let i = 0; i < lines; i++) {
      const v = rnd() < 0.45 ? pick(popular) : pick(sellable);
      items.set(v.id, (items.get(v.id) ?? 0) + (rnd() < 0.15 ? 2 : 1));
    }
    const subtotal = [...items].reduce((s, [id, q]) => s + variants.find((v) => v.id === id)!.sellingPrice * q, 0);
    const discount = rnd() < 0.2 ? { type: 'flat' as const, value: Math.min(Math.round((subtotal * int(2, 8)) / 100 / 10) * 10, 500) } : undefined;
    const withCustomer = rnd() < 0.35;
    const pool = rnd() < 0.5 ? customers.slice(0, 8) : customers;
    const customer = withCustomer ? pick(pool.filter((c) => !c.gstin || rnd() < 0.3)) : undefined;
    // the service decides the total; pay it with a realistic method mix
    const est = Math.round(subtotal - (discount?.value ?? 0));
    const roll = rnd();
    const payments = roll < 0.48 ? [{ method: 'upi' as const, amount: est, reference: `UTR${int(100000, 999999)}` }]
      : roll < 0.8 ? [{ method: 'cash' as const, amount: est, tendered: Math.ceil(est / 100) * 100 }]
      : roll < 0.94 ? [{ method: 'card' as const, amount: est, reference: `XX${int(1000, 9999)}` }]
      : [{ method: 'upi' as const, amount: Math.round(est * 0.6) }, { method: 'cash' as const, amount: est - Math.round(est * 0.6), tendered: Math.ceil((est - Math.round(est * 0.6)) / 100) * 100 }];
    try {
      return await sales.create(cashier, { storeId: store.id, items: [...items].map(([variantId, qty]) => ({ variantId, qty })), billDiscount: discount, customerId: customer?.id, payments }, at);
    } catch (e) {
      return null; // e.g. a variant ran out of stock in this store - skip that bill
    }
  };

  console.log('> generating 45 days of sales history');
  let created = 0;
  for (let d = 45; d >= 1; d--) {
    const day = addDays(today, -d);
    const weekend = [0, 6].includes(day.getDay());
    for (const [code, store] of [['MG', mg], ['IN', inr]] as const) {
      const bills = (code === 'MG' ? int(9, 15) : int(5, 9)) + (weekend ? int(3, 6) : 0);
      for (let b = 0; b < bills; b++) {
        const at = new Date(day);
        at.setHours(int(10, 20), int(0, 59), int(0, 59));
        if (await makeSale(pick(cashiers[code]), store, at)) created++;
      }
    }
  }
  console.log(`> ${created} historical invoices`);

  // ---------------- today: Vijay's open shift at counter 2 + a few bills
  const vijay = cashiers.MG[0];
  const opened = new Date(today); opened.setHours(9, 2, 0);
  const shift = await ds.getRepository(CashierShift).save({ tenantId: tid, storeId: mg.id, userId: vijay.sub, shiftNo: 142, counter: 2, openingCash: 5000, openedAt: opened, status: 'open' } as Partial<CashierShift>);
  const now = new Date();
  const todays = Math.max(4, Math.min(14, now.getHours() - 9));
  for (let i = 0; i < todays; i++) {
    const at = new Date(opened.getTime() + ((now.getTime() - opened.getTime()) * (i + 1)) / (todays + 1));
    await makeSale(vijay, mg, at);
    if (i % 2 === 0) await makeSale(cashiers.IN[0], inr, at);
  }
  // closed shifts from yesterday (with a small cash variance) for the reports
  const y = addDays(today, -1);
  await ds.getRepository(CashierShift).save([
    { tenantId: tid, storeId: mg.id, userId: cashiers.MG[1].sub, shiftNo: 140, counter: 3, openingCash: 5000, openedAt: new Date(y.getTime() + 9 * 36e5), closedAt: new Date(y.getTime() + 21 * 36e5), status: 'approved', countedCash: 21380, expectedCash: 21500, summary: { variance: -120 } },
    { tenantId: tid, storeId: inr.id, userId: cashiers.IN[0].sub, shiftNo: 141, counter: 1, openingCash: 3000, openedAt: new Date(y.getTime() + 10 * 36e5), closedAt: new Date(y.getTime() + 21 * 36e5), status: 'closed', countedCash: 14260, expectedCash: 14260, summary: { variance: 0 } },
  ] as Partial<CashierShift>[]);

  // ---------------- a few returns / exchanges from the last days
  const recent = await ds.getRepository(Sale).find({ where: { tenantId: tid, storeId: mg.id, status: 'completed' }, relations: { items: true }, order: { createdAt: 'DESC' }, take: 40 });
  const withCustomer = recent.filter((s) => s.customerId && s.createdAt < addDays(now, -1));
  for (const [i, s] of withCustomer.slice(0, 3).entries()) {
    const line = s.items[0];
    const sameProduct = variants.find((v) => v.productName === line.productName && v.color === line.color && v.size !== line.size && !v.special);
    try {
      await returns.create(priya, {
        saleId: s.id, refundMethod: 'store_credit', reason: i === 1 ? 'Size issue' : 'Customer changed mind',
        items: [{ saleItemId: line.id, qty: 1, reason: i === 1 ? 'Size issue' : 'Did not like', exchangeVariantId: i === 1 && sameProduct ? sameProduct.id : undefined }],
      });
    } catch (e) {
      console.warn('  return skipped:', (e as Error).message);
    }
  }

  // held bills waiting at MG Road
  await ds.getRepository(HeldBill).save([
    { tenantId: tid, storeId: mg.id, userId: vijay.sub, userName: vijay.name, label: 'Lady in red saree - trying kurtis', customerName: 'Walk-in', itemCount: 2, total: 1798, payload: { items: [] } },
    { tenantId: tid, storeId: mg.id, userId: vijay.sub, userName: vijay.name, label: 'Arjun - waiting for size 34', customerName: 'Arjun Nair', itemCount: 1, total: 1599, payload: { items: [] } },
  ]);
  // Vastra's own subscription payments
  await ds.getRepository(SubscriptionPayment).save([
    { tenantId: tid, subscriptionId: (await ds.getRepository(Subscription).findOneByOrFail({ tenantId: tid, isCurrent: true })).id, amount: 24990, method: 'upi_autopay', status: 'paid', reference: 'RZP-VF-2511', paidAt: subStart },
  ] as Partial<SubscriptionPayment>[]);

  // ---------------- Phase 2: suppliers, purchase bills with dues, store transfers, a festive price rule
  console.log('> suppliers, purchases and transfers');
  const supplierDefs = [
    { name: 'Urban Denim Mills', contactName: 'Sameer Kapoor', mobile: '9820011223', gstin: '27AAACU1234M1Z5', city: 'Mumbai', paymentTermsDays: 45 },
    { name: 'Vastra Basics Garments', contactName: 'Lakshmi N.', mobile: '9845011223', gstin: '29AABCV5678K1Z2', city: 'Bengaluru', paymentTermsDays: 30 },
    { name: 'Utsav Ethnic House', contactName: 'Mohan Lal', mobile: '9414011223', gstin: '08AAFCU9012P1Z9', city: 'Jaipur', paymentTermsDays: 30, openingBalance: 18500 },
    { name: 'Stride Footwear Co.', contactName: 'Anil Rao', mobile: '9884011223', gstin: '33AADCS3456Q1Z1', city: 'Chennai', paymentTermsDays: 15 },
  ];
  const suppliers = [] as { id: string; name: string }[];
  for (const d of supplierDefs) suppliers.push(await purchasesSvc.createSupplier(owner, d));
  const byCode = (prefix: string) => variants.filter((v) => v.sku.startsWith(prefix) && !v.special);
  const line = (prefix: string, qty: number) => byCode(prefix).slice(0, 4).map((v) => ({ variantId: v.id, qty, unitCost: v.purchasePrice }));
  const bills = [
    { supplier: 0, items: line('JN-SLM', 12), invoice: 'UDM/2026/1184', receive: true, paid: 1 },
    { supplier: 1, items: [...line('TS-CRW', 20), ...line('SH-CHK', 10)], invoice: 'VBG-7741', receive: true, paid: 0.5 },
    { supplier: 2, items: line('KR-LIN', 8), invoice: 'UEH-552', receive: true, paid: 0 },
    { supplier: 3, items: line('FW-OXF', 6), invoice: 'SFC-0931', receive: false, paid: 0 },
  ];
  for (const b of bills) {
    const p = await purchasesSvc.create(owner, { storeId: mg.id, supplierId: suppliers[b.supplier].id, supplierInvoiceNo: b.invoice, supplierInvoiceDate: isoDate(addDays(today, -int(5, 25))), items: b.items, otherCharges: 350, receive: b.receive });
    if (b.paid > 0) await purchasesSvc.pay(owner, suppliers[b.supplier].id, { amount: Math.round(p.total * b.paid), method: 'bank', reference: `NEFT${int(10000, 99999)}`, purchaseId: p.id });
  }
  // MG Road sends fast movers to Indiranagar: one received, one still on the way
  const t1 = await transfersSvc.create(owner, { fromStoreId: mg.id, toStoreId: inr.id, items: byCode('DR-FLR').slice(0, 3).map((v) => ({ variantId: v.id, qty: 4 })), notes: 'Weekend demand at Indiranagar', dispatch: true });
  await transfersSvc.receive(owner, t1.id, { items: t1.items.map((i) => ({ itemId: i.id, receivedQty: i.qty })) });
  await transfersSvc.create(owner, { fromStoreId: mg.id, toStoreId: inr.id, items: byCode('TS-CRW').slice(0, 4).map((v) => ({ variantId: v.id, qty: 6 })), notes: 'Restock basics', dispatch: true });
  // the Festive list gets a rule-based 10% off, ending in 9
  await settingsSvc.applyRule(owner, festive.id, { basis: 'selling', percentOff: 10, roundTo9: true });

  // ---------------- other tenants for the Super Admin console
  const others: { name: string; owner: string; city: string; plan: Plan; status: Subscription['status']; cycle: 'monthly' | 'yearly'; ageDays: number; endIn: number; stores: number; tenantStatus?: Tenant['status']; failed?: string }[] = [
    { name: 'Kurta Kraft', owner: 'Rakesh Jain', city: 'Jaipur', plan: pro, status: 'trial', cycle: 'monthly', ageDays: 0, endIn: 14, stores: 2 },
    { name: 'Little Threads Kids', owner: 'Pooja Desai', city: 'Pune', plan: starter, status: 'active', cycle: 'yearly', ageDays: 1, endIn: 364, stores: 1 },
    { name: 'Saree Sansaar', owner: 'Kavita Mishra', city: 'Varanasi', plan: enterprise, status: 'grace', cycle: 'monthly', ageDays: 2, endIn: -3, stores: 6, failed: 'UPI mandate failed' },
    { name: 'Denim Dock', owner: 'Arun Kumar', city: 'Chennai', plan: starter, status: 'trial', cycle: 'monthly', ageDays: 3, endIn: 11, stores: 1 },
    { name: 'Royal Sherwani', owner: 'Syed Ahmed', city: 'Hyderabad', plan: pro, status: 'active', cycle: 'yearly', ageDays: 4, endIn: 361, stores: 4 },
    { name: 'Style Street', owner: 'Manoj Shetty', city: 'Mangaluru', plan: pro, status: 'past_due', cycle: 'monthly', ageDays: 210, endIn: 2, stores: 2, failed: 'Card declined' },
    { name: 'Ethnic Elegance', owner: 'Zoya Khan', city: 'Lucknow', plan: starter, status: 'suspended', cycle: 'monthly', ageDays: 160, endIn: -20, stores: 1, tenantStatus: 'suspended', failed: 'NEFT not received' },
    { name: 'Fashion Hub', owner: 'Deepak Verma', city: 'Indore', plan: pro, status: 'active', cycle: 'monthly', ageDays: 330, endIn: 2, stores: 3 },
    { name: 'Groom Wear', owner: 'Harish B.', city: 'Mysuru', plan: starter, status: 'active', cycle: 'monthly', ageDays: 250, endIn: 4, stores: 1 },
    { name: 'Trendy Tots', owner: 'Lata N.', city: 'Kochi', plan: starter, status: 'active', cycle: 'monthly', ageDays: 120, endIn: 5, stores: 1 },
    { name: 'Nari Boutique', owner: 'Smita Joshi', city: 'Nagpur', plan: pro, status: 'active', cycle: 'monthly', ageDays: 290, endIn: 6, stores: 2 },
    { name: 'Urban Thread Co.', owner: 'Nikhil Arora', city: 'Delhi', plan: enterprise, status: 'active', cycle: 'yearly', ageDays: 340, endIn: 25, stores: 9 },
    { name: 'Silk Route', owner: 'Gayatri Iyer', city: 'Kanchipuram', plan: pro, status: 'active', cycle: 'yearly', ageDays: 200, endIn: 165, stores: 3 },
    { name: 'Chikan Corner', owner: 'Farhan Siddiqui', city: 'Lucknow', plan: starter, status: 'active', cycle: 'monthly', ageDays: 90, endIn: 18, stores: 1 },
    { name: 'Wedding Vows', owner: 'Ritu Malhotra', city: 'Amritsar', plan: pro, status: 'active', cycle: 'monthly', ageDays: 150, endIn: 21, stores: 2 },
    { name: 'Bandhani Bazaar', owner: 'Hetal Shah', city: 'Ahmedabad', plan: starter, status: 'expired', cycle: 'monthly', ageDays: 40, endIn: -26, stores: 1 },
  ];
  const ownerHash = await hash(DEMO_PASSWORDS.owner);
  for (const [i, o] of others.entries()) {
    const createdAt = addDays(now, -o.ageDays);
    const slug = o.name.toLowerCase().replace(/[^a-z]/g, '');
    const t = await ds.getRepository(Tenant).save({
      businessName: o.name, code: slug.slice(0, 10).toUpperCase(), ownerName: o.owner, mobile: `98${String(10000000 + i * 7919).slice(0, 8)}`,
      email: `owner@${slug}.in`, city: o.city, state: '', status: o.tenantStatus ?? 'active', createdAt,
    } as Partial<Tenant>);
    const st = await ds.getRepository(Store).save(Array.from({ length: o.stores }, (_, k) => ({
      tenantId: t.id, name: k === 0 ? `${o.city} Main` : `${o.city} Branch ${k}`, code: k === 0 ? 'MN' : `B${k}`, invoicePrefix: k === 0 ? 'MN' : `B${k}`,
    })) as Partial<Store>[]);
    await ds.getRepository(User).save({ tenantId: t.id, name: o.owner, email: `owner@${slug}.in`, role: 'tenant_admin', passwordHash: ownerHash, stores: st } as Partial<User>);
    const amount = o.cycle === 'yearly' ? o.plan.priceYearly : o.plan.priceMonthly;
    const end = addDays(today, o.endIn);
    const start = o.status === 'trial' ? createdAt : addDays(end, o.cycle === 'yearly' ? -365 : -30);
    const sub = await ds.getRepository(Subscription).save({
      tenantId: t.id, planId: o.plan.id, status: o.status, billingCycle: o.cycle, startDate: isoDate(start), endDate: isoDate(end), amount, isCurrent: true,
    } as Partial<Subscription>);
    if (o.status !== 'trial') {
      // payment history: one row per paid period since signup
      const step = o.cycle === 'yearly' ? 365 : 30;
      for (let at = addDays(createdAt, o.plan.trialDays); at <= now; at = addDays(at, step)) {
        const isLastFailed = o.failed && addDays(at, step) > now;
        await ds.getRepository(SubscriptionPayment).save({
          tenantId: t.id, subscriptionId: sub.id, amount, method: pick(['upi_autopay', 'card', 'netbanking']),
          status: isLastFailed ? 'failed' : 'paid', failureReason: isLastFailed ? o.failed : undefined,
          reference: `RZP-${slug.slice(0, 4).toUpperCase()}-${int(1000, 9999)}`, paidAt: isLastFailed ? undefined : at, createdAt: at,
        } as Partial<SubscriptionPayment>);
      }
    }
  }

  const [{ n: invoices }] = await ds.query('SELECT COUNT(*)::int n FROM sales');
  console.log(`> done: ${invoices} invoices, ${others.length + 1} tenants, shift #${shift.shiftNo} open for ${vijay.name}`);
  console.log('\nDemo logins');
  console.log(`  Super Admin   admin@clothpos.in          ${DEMO_PASSWORDS.superAdmin}`);
  console.log(`  Owner         anita@vastrafashions.in    ${DEMO_PASSWORDS.owner}`);
  console.log(`  Manager       priya@vastrafashions.in    ${DEMO_PASSWORDS.manager}`);
  console.log(`  Cashier       vijay@vastrafashions.in    ${DEMO_PASSWORDS.cashier}`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
