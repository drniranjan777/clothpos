import { ForbiddenException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BILLABLE_STATUSES, DEFAULT_TENANT_SETTINGS, ModuleKey, Plan, Store, Subscription, Tenant, TenantSettings,
} from '../database/entities';

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(Tenant) private tenants: Repository<Tenant>,
    @InjectRepository(Subscription) private subs: Repository<Subscription>,
    @InjectRepository(Store) private stores: Repository<Store>,
  ) {}

  async get(tenantId: string) {
    const t = await this.tenants.findOneBy({ id: tenantId });
    if (!t) throw new NotFoundException('Tenant not found');
    return t;
  }

  settings(t: Tenant): TenantSettings {
    return { ...DEFAULT_TENANT_SETTINGS, ...(t.settings ?? {}) };
  }

  currentSubscription(tenantId: string) {
    return this.subs.findOne({ where: { tenantId, isCurrent: true }, relations: { plan: true } });
  }

  modules(plan: Plan | undefined, t: Tenant): ModuleKey[] {
    const set = new Set<ModuleKey>(plan?.modules ?? []);
    for (const [k, on] of Object.entries(t.featureOverrides ?? {})) on ? set.add(k as ModuleKey) : set.delete(k as ModuleKey);
    return [...set];
  }

  /** BRD §8: suspended / expired / cancelled tenants keep read-only access but cannot bill. */
  async assertCanTransact(tenantId: string) {
    const [t, sub] = await Promise.all([this.get(tenantId), this.currentSubscription(tenantId)]);
    if (t.status !== 'active') throw new ForbiddenException('This business account is suspended. Contact support to reactivate.');
    if (!sub || !BILLABLE_STATUSES.includes(sub.status)) {
      throw new ForbiddenException('Subscription is not active. Renew your plan to continue billing - your data is safe and read-only.');
    }
    return { tenant: t, subscription: sub };
  }

  listStores(tenantId: string) {
    // oldest first, so the flagship store is the default selection
    return this.stores.find({ where: { tenantId, isActive: true }, order: { createdAt: 'ASC', name: 'DESC' } });
  }

  async store(tenantId: string, storeId: string) {
    const s = await this.stores.findOneBy({ id: storeId, tenantId });
    if (!s) throw new NotFoundException('Store not found');
    return s;
  }
}

@Global()
@Module({ imports: [TypeOrmModule.forFeature([Tenant, Subscription, Store])], providers: [TenantService], exports: [TenantService] })
export class TenantModule {}
