import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { TenantService } from '../../common/tenant.service';
import { assertStore, AuthUser, CurrentUser, MANAGER_ROLES, Roles, storeScope, tenantOf } from '../../common/auth';
import { round2 } from '../../common/util';
import { CashierShift } from '../../database/entities';

class OpenShiftDto {
  @IsUUID() storeId: string;
  @IsInt() @Min(1) counter: number;
  @IsNumber() @Min(0) openingCash: number;
}
class CloseShiftDto {
  /** note/coin value -> count, e.g. { "500": 42, "200": 18, "coins": 40 } ("coins" is a rupee amount) */
  @IsObject() denominations: Record<string, number>;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}


@Injectable()
export class ShiftsService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(CashierShift) private shifts: Repository<CashierShift>,
    private audit: AuditService,
    private tenants: TenantService,
  ) {}

  async current(user: AuthUser, storeId: string) {
    const tenantId = tenantOf(user);
    assertStore(user, storeId);
    const shift = await this.shifts.findOne({ where: { tenantId, storeId, userId: user.sub, status: 'open' } });
    return { shift: shift ? { ...shift, summary: await this.summary(shift) } : null };
  }

  async open(user: AuthUser, dto: OpenShiftDto) {
    const tenantId = tenantOf(user);
    assertStore(user, dto.storeId);
    if (await this.shifts.existsBy({ tenantId, userId: user.sub, status: 'open' })) throw new ConflictException('You already have an open shift');
    if (await this.shifts.existsBy({ tenantId, storeId: dto.storeId, counter: dto.counter, status: 'open' })) {
      throw new ConflictException(`Counter ${dto.counter} is already in use by another cashier`);
    }
    const [{ n }] = await this.ds.query('SELECT COALESCE(MAX(shift_no),0)::int + 1 AS n FROM cashier_shifts WHERE tenant_id = $1', [tenantId]);
    const shift = await this.shifts.save(this.shifts.create({
      tenantId, storeId: dto.storeId, userId: user.sub, shiftNo: n, counter: dto.counter, openingCash: dto.openingCash, openedAt: new Date(), status: 'open',
    }));
    await this.audit.log(user, 'shift.open', 'cashier_shift', shift.id, { shiftNo: n, openingCash: dto.openingCash });
    return { ...shift, summary: await this.summary(shift) };
  }

  async get(user: AuthUser, id: string) {
    const shift = await this.shifts.findOne({ where: { id, tenantId: tenantOf(user) }, relations: { user: true, store: true } });
    if (!shift) throw new NotFoundException('Shift not found');
    assertStore(user, shift.storeId);
    if (shift.userId !== user.sub && !MANAGER_ROLES.includes(user.role)) throw new ForbiddenException();
    return { ...shift, user: { id: shift.user.id, name: shift.user.name }, summary: shift.summary ?? (await this.summary(shift)) };
  }

  async list(user: AuthUser, q: { storeId?: string; status?: string }) {
    const tenantId = tenantOf(user);
    const stores = storeScope(user, q.storeId);
    const qb = this.shifts.createQueryBuilder('s').leftJoin('s.user', 'u').addSelect(['u.id', 'u.name'])
      .where('s.tenantId = :tenantId', { tenantId }).orderBy('s.openedAt', 'DESC').take(50);
    if (stores) qb.andWhere('s.storeId IN (:...stores)', { stores });
    if (q.status) qb.andWhere('s.status = :st', { st: q.status });
    return qb.getMany();
  }

  async close(user: AuthUser, id: string, dto: CloseShiftDto) {
    const shift = await this.shifts.findOne({ where: { id, tenantId: tenantOf(user) } });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.userId !== user.sub && !MANAGER_ROLES.includes(user.role)) throw new ForbiddenException('Only the cashier or a manager can close this shift');
    if (shift.status !== 'open') throw new BadRequestException('Shift is already closed');
    const counted = round2(Object.entries(dto.denominations).reduce((s, [k, n]) => s + (k === 'coins' ? Number(n) : Number(k) * Number(n)), 0));
    const summary = await this.summary(shift);
    const variance = round2(counted - summary.expectedCash);
    const tolerance = this.tenants.settings(await this.tenants.get(shift.tenantId)).cashVarianceTolerance;
    if (Math.abs(variance) > tolerance && !dto.note) throw new BadRequestException(`Cash variance of ₹${variance} needs a note`);
    await this.shifts.update(id, {
      status: 'closed', closedAt: new Date(), countedCash: counted, expectedCash: summary.expectedCash, denominations: dto.denominations,
      summary: { ...summary, countedCash: counted, variance } as any, note: dto.note,
    });
    await this.audit.log(user, 'shift.close', 'cashier_shift', id, { shiftNo: shift.shiftNo, expected: summary.expectedCash, counted, variance });
    return this.get(user, id);
  }

  async approve(user: AuthUser, id: string) {
    const shift = await this.shifts.findOne({ where: { id, tenantId: tenantOf(user) } });
    if (!shift) throw new NotFoundException('Shift not found');
    assertStore(user, shift.storeId);
    if (shift.status !== 'closed') throw new BadRequestException('Only closed shifts can be approved');
    await this.shifts.update(id, { status: 'approved', approvedById: user.sub });
    await this.audit.log(user, 'shift.approve', 'cashier_shift', id, { shiftNo: shift.shiftNo });
    return this.get(user, id);
  }

  /** Cashier-wise totals and expected drawer cash (BRD §21). */
  async summary(shift: CashierShift) {
    const end = shift.closedAt ?? new Date();
    const [sales] = await this.ds.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS bills,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              COALESCE(SUM(total) FILTER (WHERE status = 'completed'),0)::float AS "grossSales",
              COALESCE(SUM(item_discount + bill_discount) FILTER (WHERE status = 'completed'),0)::float AS discounts,
              COALESCE(SUM(total_qty) FILTER (WHERE status = 'completed'),0)::int AS items
       FROM sales WHERE shift_id = $1`, [shift.id]);
    const payments: { method: string; count: number; amount: number }[] = await this.ds.query(
      `SELECT p.method, COUNT(*)::int AS count, COALESCE(SUM(p.amount),0)::float AS amount
       FROM sale_payments p JOIN sales s ON s.id = p.sale_id
       WHERE s.shift_id = $1 AND s.status = 'completed' GROUP BY p.method ORDER BY amount DESC`, [shift.id]);
    const [ret] = await this.ds.query(
      `SELECT COALESCE(SUM(net_amount) FILTER (WHERE refund_method = 'cash' AND net_amount > 0),0)::float AS "cashRefunds",
              COUNT(*) FILTER (WHERE refund_method = 'cash' AND net_amount > 0)::int AS "cashRefundCount",
              COALESCE(SUM(collected_amount) FILTER (WHERE collect_method = 'cash'),0)::float AS "cashCollected"
       FROM sale_returns WHERE user_id = $1 AND store_id = $2 AND created_at BETWEEN $3 AND $4`,
      [shift.userId, shift.storeId, shift.openedAt, end]);
    const hourly: { hour: number; total: number }[] = await this.ds.query(
      `SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COALESCE(SUM(total),0)::float AS total
       FROM sales WHERE shift_id = $1 AND status = 'completed' GROUP BY 1 ORDER BY 1`, [shift.id]);
    const [{ held }] = await this.ds.query('SELECT COUNT(*)::int AS held FROM held_bills WHERE user_id = $1 AND store_id = $2', [shift.userId, shift.storeId]);
    const cashSales = payments.find((p) => p.method === 'cash')?.amount ?? 0;
    const expectedCash = round2(shift.openingCash + cashSales + ret.cashCollected - ret.cashRefunds);
    return { ...sales, payments, ...ret, hourly, heldBills: held, openingCash: shift.openingCash, cashSales, expectedCash };
  }
}

@Controller('shifts')
export class ShiftsController {
  constructor(private svc: ShiftsService) {}

  @Get('current') current(@CurrentUser() u: AuthUser, @Query('storeId', ParseUUIDPipe) storeId: string) {
    return this.svc.current(u, storeId);
  }
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.svc.list(u, q);
  }
  @Post('open') open(@CurrentUser() u: AuthUser, @Body() dto: OpenShiftDto) {
    return this.svc.open(u, dto);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }
  @Post(':id/close') close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseShiftDto) {
    return this.svc.close(u, id, dto);
  }
  @Roles('tenant_admin', 'store_manager') @Post(':id/approve') approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(u, id);
  }
}

@Module({ imports: [TypeOrmModule.forFeature([CashierShift])], controllers: [ShiftsController], providers: [ShiftsService] })
export class ShiftsModule {}
