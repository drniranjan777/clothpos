import {
  BadRequestException, Body, ConflictException, Controller, Get, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit,
  Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import {
  IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min, MinLength,
} from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { addDays, isoDate, paged, parsePage, round2 } from '../../common/util';
import {
  AuditLog, MODULES, ModuleKey, Plan, Store, Subscription, SUBSCRIPTION_STATUSES, SubscriptionPayment, SubscriptionStatus, Tenant, User,
} from '../../database/entities';

class PlanDto {
  @IsString() @Length(2, 40) name: string;
  @Matches(/^[a-z0-9_]{2,30}$/) code: string;
  @IsOptional() @IsString() @MaxLength(120) description?: string;
  @IsNumber() @Min(0) priceMonthly: number;
  @IsNumber() @Min(0) priceYearly: number;
  @IsInt() @Min(0) trialDays: number;
  @IsInt() @Min(0) graceDays: number;
  @IsOptional() @IsInt() @Min(1) maxStores?: number | null;
  @IsOptional() @IsInt() @Min(1) maxUsers?: number | null;
  @IsOptional() @IsInt() @Min(1) maxSkus?: number | null;
  @IsOptional() @IsInt() @Min(1) maxMonthlyTransactions?: number | null;
  @IsArray() @IsIn(MODULES as unknown as string[], { each: true }) modules: ModuleKey[];
  @IsString() supportLevel: string;
  @IsOptional() @IsBoolean() isPopular?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdatePlanDto extends PartialType(PlanDto) {}

class OnboardDto {
  @IsString() @Length(2, 80) businessName: string;
  @IsString() @Length(2, 60) ownerName: string;
  @Matches(/^\d{10}$/) mobile: string;
  @IsEmail() email: string;
  @IsOptional() @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, { message: 'GSTIN format is invalid' }) gstin?: string;
  @IsOptional() @IsString() address?: string;
  @IsString() city: string;
  @IsString() state: string;
  @Matches(/^\d{2}$/) stateCode: string;
  @IsUUID() planId: string;
  @IsIn(['monthly', 'yearly']) billingCycle: 'monthly' | 'yearly';
  @IsBoolean() startTrial: boolean;
  @IsString() @Length(2, 60) storeName: string;
  @Matches(/^[A-Z]{2,4}$/, { message: 'store code: 2-4 capital letters' }) storeCode: string;
  @IsString() @MinLength(8) adminPassword: string;
}
class TenantStatusDto {
  @IsIn(['active', 'suspended', 'archived']) status: 'active' | 'suspended' | 'archived';
  @IsString() @Length(3, 200) reason: string;
}
class SubscriptionActionDto {
  @IsIn(['change_plan', 'extend', 'renew', 'set_status']) action: 'change_plan' | 'extend' | 'renew' | 'set_status';
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsIn(['monthly', 'yearly']) billingCycle?: 'monthly' | 'yearly';
  @IsOptional() @IsInt() @Min(1) days?: number;
  @IsOptional() @IsIn(SUBSCRIPTION_STATUSES as unknown as string[]) status?: SubscriptionStatus;
  /** renew: record the payment */
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsString() paymentReference?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
class FeaturesDto {
  @IsObject() overrides: Partial<Record<ModuleKey, boolean>>;
}

@Injectable()
export class AdminService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Subscriptions');
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(Tenant) private tenants: Repository<Tenant>,
    @InjectRepository(Plan) private plans: Repository<Plan>,
    @InjectRepository(Subscription) private subs: Repository<Subscription>,
    @InjectRepository(SubscriptionPayment) private payments: Repository<SubscriptionPayment>,
    @InjectRepository(AuditLog) private audits: Repository<AuditLog>,
    private audit: AuditService,
  ) {}

  onModuleInit() {
    this.refreshStatuses().catch((e) => this.log.error(e));
    this.timer = setInterval(() => this.refreshStatuses().catch((e) => this.log.error(e)), 60 * 60 * 1000);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /**
   * Subscription lifecycle (BRD §7): trial / active past end date -> grace (paid plans) or expired (trials);
   * grace beyond the plan's grace days -> suspended. Runs at start-up and hourly.
   */
  async refreshStatuses() {
    const today = isoDate(new Date());
    const expiredTrials = await this.ds.query(
      `UPDATE subscriptions SET status = 'expired', updated_at = now() WHERE is_current AND status = 'trial' AND end_date < $1 RETURNING tenant_id`, [today]);
    const grace = await this.ds.query(
      `UPDATE subscriptions SET status = 'grace', updated_at = now()
       WHERE is_current AND status IN ('active','payment_pending','past_due') AND end_date < $1 RETURNING tenant_id`, [today]);
    const suspended = await this.ds.query(
      `UPDATE subscriptions s SET status = 'suspended', updated_at = now() FROM subscription_plans p
       WHERE s.plan_id = p.id AND s.is_current AND s.status = 'grace' AND s.end_date + p.grace_days < $1::date RETURNING s.tenant_id`, [today]);
    const n = [expiredTrials, grace, suspended].reduce((sum, r) => sum + (r[1] ?? 0), 0);
    if (n) this.log.log(`lifecycle updated ${n} subscriptions`);
  }

  async dashboard() {
    const [counts] = await this.ds.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE s.status = 'active')::int AS active,
              COUNT(*) FILTER (WHERE s.status = 'trial')::int AS trial,
              COUNT(*) FILTER (WHERE s.status IN ('payment_pending','past_due','grace'))::int AS "atRisk",
              COUNT(*) FILTER (WHERE s.status IN ('suspended','expired','cancelled') OR t.status <> 'active')::int AS inactive,
              COUNT(*) FILTER (WHERE t.created_at >= date_trunc('month', now()))::int AS "newThisMonth",
              COALESCE(SUM(CASE WHEN s.status IN ('active','payment_pending','past_due','grace')
                                THEN CASE WHEN s.billing_cycle = 'yearly' THEN s.amount / 12 ELSE s.amount END END),0)::float AS mrr
       FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.is_current`);
    const plans = await this.ds.query(
      `SELECT p.id, p.name, p.code, p.price_monthly::float AS "priceMonthly", COUNT(s.id)::int AS tenants,
              COALESCE(SUM(CASE WHEN s.billing_cycle = 'yearly' THEN s.amount / 12 ELSE s.amount END),0)::float AS mrr
       FROM subscription_plans p LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.is_current AND s.status IN ('active','payment_pending','past_due','grace')
       GROUP BY p.id ORDER BY p.sort_order`);
    const revenue = await this.ds.query(
      `SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, SUM(amount)::float AS amount
       FROM subscription_payments WHERE status = 'paid' AND paid_at >= date_trunc('month', now()) - interval '11 months' GROUP BY 1 ORDER BY 1`);
    const recentSignups = await this.ds.query(
      `SELECT t.id, t.business_name AS "businessName", t.city, t.created_at AS "createdAt", p.name AS plan, s.status, s.end_date AS "endDate",
              (SELECT COUNT(*) FROM stores WHERE tenant_id = t.id)::int AS stores
       FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.is_current LEFT JOIN subscription_plans p ON p.id = s.plan_id
       ORDER BY t.created_at DESC LIMIT 5`);
    const expiring = await this.ds.query(
      `SELECT t.id, t.business_name AS "businessName", p.name AS plan, s.end_date AS "endDate", s.status
       FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id JOIN subscription_plans p ON p.id = s.plan_id
       WHERE s.is_current AND s.status IN ('active','trial') AND s.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 ORDER BY s.end_date LIMIT 6`);
    const failedPayments = await this.ds.query(
      `SELECT sp.id, t.id AS "tenantId", t.business_name AS "businessName", sp.amount::float, sp.method, sp.failure_reason AS "failureReason",
              sp.created_at AS "createdAt", s.status AS "subscriptionStatus", s.end_date AS "endDate"
       FROM subscription_payments sp JOIN tenants t ON t.id = sp.tenant_id LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.is_current
       WHERE sp.status = 'failed' AND s.status IN ('payment_pending','past_due','grace','suspended') ORDER BY sp.created_at DESC LIMIT 6`);
    return { ...counts, arr: round2(counts.mrr * 12), plans, revenue, recentSignups, expiring, failedPayments };
  }

  async listTenants(q: { search?: string; status?: string; planId?: string; page?: string; pageSize?: string }) {
    const { skip, take, page, pageSize } = parsePage(q.page, q.pageSize);
    const params: any[] = [];
    let where = 'TRUE';
    if (q.search) where += ` AND (t.business_name ILIKE $${params.push(`%${q.search}%`)} OR t.owner_name ILIKE $${params.length} OR t.gstin ILIKE $${params.length} OR t.mobile LIKE $${params.length})`;
    if (q.status === 'suspended') where += ` AND (t.status = 'suspended' OR s.status = 'suspended')`;
    else if (q.status === 'past_due') where += ` AND s.status IN ('payment_pending','past_due','grace')`;
    else if (q.status) where += ` AND s.status = $${params.push(q.status)}`;
    if (q.planId) where += ` AND s.plan_id = $${params.push(q.planId)}`;
    const from = `FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.is_current LEFT JOIN subscription_plans p ON p.id = s.plan_id WHERE ${where}`;
    const [{ n }] = await this.ds.query(`SELECT COUNT(*)::int n ${from}`, params);
    const rows = await this.ds.query(
      `SELECT t.id, t.business_name AS "businessName", t.owner_name AS "ownerName", t.city, t.mobile, t.status AS "tenantStatus", t.created_at AS "createdAt",
              p.name AS plan, p.code AS "planCode", p.max_stores AS "maxStores", p.max_users AS "maxUsers",
              s.status, s.end_date AS "endDate", s.billing_cycle AS "billingCycle",
              (SELECT COUNT(*) FROM stores WHERE tenant_id = t.id AND is_active)::int AS stores,
              (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND is_active)::int AS users
       ${from} ORDER BY t.created_at DESC LIMIT ${take} OFFSET ${skip}`, params);
    const [counts] = await this.ds.query(
      `SELECT COUNT(*)::int AS all, COUNT(*) FILTER (WHERE s.status = 'active')::int AS active, COUNT(*) FILTER (WHERE s.status = 'trial')::int AS trial,
              COUNT(*) FILTER (WHERE s.status IN ('payment_pending','past_due','grace'))::int AS past_due,
              COUNT(*) FILTER (WHERE t.status = 'suspended' OR s.status = 'suspended')::int AS suspended
       FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.is_current`);
    return { ...paged(rows, n, page, pageSize), counts };
  }

  async getTenant(id: string) {
    const t = await this.tenants.findOneBy({ id });
    if (!t) throw new NotFoundException('Tenant not found');
    const current = await this.subs.findOne({ where: { tenantId: id, isCurrent: true }, relations: { plan: true } });
    const history = await this.subs.find({ where: { tenantId: id }, relations: { plan: true }, order: { createdAt: 'DESC' }, take: 10 });
    const payments = await this.payments.find({ where: { tenantId: id }, order: { createdAt: 'DESC' }, take: 10 });
    const [usage] = await this.ds.query(
      `SELECT (SELECT COUNT(*) FROM stores WHERE tenant_id = $1 AND is_active)::int AS stores,
              (SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND is_active)::int AS users,
              (SELECT COUNT(*) FROM product_variants WHERE tenant_id = $1 AND is_active)::int AS skus,
              (SELECT COUNT(*) FROM sales WHERE tenant_id = $1 AND created_at >= date_trunc('month', now()))::int AS "monthTransactions",
              (SELECT COALESCE(SUM(total),0) FROM sales WHERE tenant_id = $1 AND status = 'completed' AND created_at >= date_trunc('month', now()))::float AS "monthSales"`,
      [id]);
    const modules = new Set<ModuleKey>(current?.plan.modules ?? []);
    for (const [k, on] of Object.entries(t.featureOverrides ?? {})) on ? modules.add(k as ModuleKey) : modules.delete(k as ModuleKey);
    const owner = await this.ds.getRepository(User).findOne({ where: { tenantId: id, role: 'tenant_admin' }, order: { createdAt: 'ASC' } });
    return { ...t, owner: owner && { id: owner.id, name: owner.name, email: owner.email }, subscription: current, history, payments, usage, modules: [...modules] };
  }

  async onboard(user: AuthUser, dto: OnboardDto) {
    const plan = await this.plans.findOneBy({ id: dto.planId, isActive: true });
    if (!plan) throw new BadRequestException('Plan not found or inactive');
    if (await this.ds.getRepository(User).existsBy({ email: dto.email.toLowerCase() })) throw new ConflictException('A user with this email already exists');
    const id = await this.ds.transaction(async (em) => {
      const code = dto.businessName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) + '-' + Date.now().toString(36).slice(-4).toUpperCase();
      const tenant = await em.getRepository(Tenant).save(em.getRepository(Tenant).create({
        businessName: dto.businessName, code, ownerName: dto.ownerName, mobile: dto.mobile, email: dto.email.toLowerCase(),
        gstin: dto.gstin, address: dto.address, city: dto.city, state: dto.state, stateCode: dto.stateCode, status: 'active',
      }));
      const store = await em.getRepository(Store).save(em.getRepository(Store).create({
        tenantId: tenant.id, name: dto.storeName, code: dto.storeCode, invoicePrefix: dto.storeCode, gstin: dto.gstin, stateCode: dto.stateCode, address: dto.address,
      }));
      await em.getRepository(User).save(em.getRepository(User).create({
        tenantId: tenant.id, name: dto.ownerName, email: dto.email.toLowerCase(), mobile: dto.mobile,
        passwordHash: await bcrypt.hash(dto.adminPassword, 10), role: 'tenant_admin', stores: [store],
      }));
      const start = new Date();
      const trial = dto.startTrial && plan.trialDays > 0;
      const end = trial ? addDays(start, plan.trialDays) : dto.billingCycle === 'yearly' ? addDays(start, 365) : addDays(start, 30);
      await em.getRepository(Subscription).save(em.getRepository(Subscription).create({
        tenantId: tenant.id, planId: plan.id, status: trial ? 'trial' : 'payment_pending', billingCycle: dto.billingCycle,
        startDate: isoDate(start), endDate: isoDate(end), amount: dto.billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly, isCurrent: true,
      }));
      await this.audit.log(user, 'tenant.onboard', 'tenant', tenant.id, { businessName: dto.businessName, plan: plan.code, trial }, em, tenant.id);
      return tenant.id;
    });
    return this.getTenant(id);
  }

  async setStatus(user: AuthUser, id: string, dto: TenantStatusDto) {
    const t = await this.tenants.findOneBy({ id });
    if (!t) throw new NotFoundException('Tenant not found');
    await this.tenants.update(id, { status: dto.status });
    if (dto.status !== 'active') {
      // sign everyone out of a suspended / archived tenant
      await this.ds.query(`UPDATE refresh_tokens SET revoked_at = 'epoch' WHERE revoked_at IS NULL OR revoked_at > now() - interval '1 minute' AND user_id IN (SELECT id FROM users WHERE tenant_id = $1)`, [id]);
    }
    await this.audit.log(user, `tenant.${dto.status === 'active' ? 'activate' : dto.status === 'suspended' ? 'suspend' : 'archive'}`, 'tenant', id, { from: t.status, reason: dto.reason }, undefined, id);
    return this.getTenant(id);
  }

  async subscriptionAction(user: AuthUser, id: string, dto: SubscriptionActionDto) {
    await this.ds.transaction(async (em) => {
      const repo = em.getRepository(Subscription);
      const cur = await repo.findOne({ where: { tenantId: id, isCurrent: true }, relations: { plan: true } });
      if (!cur) throw new NotFoundException('Tenant has no subscription');
      const before = { plan: cur.plan.code, status: cur.status, endDate: cur.endDate };
      if (dto.action === 'extend') {
        if (!dto.days) throw new BadRequestException('days is required');
        const base = new Date(Math.max(new Date(cur.endDate).getTime(), Date.now()));
        cur.endDate = isoDate(addDays(base, dto.days));
        if (['expired', 'grace', 'suspended', 'past_due', 'payment_pending'].includes(cur.status)) cur.status = 'active';
        await repo.save(cur);
      } else if (dto.action === 'set_status') {
        if (!dto.status) throw new BadRequestException('status is required');
        cur.status = dto.status;
        await repo.save(cur);
      } else {
        // change_plan / renew start a new subscription period; history keeps the old row
        const plan = dto.planId ? await em.getRepository(Plan).findOneBy({ id: dto.planId }) : cur.plan;
        if (!plan) throw new BadRequestException('Plan not found');
        const cycle = dto.billingCycle ?? cur.billingCycle;
        const amount = cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
        const start = dto.action === 'renew' ? new Date(Math.max(new Date(cur.endDate).getTime(), Date.now())) : new Date();
        await repo.update(cur.id, { isCurrent: false });
        const next = await repo.save(repo.create({
          tenantId: id, planId: plan.id, billingCycle: cycle, amount, isCurrent: true, autoRenew: cur.autoRenew,
          status: dto.paymentMethod ? 'active' : 'payment_pending',
          startDate: isoDate(start), endDate: isoDate(addDays(start, cycle === 'yearly' ? 365 : 30)),
        }));
        if (dto.paymentMethod) {
          await em.getRepository(SubscriptionPayment).save(em.getRepository(SubscriptionPayment).create({
            tenantId: id, subscriptionId: next.id, amount, method: dto.paymentMethod, status: 'paid', reference: dto.paymentReference, paidAt: new Date(),
          }));
        }
      }
      await this.audit.log(user, `subscription.${dto.action}`, 'tenant', id, { before, request: dto }, em, id);
    });
    return this.getTenant(id);
  }

  async setFeatures(user: AuthUser, id: string, dto: FeaturesDto) {
    const t = await this.tenants.findOneBy({ id });
    if (!t) throw new NotFoundException('Tenant not found');
    const overrides = Object.fromEntries(Object.entries(dto.overrides).filter(([k]) => (MODULES as readonly string[]).includes(k)));
    await this.tenants.update(id, { featureOverrides: overrides });
    await this.audit.log(user, 'tenant.features', 'tenant', id, { from: t.featureOverrides, to: overrides }, undefined, id);
    return this.getTenant(id);
  }

  async listPlans() {
    return this.ds.query(
      `SELECT p.*, p.price_monthly::float AS "priceMonthly", p.price_yearly::float AS "priceYearly",
              (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.is_current AND s.status NOT IN ('cancelled','expired'))::int AS tenants
       FROM subscription_plans p ORDER BY p.sort_order`,
    ).then((rows) => rows.map((r: any) => ({
      id: r.id, name: r.name, code: r.code, description: r.description, priceMonthly: r.priceMonthly, priceYearly: r.priceYearly,
      trialDays: r.trial_days, graceDays: r.grace_days, maxStores: r.max_stores, maxUsers: r.max_users, maxSkus: r.max_skus,
      maxMonthlyTransactions: r.max_monthly_transactions, modules: r.modules, supportLevel: r.support_level, isPopular: r.is_popular,
      isActive: r.is_active, tenants: r.tenants,
    })));
  }

  async createPlan(user: AuthUser, dto: PlanDto) {
    if (await this.plans.existsBy({ code: dto.code })) throw new ConflictException('Plan code already exists');
    const count = await this.plans.count();
    const plan = await this.plans.save(this.plans.create({ ...dto, sortOrder: count + 1 }));
    await this.audit.log(user, 'plan.create', 'plan', plan.id, { code: plan.code });
    return plan;
  }

  async updatePlan(user: AuthUser, id: string, dto: UpdatePlanDto) {
    const plan = await this.plans.findOneBy({ id });
    if (!plan) throw new NotFoundException('Plan not found');
    await this.plans.update(id, dto);
    await this.audit.log(user, 'plan.update', 'plan', id, { code: plan.code, changes: dto });
    return this.plans.findOneBy({ id });
  }

  async listPayments(q: { status?: string; page?: string }) {
    const { skip, take, page, pageSize } = parsePage(q.page, 30);
    const qb = this.payments.createQueryBuilder('p').leftJoinAndSelect('p.tenant', 't').orderBy('p.createdAt', 'DESC').skip(skip).take(take);
    if (q.status) qb.where('p.status = :s', { s: q.status });
    const [items, total] = await qb.getManyAndCount();
    return paged(items.map((p) => ({ ...p, tenant: { id: p.tenant.id, businessName: p.tenant.businessName } })), total, page, pageSize);
  }

  async listAudit(q: { tenantId?: string; action?: string; page?: string }) {
    const { skip, take, page, pageSize } = parsePage(q.page, 50);
    const qb = this.audits.createQueryBuilder('a').orderBy('a.createdAt', 'DESC').skip(skip).take(take);
    if (q.tenantId) qb.andWhere('a.tenantId = :t', { t: q.tenantId });
    if (q.action) qb.andWhere('a.action LIKE :a', { a: `${q.action}%` });
    const [items, total] = await qb.getManyAndCount();
    return paged(items, total, page, pageSize);
  }
}

@Roles('super_admin')
@Controller('admin')
export class AdminController {
  constructor(private svc: AdminService) {}

  @Get('dashboard') dashboard() {
    return this.svc.dashboard();
  }
  @Get('tenants') tenants(@Query() q: any) {
    return this.svc.listTenants(q);
  }
  @Post('tenants') onboard(@CurrentUser() u: AuthUser, @Body() dto: OnboardDto) {
    return this.svc.onboard(u, dto);
  }
  @Get('tenants/:id') tenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getTenant(id);
  }
  @Patch('tenants/:id/status') status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TenantStatusDto) {
    return this.svc.setStatus(u, id, dto);
  }
  @Post('tenants/:id/subscription') subscription(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubscriptionActionDto) {
    return this.svc.subscriptionAction(u, id, dto);
  }
  @Patch('tenants/:id/features') features(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FeaturesDto) {
    return this.svc.setFeatures(u, id, dto);
  }
  @Get('plans') plans() {
    return this.svc.listPlans();
  }
  @Post('plans') createPlan(@CurrentUser() u: AuthUser, @Body() dto: PlanDto) {
    return this.svc.createPlan(u, dto);
  }
  @Patch('plans/:id') updatePlan(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.svc.updatePlan(u, id, dto);
  }
  @Get('payments') payments(@Query() q: any) {
    return this.svc.listPayments(q);
  }
  @Get('audit-logs') auditLogs(@Query() q: any) {
    return this.svc.listAudit(q);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, Plan, Subscription, SubscriptionPayment, AuditLog])],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
