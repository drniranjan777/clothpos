import { Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsDateString, IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { AuthUser, CurrentUser, tenantOf } from '../../common/auth';
import { paged, parsePage } from '../../common/util';
import { Customer, Sale, SaleReturn } from '../../database/entities';

class CustomerDto {
  @IsString() @Length(1, 80) name: string;
  @Matches(/^\d{10}$/, { message: 'mobile must be 10 digits' }) mobile: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, { message: 'GSTIN format is invalid' }) gstin?: string;
  @IsOptional() @IsDateString() birthday?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}
class UpdateCustomerDto extends PartialType(CustomerDto) {}

@Injectable()
export class CustomersService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(Customer) private customers: Repository<Customer>,
  ) {}

  async list(user: AuthUser, q: { search?: string; segment?: string; page?: string; pageSize?: string }) {
    const tenantId = tenantOf(user);
    const { skip, take, page, pageSize } = parsePage(q.page, q.pageSize);
    const params: any[] = [tenantId];
    let where = 'c.tenant_id = $1';
    if (q.search) where += ` AND (c.name ILIKE $${params.push(`%${q.search}%`)} OR c.mobile LIKE $${params.length})`;
    const having: Record<string, string> = {
      loyal: 'HAVING COUNT(s.id) >= 5',
      new: "HAVING MIN(c.created_at) >= now() - interval '30 days'",
      b2b: '',
      inactive: "HAVING MAX(s.created_at) IS NULL OR MAX(s.created_at) < now() - interval '90 days'",
    };
    if (q.segment === 'b2b') where += ' AND c.gstin IS NOT NULL';
    const base = `FROM customers c LEFT JOIN sales s ON s.customer_id = c.id AND s.status = 'completed'
                  WHERE ${where} GROUP BY c.id ${having[q.segment ?? ''] ?? ''}`;
    const [{ n }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM (SELECT c.id ${base}) x`, params);
    const rows = await this.ds.query(
      `SELECT c.id, c.name, c.mobile, c.email, c.gstin, c.loyalty_points AS "loyaltyPoints", c.store_credit::float AS "storeCredit",
              COUNT(s.id)::int AS visits, COALESCE(SUM(s.total),0)::float AS "lifetimeSpend", MAX(s.created_at) AS "lastVisit"
       ${base} ORDER BY MAX(s.created_at) DESC NULLS LAST, c.name LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paged(rows, n, page, pageSize);
  }

  async stats(user: AuthUser) {
    const tenantId = tenantOf(user);
    const [r] = await this.ds.query(
      `SELECT (SELECT COUNT(*) FROM customers WHERE tenant_id = $1)::int AS total,
              (SELECT COUNT(*) FROM customers WHERE tenant_id = $1 AND created_at >= date_trunc('month', now()))::int AS "newThisMonth",
              (SELECT COALESCE(SUM(loyalty_points),0) FROM customers WHERE tenant_id = $1)::int AS "pointsOutstanding",
              (SELECT COALESCE(SUM(store_credit),0) FROM customers WHERE tenant_id = $1)::float AS "storeCreditOutstanding",
              (SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE n >= 2) / COUNT(*)) END
                 FROM (SELECT customer_id, COUNT(*) n FROM sales WHERE tenant_id = $1 AND status = 'completed' AND customer_id IS NOT NULL
                       AND created_at >= now() - interval '90 days' GROUP BY customer_id) x)::int AS "repeatRate"`,
      [tenantId],
    );
    return r;
  }

  lookup(user: AuthUser, mobile: string) {
    return this.customers.findOneBy({ tenantId: tenantOf(user), mobile: (mobile ?? '').replace(/\D/g, '').slice(-10) });
  }

  async get(user: AuthUser, id: string) {
    const tenantId = tenantOf(user);
    const c = await this.customers.findOneBy({ id, tenantId });
    if (!c) throw new NotFoundException('Customer not found');
    const [stats] = await this.ds.query(
      `SELECT COUNT(*)::int AS visits, COALESCE(SUM(total),0)::float AS "lifetimeSpend", COALESCE(AVG(total),0)::float AS "avgBill", MAX(created_at) AS "lastVisit"
       FROM sales WHERE customer_id = $1 AND status = 'completed'`, [id]);
    const favourites = await this.ds.query(
      `SELECT si.size, COUNT(*)::int n FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.customer_id = $1 AND si.size IS NOT NULL GROUP BY si.size ORDER BY n DESC LIMIT 2`, [id]);
    const sales = await this.ds.getRepository(Sale).find({
      where: { customerId: id, tenantId }, relations: { items: true, payments: true }, order: { createdAt: 'DESC' }, take: 10,
    });
    const returns = await this.ds.getRepository(SaleReturn).find({ where: { customerId: id, tenantId }, order: { createdAt: 'DESC' }, take: 10 });
    return { ...c, ...stats, preferredSizes: favourites.map((f: any) => f.size), sales, returns };
  }

  async create(user: AuthUser, dto: CustomerDto) {
    const tenantId = tenantOf(user);
    if (await this.customers.existsBy({ tenantId, mobile: dto.mobile })) throw new ConflictException('A customer with this mobile already exists');
    return this.customers.save(this.customers.create({ ...dto, tenantId }));
  }

  async update(user: AuthUser, id: string, dto: UpdateCustomerDto) {
    const tenantId = tenantOf(user);
    const c = await this.customers.findOneBy({ id, tenantId });
    if (!c) throw new NotFoundException('Customer not found');
    if (dto.mobile && dto.mobile !== c.mobile && (await this.customers.existsBy({ tenantId, mobile: dto.mobile }))) {
      throw new ConflictException('Another customer already uses this mobile');
    }
    await this.customers.update(id, dto);
    return this.customers.findOneBy({ id });
  }
}

@Controller('customers')
export class CustomersController {
  constructor(private svc: CustomersService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.svc.list(u, q);
  }
  @Get('stats') stats(@CurrentUser() u: AuthUser) {
    return this.svc.stats(u);
  }
  @Get('lookup') async lookup(@CurrentUser() u: AuthUser, @Query('mobile') mobile: string) {
    return { customer: await this.svc.lookup(u, mobile) };
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CustomerDto) {
    return this.svc.create(u, dto);
  }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    return this.svc.update(u, id, dto);
  }
}

@Module({ imports: [TypeOrmModule.forFeature([Customer])], controllers: [CustomersController], providers: [CustomersService] })
export class CustomersModule {}
