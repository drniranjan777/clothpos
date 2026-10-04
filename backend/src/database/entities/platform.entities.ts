import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity, money } from '../base';

export const MODULES = ['pos', 'inventory', 'reports', 'customers', 'returns', 'purchases', 'multi_store', 'loyalty', 'whatsapp', 'offline'] as const;
export type ModuleKey = (typeof MODULES)[number];

export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'payment_pending', 'past_due', 'grace', 'suspended', 'expired', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Statuses in which a tenant may create new bills (BRD §8: others are read-only). */
export const BILLABLE_STATUSES: SubscriptionStatus[] = ['trial', 'active', 'payment_pending', 'past_due', 'grace'];

@Entity('subscription_plans')
export class Plan extends BaseEntity {
  @Column() name: string;
  @Index({ unique: true }) @Column() code: string;
  @Column({ nullable: true }) description?: string;
  @Column(money) priceMonthly: number;
  @Column(money) priceYearly: number;
  @Column({ default: 14 }) trialDays: number;
  @Column({ default: 7 }) graceDays: number;
  /** null = unlimited */
  @Column({ type: 'int', nullable: true }) maxStores: number | null;
  @Column({ type: 'int', nullable: true }) maxUsers: number | null;
  @Column({ type: 'int', nullable: true }) maxSkus: number | null;
  @Column({ type: 'int', nullable: true }) maxMonthlyTransactions: number | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) modules: ModuleKey[];
  @Column({ default: 'email' }) supportLevel: string;
  @Column({ default: false }) isPopular: boolean;
  @Column({ default: true }) isActive: boolean;
  @Column({ default: 0 }) sortOrder: number;
}

export interface TenantSettings {
  allowNegativeStock: boolean;
  cashierDiscountLimitPct: number;
  returnWindowDays: number;
  roundOff: boolean;
  invoiceFooter: string;
  receiptWidth: 58 | 80;
  /** loyalty points earned per ₹100 billed (0 disables earning) */
  loyaltyPointsPer100: number;
  /** cash variance (₹) a cashier may close a shift with, without a note */
  cashVarianceTolerance: number;
}
export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  allowNegativeStock: false,
  cashierDiscountLimitPct: 10,
  returnWindowDays: 7,
  roundOff: true,
  invoiceFooter: 'Exchange within 7 days with bill. Thank you, visit again!',
  receiptWidth: 80,
  loyaltyPointsPer100: 1,
  cashVarianceTolerance: 200,
};

@Entity('tenants')
export class Tenant extends BaseEntity {
  @Column() businessName: string;
  @Index({ unique: true }) @Column() code: string;
  @Column() ownerName: string;
  @Column() mobile: string;
  @Column() email: string;
  @Column({ nullable: true }) gstin?: string;
  @Column({ nullable: true }) address?: string;
  @Column({ nullable: true }) city?: string;
  @Column({ nullable: true }) state?: string;
  /** GST state code, e.g. "29" for Karnataka - decides CGST/SGST vs IGST */
  @Column({ nullable: true }) stateCode?: string;
  @Column({ default: 'active' }) status: 'active' | 'suspended' | 'archived';
  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_TENANT_SETTINGS)}'` }) settings: TenantSettings;
  /** per-tenant overrides of plan modules: { loyalty: true } */
  @Column({ type: 'jsonb', default: () => "'{}'" }) featureOverrides: Partial<Record<ModuleKey, boolean>>;
}

@Entity('subscriptions')
export class Subscription extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' }) @JoinColumn() tenant: Tenant;
  @Column('uuid') planId: string;
  @ManyToOne(() => Plan) @JoinColumn() plan: Plan;
  @Column({ default: 'trial' }) status: SubscriptionStatus;
  @Column({ default: 'monthly' }) billingCycle: 'monthly' | 'yearly';
  @Column({ type: 'date' }) startDate: string;
  @Column({ type: 'date' }) endDate: string;
  @Column(money) amount: number;
  @Column({ default: true }) autoRenew: boolean;
  /** only the latest subscription row of a tenant is current */
  @Column({ default: true }) isCurrent: boolean;
}

@Entity('subscription_payments')
export class SubscriptionPayment extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' }) @JoinColumn() tenant: Tenant;
  @Column('uuid') subscriptionId: string;
  @Column(money) amount: number;
  @Column() method: string;
  @Column({ default: 'paid' }) status: 'paid' | 'failed' | 'pending';
  @Column({ nullable: true }) reference?: string;
  @Column({ nullable: true }) failureReason?: string;
  @Column({ type: 'timestamptz', nullable: true }) paidAt?: Date;
}
