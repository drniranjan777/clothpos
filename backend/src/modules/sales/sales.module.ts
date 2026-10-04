import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthUser, CurrentUser } from '../../common/auth';
import {
  Category, HeldBill, Inventory, PriceList, Product, ProductPrice, ProductVariant, Sale,
} from '../../database/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { PosService } from './pos.service';
import { CancelSaleDto, CreateSaleDto, HoldBillDto } from './sales.dto';
import { SalesService } from './sales.service';

@Controller('pos')
export class PosController {
  constructor(private pos: PosService, private sales: SalesService) {}

  @Get('categories') categories(@CurrentUser() u: AuthUser) {
    return this.pos.listCategories(u);
  }
  @Get('price-lists') priceLists(@CurrentUser() u: AuthUser) {
    return this.pos.listPriceLists(u);
  }
  @Get('products') products(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.pos.browse(u, q);
  }
  @Get('catalog') catalog(@CurrentUser() u: AuthUser, @Query('storeId', ParseUUIDPipe) storeId: string, @Query('priceListId') pl?: string) {
    return this.pos.catalog(u, storeId, pl || undefined);
  }
  @Get('scan/:code') scan(@CurrentUser() u: AuthUser, @Param('code') code: string, @Query('storeId', ParseUUIDPipe) storeId: string, @Query('priceListId') pl?: string) {
    return this.pos.scan(u, code, storeId, pl || undefined);
  }
  @Get('held') held(@CurrentUser() u: AuthUser, @Query('storeId', ParseUUIDPipe) storeId: string) {
    return this.sales.listHeld(u, storeId);
  }
  @Post('held') hold(@CurrentUser() u: AuthUser, @Body() dto: HoldBillDto) {
    return this.sales.hold(u, dto);
  }
  @Delete('held/:id') removeHeld(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.removeHeld(u, id);
  }
}

@Controller('sales')
export class SalesController {
  constructor(private sales: SalesService) {}

  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateSaleDto) {
    return this.sales.create(u, dto);
  }
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.sales.list(u, q);
  }
  @Get('invoice/:invoiceNo') byInvoice(@CurrentUser() u: AuthUser, @Param('invoiceNo') no: string) {
    return this.sales.getByInvoice(u, no);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(u, id);
  }
  @Post(':id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelSaleDto) {
    return this.sales.cancel(u, id, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Sale, HeldBill, Category, Product, ProductVariant, Inventory, PriceList, ProductPrice]), InventoryModule],
  controllers: [PosController, SalesController],
  providers: [SalesService, PosService],
  exports: [SalesService],
})
export class SalesModule {}
