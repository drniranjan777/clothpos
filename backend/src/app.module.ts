import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from './common/audit.service';
import { JwtAuthGuard, RolesGuard } from './common/auth';
import { ModuleGuard } from './common/modules';
import { TenantModule } from './common/tenant.service';
import { dataSourceOptions } from './database/data-source';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CustomersModule } from './modules/customers/customers.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrgModule } from './modules/org/org.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { SalesModule } from './modules/sales/sales.module';
import { ShiftsModule } from './modules/shifts/shifts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    JwtModule.register({ global: true }),
    AuditModule,
    TenantModule,
    AuthModule,
    OrgModule,
    CatalogModule,
    InventoryModule,
    SalesModule,
    CustomersModule,
    ReturnsModule,
    ShiftsModule,
    ReportsModule,
    AdminModule,
    PurchasesModule,
    TransfersModule,
    SettingsModule,
  ],
  providers: [
    // every route needs a valid token unless marked @Public(); @Roles() is checked after authentication
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ModuleGuard },
  ],
})
export class AppModule {}
