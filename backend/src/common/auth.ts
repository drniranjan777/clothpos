import {
  CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '../database/entities';

/** Claims carried in the access token. Tenant and store scope come only from here. */
export interface AuthUser {
  sub: string;
  name: string;
  role: Role;
  tenantId: string | null;
  storeIds: string[];
}

const IS_PUBLIC = 'isPublic';
const ROLES = 'roles';

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** Roles that may act on every store of their tenant. */
export const TENANT_WIDE_ROLES: Role[] = ['tenant_admin', 'accountant'];
export const MANAGER_ROLES: Role[] = ['tenant_admin', 'store_manager'];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing access token');
    try {
      req.user = this.jwt.verify<AuthUser>(header.slice(7), { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Access token expired or invalid');
    }
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!roles?.length || !user) return true;
    if (!roles.includes(user.role)) throw new ForbiddenException('Your role does not allow this action');
    return true;
  }
}

/** Tenant id of the caller; Super Admins have none and cannot use tenant endpoints. */
export function tenantOf(user: AuthUser): string {
  if (!user.tenantId) throw new ForbiddenException('This endpoint is for tenant users');
  return user.tenantId;
}

export function canAccessStore(user: AuthUser, storeId: string): boolean {
  return TENANT_WIDE_ROLES.includes(user.role) || user.storeIds.includes(storeId);
}

export function assertStore(user: AuthUser, storeId: string) {
  if (!canAccessStore(user, storeId)) throw new ForbiddenException('You do not have access to this store');
}

/** Store filter for list queries: undefined = all stores of the tenant. */
export function storeScope(user: AuthUser, requested?: string): string[] | undefined {
  if (requested) {
    assertStore(user, requested);
    return [requested];
  }
  return TENANT_WIDE_ROLES.includes(user.role) ? undefined : user.storeIds;
}
