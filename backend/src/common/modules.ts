import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ModuleKey } from '../database/entities';
import type { AuthUser } from './auth';
import { TenantService } from './tenant.service';

const MODULE_KEY = 'requiredModule';
const LABEL: Partial<Record<ModuleKey, string>> = { purchases: 'Purchases & suppliers', multi_store: 'Multi-store', loyalty: 'Loyalty', whatsapp: 'WhatsApp' };

/** Route needs a plan module (BRD §6 feature entitlements, incl. per-tenant overrides). */
export const RequireModule = (m: ModuleKey) => SetMetadata(MODULE_KEY, m);

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(private reflector: Reflector, private tenants: TenantService) {}

  async canActivate(ctx: ExecutionContext) {
    const needed = this.reflector.getAllAndOverride<ModuleKey>(MODULE_KEY, [ctx.getHandler(), ctx.getClass()]);
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!needed || !user?.tenantId) return true;
    const [tenant, sub] = await Promise.all([this.tenants.get(user.tenantId), this.tenants.currentSubscription(user.tenantId)]);
    if (!this.tenants.modules(sub?.plan, tenant).includes(needed)) {
      throw new ForbiddenException(`${LABEL[needed] ?? needed} is not included in your plan. Upgrade to use it.`);
    }
    return true;
  }
}
