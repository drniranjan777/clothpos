import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity, money, rate } from '../base';
import { ProductVariant } from './catalog.entities';
import { Store, User } from './org.entities';

export const INVENTORY_TXN_TYPES = [
  'opening', 'purchase', 'sale', 'sale_cancel', 'return', 'exchange_out',
  'adjustment_damage', 'adjustment_found', 'adjustment_recount', 'transfer_in', 'transfer_out',
] as const;
export type InventoryTxnType = (typeof INVENTORY_TXN_TYPES)[number];

export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'wallet', 'bank', 'store_credit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

@Entity('inventory')
@Index(['storeId', 'variantId'], { unique: true })
export class Inventory extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Column('uuid') storeId: string;
  @Column('uuid') variantId: string;
  @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE' }) @JoinColumn() variant: ProductVariant;
  @Column({ default: 0 }) quantity: number;
}

/** Stock ledger - every movement, never edited (BRD §14). */
@Entity('inventory_transactions')
export class InventoryTransaction extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Index() @Column('uuid') storeId: string;
  @Index() @Column('uuid') variantId: string;
  @ManyToOne(() => ProductVariant) @JoinColumn() variant: ProductVariant;
  @Column() type: InventoryTxnType;
  /** signed: +in / -out */
  @Column() quantity: number;
  @Column() balanceAfter: number;
  @Column({ nullable: true }) referenceType?: string;
  @Column({ nullable: true }) referenceId?: string;
  @Column({ nullable: true }) referenceNo?: string;
  @Column({ nullable: true }) note?: string;
  @Column({ type: 'uuid', nullable: true }) userId: string | null;
  @Column({ nullable: true }) userName?: string;
}

@Entity('customers')
@Index(['tenantId', 'mobile'], { unique: true })
export class Customer extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Column() name: string;
  @Column() mobile: string;
  @Column({ nullable: true }) email?: string;
  @Column({ nullable: true }) address?: string;
  @Column({ nullable: true }) gstin?: string;
  @Column({ type: 'date', nullable: true }) birthday?: string;
  @Column({ default: 0 }) loyaltyPoints: number;
  @Column(money) storeCredit: number;
  @Column({ nullable: true }) notes?: string;
}

@Entity('cashier_shifts')
export class CashierShift extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Index() @Column('uuid') storeId: string;
  @ManyToOne(() => Store) @JoinColumn() store: Store;
  @Index() @Column('uuid') userId: string;
  @ManyToOne(() => User) @JoinColumn() user: User;
  @Column() shiftNo: number;
  @Column({ default: 1 }) counter: number;
  @Column(money) openingCash: number;
  @Column({ type: 'timestamptz' }) openedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) closedAt?: Date;
  @Column({ default: 'open' }) status: 'open' | 'closed' | 'approved';
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: { to: (v) => v, from: (v) => (v == null ? v : Number(v)) } })
  countedCash?: number | null;
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: { to: (v) => v, from: (v) => (v == null ? v : Number(v)) } })
  expectedCash?: number | null;
  @Column({ type: 'jsonb', nullable: true }) denominations?: Record<string, number>;
  @Column({ type: 'jsonb', nullable: true }) summary?: Record<string, unknown>;
  @Column({ nullable: true }) note?: string;
  @Column({ type: 'uuid', nullable: true }) approvedById?: string | null;
}

@Entity('sales')
@Index(['tenantId', 'invoiceNo'], { unique: true })
export class Sale extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Index() @Column('uuid') storeId: string;
  @ManyToOne(() => Store) @JoinColumn() store: Store;
  @Column() invoiceNo: string;
  @Index() @Column({ type: 'uuid', nullable: true }) customerId: string | null;
  @ManyToOne(() => Customer, { nullable: true }) @JoinColumn() customer?: Customer;
  @Column('uuid') cashierId: string;
  @ManyToOne(() => User) @JoinColumn() cashier: User;
  @Column({ type: 'uuid', nullable: true }) shiftId: string | null;
  @Column({ default: 1 }) counter: number;
  @Column({ default: 'completed' }) status: 'completed' | 'cancelled';
  @Column(money) mrpTotal: number;
  /** sum of qty x unit price before any discount */
  @Column(money) grossTotal: number;
  @Column(money) itemDiscount: number;
  @Column(money) billDiscount: number;
  @Column(money) taxableAmount: number;
  @Column(money) cgst: number;
  @Column(money) sgst: number;
  @Column(money) igst: number;
  @Column(money) roundOff: number;
  @Column(money) total: number;
  @Column(money) paidAmount: number;
  @Column(money) changeAmount: number;
  @Column({ default: 0 }) totalQty: number;
  @Column({ default: 0 }) itemCount: number;
  @Column({ default: false }) isInterState: boolean;
  @Column({ default: 0 }) loyaltyEarned: number;
  /** provisional number printed while the POS was offline (e.g. OFF-MG2-0007) */
  @Column({ type: 'varchar', nullable: true }) offlineRef?: string | null;
  /** offline sale synced although stock had already run out - flagged for review */
  @Column({ default: false }) stockConflict: boolean;
  @Column({ nullable: true }) notes?: string;
  @Column({ nullable: true }) cancelReason?: string;
  /** idempotency key from the POS client (offline sync safety) */
  @Index({ unique: true, where: 'client_ref IS NOT NULL' }) @Column({ type: 'varchar', nullable: true }) clientRef?: string | null;
  @OneToMany(() => SaleItem, (i) => i.sale, { cascade: true }) items: SaleItem[];
  @OneToMany(() => SalePayment, (p) => p.sale, { cascade: true }) payments: SalePayment[];
}

@Entity('sale_items')
export class SaleItem extends BaseEntity {
  @Index() @Column('uuid') saleId: string;
  @ManyToOne(() => Sale, (s) => s.items, { onDelete: 'CASCADE' }) @JoinColumn() sale: Sale;
  @Index() @Column('uuid') variantId: string;
  @Column() productName: string;
  @Column() sku: string;
  @Column() barcode: string;
  @Column({ nullable: true }) size?: string;
  @Column({ nullable: true }) color?: string;
  @Column({ nullable: true }) hsnCode?: string;
  @Column() qty: number;
  @Column(money) mrp: number;
  @Column(money) unitPrice: number;
  @Column(money) itemDiscount: number;
  /** share of the bill discount allocated to this line */
  @Column(money) billDiscount: number;
  @Column(rate) gstRate: number;
  @Column(money) taxableAmount: number;
  @Column(money) taxAmount: number;
  @Column(money) lineTotal: number;
  @Column({ default: 0 }) returnedQty: number;
}

@Entity('sale_payments')
export class SalePayment extends BaseEntity {
  @Index() @Column('uuid') saleId: string;
  @ManyToOne(() => Sale, (s) => s.payments, { onDelete: 'CASCADE' }) @JoinColumn() sale: Sale;
  @Column() method: PaymentMethod;
  @Column(money) amount: number;
  @Column(money) tendered: number;
  @Column({ nullable: true }) reference?: string;
}

@Entity('held_bills')
export class HeldBill extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Index() @Column('uuid') storeId: string;
  @Column('uuid') userId: string;
  @Column({ nullable: true }) userName?: string;
  @Column({ nullable: true }) label?: string;
  @Column({ nullable: true }) customerName?: string;
  @Column({ default: 0 }) itemCount: number;
  @Column(money) total: number;
  /** cart snapshot as sent by the POS */
  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;
}

@Entity('sale_returns')
@Index(['tenantId', 'returnNo'], { unique: true })
export class SaleReturn extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Index() @Column('uuid') storeId: string;
  @Column() returnNo: string;
  @Index() @Column('uuid') saleId: string;
  @ManyToOne(() => Sale) @JoinColumn() sale: Sale;
  @Column({ type: 'uuid', nullable: true }) customerId: string | null;
  @Column() type: 'refund' | 'exchange' | 'mixed';
  @Column({ nullable: true }) refundMethod?: 'cash' | 'original' | 'store_credit';
  @Column(money) returnedValue: number;
  @Column(money) exchangeValue: number;
  /** positive = paid back to customer, negative = collected from customer */
  @Column(money) netAmount: number;
  @Column(money) taxReversed: number;
  /** price difference collected from the customer on an exchange */
  @Column({ nullable: true }) collectMethod?: string;
  @Column(money) collectedAmount: number;
  @Column({ nullable: true }) reason?: string;
  @Column('uuid') userId: string;
  @Column({ nullable: true }) userName?: string;
  @Column({ type: 'uuid', nullable: true }) exchangeSaleId?: string | null;
  @OneToMany(() => SaleReturnItem, (i) => i.saleReturn, { cascade: true }) items: SaleReturnItem[];
}

@Entity('sale_return_items')
export class SaleReturnItem extends BaseEntity {
  @Index() @Column('uuid') saleReturnId: string;
  @ManyToOne(() => SaleReturn, (r) => r.items, { onDelete: 'CASCADE' }) @JoinColumn() saleReturn: SaleReturn;
  @Column('uuid') saleItemId: string;
  @Column('uuid') variantId: string;
  @Column() productName: string;
  @Column() sku: string;
  @Column() qty: number;
  @Column(money) amount: number;
  @Column(money) taxAmount: number;
  @Column({ nullable: true }) reason?: string;
  @Column({ type: 'uuid', nullable: true }) exchangeVariantId?: string | null;
  @Column({ nullable: true }) exchangeSku?: string;
}
