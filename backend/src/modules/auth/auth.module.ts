import { Body, Controller, Get, HttpCode, Injectable, Module, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { createHash, randomBytes } from 'crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, Public } from '../../common/auth';
import { TenantService } from '../../common/tenant.service';
import { RefreshToken, User } from '../../database/entities';

class LoginDto {
  /** email or mobile number */
  @IsString() @IsNotEmpty() login: string;
  @IsString() @IsNotEmpty() password: string;
  /** non-browser API clients (scripts, mobile apps) ask for the refresh token in the body */
  @IsOptional() @IsBoolean() returnRefreshToken?: boolean;
}
class RefreshDto {
  /** browsers send the httpOnly cookie instead */
  @IsOptional() @IsString() @IsNotEmpty() refreshToken?: string;
  @IsOptional() @IsBoolean() returnRefreshToken?: boolean;
}

/** The refresh token lives in an httpOnly cookie scoped to /api/auth - page JavaScript can never read it. */
const COOKIE = 'npos_rt';
const cookieOpts = (): CookieOptions => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/api/auth',
  maxAge: Number(process.env.JWT_REFRESH_DAYS ?? 7) * 864e5,
});

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(RefreshToken) private tokens: Repository<RefreshToken>,
    private jwt: JwtService,
    private tenants: TenantService,
    private audit: AuditService,
  ) {}

  async login(dto: LoginDto) {
    const login = dto.login.trim().toLowerCase();
    const mobile = login.replace(/\D/g, '');
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .leftJoinAndSelect('u.stores', 's')
      .where('LOWER(u.email) = :login', { login })
      .orWhere(mobile.length >= 10 ? 'u.mobile = :mobile' : '1=0', { mobile: mobile.slice(-10) })
      .getOne();
    // same message for unknown user and wrong password - do not reveal which accounts exist
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect email/mobile or password');
    }
    if (!user.isActive) throw new UnauthorizedException('Your account is disabled. Contact your store admin.');
    if (user.tenantId) {
      const tenant = await this.tenants.get(user.tenantId);
      if (tenant.status === 'archived') throw new UnauthorizedException('This business account has been archived.');
    }
    await this.users.update(user.id, { lastLoginAt: new Date() });
    await this.audit.log(this.claims(user), 'auth.login', 'user', user.id);
    return this.issue(user);
  }

  async refresh(refreshToken: string) {
    // a token rotated in the last 30 s is still accepted, so two tabs refreshing at once don't sign each other out.
    // Logout / suspension revoke with the epoch timestamp, which is never inside the grace window.
    const row = await this.tokens.findOne({ where: [
      { tokenHash: sha256(refreshToken), revokedAt: IsNull() },
      { tokenHash: sha256(refreshToken), revokedAt: MoreThan(new Date(Date.now() - 30_000)) },
    ] });
    if (!row || row.expiresAt < new Date()) throw new UnauthorizedException('Session expired, please sign in again');
    const user = await this.users.findOne({ where: { id: row.userId }, relations: { stores: true } });
    if (!user?.isActive) throw new UnauthorizedException('Account disabled');
    // rotate: a refresh token can be used exactly once
    if (!row.revokedAt) await this.tokens.update(row.id, { revokedAt: new Date() });
    return this.issue(user);
  }

  async logout(refreshToken: string) {
    await this.tokens.update({ tokenHash: sha256(refreshToken) }, { revokedAt: new Date(0) });
    return { ok: true };
  }

  async me(auth: AuthUser) {
    const user = await this.users.findOne({ where: { id: auth.sub }, relations: { stores: true } });
    if (!user) throw new UnauthorizedException();
    if (!user.tenantId) return { user: this.publicUser(user), tenant: null, stores: [], subscription: null, modules: [], settings: null };
    const tenant = await this.tenants.get(user.tenantId);
    const sub = await this.tenants.currentSubscription(user.tenantId);
    const allStores = await this.tenants.listStores(user.tenantId);
    const stores = ['tenant_admin', 'accountant'].includes(user.role) ? allStores : allStores.filter((s) => user.stores.some((u) => u.id === s.id));
    return {
      user: this.publicUser(user),
      tenant: { id: tenant.id, businessName: tenant.businessName, gstin: tenant.gstin, city: tenant.city, stateCode: tenant.stateCode, status: tenant.status },
      stores: stores.map((s) => ({ id: s.id, name: s.name, code: s.code, counters: s.counters, address: s.address, phone: s.phone, gstin: s.gstin ?? tenant.gstin })),
      subscription: sub && {
        status: sub.status, billingCycle: sub.billingCycle, startDate: sub.startDate, endDate: sub.endDate, amount: sub.amount,
        plan: { name: sub.plan.name, code: sub.plan.code, maxStores: sub.plan.maxStores, maxUsers: sub.plan.maxUsers, maxSkus: sub.plan.maxSkus },
      },
      modules: this.tenants.modules(sub?.plan, tenant),
      settings: this.tenants.settings(tenant),
    };
  }

  private publicUser(u: User) {
    return { id: u.id, name: u.name, email: u.email, mobile: u.mobile, role: u.role, tenantId: u.tenantId };
  }

  private claims(u: User): AuthUser {
    return { sub: u.id, name: u.name, role: u.role, tenantId: u.tenantId, storeIds: (u.stores ?? []).map((s) => s.id) };
  }

  private async issue(user: User) {
    const accessToken = this.jwt.sign(this.claims(user), {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.JWT_ACCESS_TTL ?? '15m') as any,
    });
    const refreshToken = randomBytes(48).toString('base64url');
    const days = Number(process.env.JWT_REFRESH_DAYS ?? 7);
    await this.tokens.save(this.tokens.create({ userId: user.id, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + days * 864e5) }));
    return { accessToken, refreshToken, user: this.publicUser(user) };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('login') async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(await this.auth.login(dto), res, dto.returnRefreshToken);
  }
  @Public() @HttpCode(200) @Post('refresh') async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refreshToken ?? req.cookies?.[COOKIE];
    if (!token) throw new UnauthorizedException('Not signed in');
    return this.respond(await this.auth.refresh(token), res, dto.returnRefreshToken ?? !!dto.refreshToken);
  }
  @Public() @HttpCode(200) @Post('logout') async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refreshToken ?? req.cookies?.[COOKIE];
    res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
    return token ? this.auth.logout(token) : { ok: true };
  }

  private respond(session: { accessToken: string; refreshToken: string; user: unknown }, res: Response, includeToken?: boolean) {
    res.cookie(COOKIE, session.refreshToken, cookieOpts());
    const { refreshToken, ...rest } = session;
    return includeToken ? session : rest;
  }
  @Get('me') me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken])],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
