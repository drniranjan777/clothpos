import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity, money, rate } from '../base';
import { Store } from './org.entities';

@Entity('suppliers')
export class Supplier extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Column() name: string;
  @Column({ nullable: true }) contactName?: string;
  @Column({ nullable: true }) mobile?: string;
  @Column({ nullable: true }) email?: string;
  @Column({ nullable: true }) gstin?: string;
  @Column({ nullable: true }) address?: string;
  @Column({ nullable: true }) city?: string;
  /** GST state code - decides CGST/SGST vs IGST on purchases */
  @Column({ nullable: true }) stateCode?: string;
  @Column({ default: 30 }) paymentTermsDays: number;
  /** amount owed to the supplier before using the system */
  @Column(money) openingBalance: number;
  @Column({ nullable: true }) notes?: string;
  @Column({ default: true }) isActive: boolean;
}

export type PurchaseStatus = 'draft' | 'received' | 'cancelled';

/** Supplier invoice / goods receipt (BRD §20). Costs are GST-exclusive, as on supplier bills. */
@Entity('purchases')
@Index(['tenantId', 'purchaseNo'], { unique: true })
export class Purchase extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Index() @Column('uuid') storeId: string;
  @ManyToOne(() => Store) @JoinColumn() store: Store;
  @Index() @Column('uuid') supplierId: string;
  @ManyToOne(() => Supplier) @JoinColumn() supplier: Supplier;
  @Column() purchaseNo: string;
  @Column({ nullable: true }) supplierInvoiceNo?: string;
  @Column({ type: 'date', nullable: true }) supplierInvoiceDate?: string | null;
  @Column({ type: 'date', nullable: true }) dueDate?: string | null;
  @Column({ default: 'draft' }) status: PurchaseStatus;
  @Column({ default: false }) isInterState: boolean;
  @Column(money) taxableAmount: number;
  @Column(money) cgst: number;
  @Column(money) sgst: number;
  @Column(money) igst: number;
  @Column(money) otherCharges: number;
  @Column(money) discount: number;
  @Column(money) roundOff: number;
  @Column(money) total: number;
  @Column(money) paidAmount: number;
  @Column({ default: 0 }) totalQty: number;
  @Column({ nullable: true }) notes?: string;
  @Column({ type: 'uuid', nullable: true }) createdById: string | null;
  @Column({ nullable: true }) createdByName?: string;
  @Column({ type: 'timestamptz', nullable: true }) receivedAt?: Date | null;
  @Column({ nullable: true }) receivedByName?: string;
  @Column({ nullable: true }) cancelReason?: string;
  @OneToMany(() => PurchaseItem, (i) => i.purchase, { cascade: true }) items: PurchaseItem[];
}

@Entity('purchase_items')
export class PurchaseItem extends BaseEntity {
  @Index() @Column('uuid') purchaseId: string;
  @ManyToOne(() => Purchase, (p) => p.items, { onDelete: 'CASCADE' }) @JoinColumn() purchase: Purchase;
  @Index() @Column('uuid') variantId: string;
  @Column() productName: string;
  @Column() sku: string;
  @Column({ nullable: true }) size?: string;
  @Column({ nullable: true }) color?: string;
  @Column() qty: number;
  /** cost per piece before GST */
  @Column(money) unitCost: number;
  @Column(rate) gstRate: number;
  @Column(money) taxableAmount: number;
  @Column(money) taxAmount: number;
  @Column(money) lineTotal: number;
}

@Entity('supplier_payments')
export class SupplierPayment extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Index() @Column('uuid') supplierId: string;
  @Column({ type: 'uuid', nullable: true }) purchaseId: string | null;
  @Column(money) amount: number;
  @Column() method: string;
  @Column({ nullable: true }) reference?: string;
  @Column({ type: 'date' }) paidOn: string;
  @Column({ nullable: true }) notes?: string;
  @Column({ type: 'uuid', nullable: true }) userId: string | null;
  @Column({ nullable: true }) userName?: string;
}

export type TransferStatus = 'draft' | 'in_transit' | 'received' | 'cancelled';

/** Store-to-store stock movement: dispatch removes stock at the source, receive adds it at the destination. */
@Entity('stock_transfers')
@Index(['tenantId', 'transferNo'], { unique: true })
export class StockTransfer extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @Column() transferNo: string;
  @Index() @Column('uuid') fromStoreId: string;
  @ManyToOne(() => Store) @JoinColumn() fromStore: Store;
  @Index() @Column('uuid') toStoreId: string;
  @ManyToOne(() => Store) @JoinColumn() toStore: Store;
  @Column({ default: 'draft' }) status: TransferStatus;
  @Column({ default: 0 }) totalQty: number;
  @Column({ nullable: true }) notes?: string;
  @Column({ nullable: true }) createdByName?: string;
  @Column({ type: 'timestamptz', nullable: true }) dispatchedAt?: Date | null;
  @Column({ nullable: true }) dispatchedByName?: string;
  @Column({ type: 'timestamptz', nullable: true }) receivedAt?: Date | null;
  @Column({ nullable: true }) receivedByName?: string;
  @Column({ nullable: true }) cancelReason?: string;
  @OneToMany(() => StockTransferItem, (i) => i.transfer, { cascade: true }) items: StockTransferItem[];
}

@Entity('stock_transfer_items')
export class StockTransferItem extends BaseEntity {
  @Index() @Column('uuid') transferId: string;
  @ManyToOne(() => StockTransfer, (t) => t.items, { onDelete: 'CASCADE' }) @JoinColumn() transfer: StockTransfer;
  @Column('uuid') variantId: string;
  @Column() productName: string;
  @Column() sku: string;
  @Column({ nullable: true }) size?: string;
  @Column({ nullable: true }) color?: string;
  @Column() qty: number;
  /** filled on receipt; a shortfall is written off at the destination as damage / loss */
  @Column({ type: 'int', nullable: true }) receivedQty: number | null;
}
