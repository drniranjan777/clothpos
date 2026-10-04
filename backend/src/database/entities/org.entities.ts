import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base';
import { Tenant } from './platform.entities';

export const ROLES = ['super_admin', 'tenant_admin', 'store_manager', 'cashier', 'inventory_user', 'accountant'] as const;
export type Role = (typeof ROLES)[number];

@Entity('stores')
@Index(['tenantId', 'code'], { unique: true })
export class Store extends BaseEntity {
  @Index() @Column('uuid') tenantId: string;
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' }) @JoinColumn() tenant: Tenant;
  @Column() name: string;
  @Column() code: string;
  @Column({ nullable: true }) address?: string;
  @Column({ nullable: true }) phone?: string;
  @Column({ nullable: true }) gstin?: string;
  @Column({ nullable: true }) stateCode?: string;
  /** printed on invoices: MG-2026-00001 */
  @Column() invoicePrefix: string;
  @Column({ default: 0 }) invoiceSeq: number;
  @Column({ default: 0 }) returnSeq: number;
  @Column({ default: 0 }) adjustmentSeq: number;
  @Column({ default: 0 }) purchaseSeq: number;
  @Column({ default: 0 }) transferSeq: number;
  @Column({ default: 1 }) counters: number;
  @Column({ default: true }) isActive: boolean;
}

@Entity('users')
export class User extends BaseEntity {
  /** null for platform Super Admins */
  @Index() @Column({ type: 'uuid', nullable: true }) tenantId: string | null;
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE', nullable: true }) @JoinColumn() tenant?: Tenant;
  @Column() name: string;
  @Index({ unique: true }) @Column() email: string;
  @Index() @Column({ nullable: true }) mobile?: string;
  @Column({ select: false }) passwordHash: string;
  @Column() role: Role;
  @Column({ default: true }) isActive: boolean;
  @Column({ type: 'timestamptz', nullable: true }) lastLoginAt?: Date;
  @ManyToMany(() => Store)
  @JoinTable({ name: 'user_store_access', joinColumn: { name: 'user_id' }, inverseJoinColumn: { name: 'store_id' } })
  stores: Store[];
}

@Entity('refresh_tokens')
export class RefreshToken extends BaseEntity {
  @Index() @Column('uuid') userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn() user: User;
  @Index({ unique: true }) @Column() tokenHash: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt?: Date | null;
}

@Entity('audit_logs')
export class AuditLog extends BaseEntity {
  @Index() @Column({ type: 'uuid', nullable: true }) tenantId: string | null;
  @Column({ type: 'uuid', nullable: true }) userId: string | null;
  @Column({ nullable: true }) userName?: string;
  @Index() @Column() action: string;
  @Column() entity: string;
  @Column({ nullable: true }) entityId?: string;
  @Column({ type: 'jsonb', nullable: true }) meta?: Record<string, unknown>;
}
