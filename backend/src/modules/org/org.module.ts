import { Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MinLength } from 'class-validator';
import { In, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, Roles, tenantOf } from '../../common/auth';
import { TenantService } from '../../common/tenant.service';
import { Role, Store, User } from '../../database/entities';

const STAFF_ROLES: Role[] = ['tenant_admin', 'store_manager', 'cashier', 'inventory_user', 'accountant'];

class CreateUserDto {
  @IsString() @Length(2, 60) name: string;
  @IsEmail() email: string;
  @IsOptional() @Matches(/^\d{10}$/) mobile?: string;
  @IsIn(STAFF_ROLES) role: Role;
  @IsString() @MinLength(8) password: string;
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) storeIds: string[];
}
class UpdateUserDto {
  @IsOptional() @IsIn(STAFF_ROLES) role?: Role;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) storeIds?: string[];
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

@Injectable()
export class OrgService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Store) private stores: Repository<Store>,
    private tenants: TenantService,
    private audit: AuditService,
  ) {}

  listStores(user: AuthUser) {
    return this.tenants.listStores(tenantOf(user));
  }

  async listUsers(user: AuthUser) {
    const rows = await this.users.find({ where: { tenantId: tenantOf(user) }, relations: { stores: true }, order: { name: 'ASC' } });
    return rows.map((u) => ({ id: u.id, name: u.name, email: u.email, mobile: u.mobile, role: u.role, isActive: u.isActive, lastLoginAt: u.lastLoginAt, stores: u.stores.map((s) => ({ id: s.id, name: s.name })) }));
  }

  async createUser(user: AuthUser, dto: CreateUserDto) {
    const tenantId = tenantOf(user);
    const sub = await this.tenants.currentSubscription(tenantId);
    const max = sub?.plan.maxUsers;
    if (max != null && (await this.users.countBy({ tenantId, isActive: true })) >= max) {
      throw new ForbiddenException(`Your plan allows ${max} users. Upgrade to add more staff.`);
    }
    if (await this.users.existsBy({ email: dto.email.toLowerCase() })) throw new ConflictException('Email already in use');
    const stores = await this.stores.findBy({ tenantId, id: In(dto.storeIds) });
    if (stores.length !== dto.storeIds.length) throw new NotFoundException('Unknown store');
    const saved = await this.users.save(this.users.create({
      tenantId, name: dto.name, email: dto.email.toLowerCase(), mobile: dto.mobile, role: dto.role, passwordHash: await bcrypt.hash(dto.password, 10), stores,
    }));
    await this.audit.log(user, 'user.create', 'user', saved.id, { email: saved.email, role: saved.role });
    return { id: saved.id };
  }

  async updateUser(user: AuthUser, id: string, dto: UpdateUserDto) {
    const tenantId = tenantOf(user);
    const target = await this.users.findOne({ where: { id, tenantId }, relations: { stores: true } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === user.sub && (dto.isActive === false || (dto.role && dto.role !== target.role))) {
      throw new ForbiddenException('You cannot disable or change the role of your own account');
    }
    if (dto.role) target.role = dto.role;
    if (dto.isActive !== undefined) target.isActive = dto.isActive;
    if (dto.storeIds) target.stores = await this.stores.findBy({ tenantId, id: In(dto.storeIds) });
    if (dto.password) target.passwordHash = await bcrypt.hash(dto.password, 10);
    await this.users.save(target);
    // a disabled account or a reset password signs the person out everywhere
    if (dto.isActive === false || dto.password) {
      await this.users.manager.query(`UPDATE refresh_tokens SET revoked_at = 'epoch' WHERE user_id = $1 AND (revoked_at IS NULL OR revoked_at > now() - interval '1 minute')`, [id]);
    }
    await this.audit.log(user, 'user.update', 'user', id, { role: dto.role, isActive: dto.isActive, storeIds: dto.storeIds, passwordReset: !!dto.password });
    return { ok: true };
  }
}

@Controller()
export class OrgController {
  constructor(private svc: OrgService) {}

  @Get('stores') stores(@CurrentUser() u: AuthUser) {
    return this.svc.listStores(u);
  }
  @Roles('tenant_admin', 'store_manager') @Get('users') users(@CurrentUser() u: AuthUser) {
    return this.svc.listUsers(u);
  }
  @Roles('tenant_admin') @Post('users') create(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto) {
    return this.svc.createUser(u, dto);
  }
  @Roles('tenant_admin') @Patch('users/:id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.svc.updateUser(u, id, dto);
  }
}

@Module({ imports: [TypeOrmModule.forFeature([User, Store])], controllers: [OrgController], providers: [OrgService] })
export class OrgModule {}
