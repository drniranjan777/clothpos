import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PAYMENT_METHODS, PaymentMethod } from '../../database/entities';

export class SaleItemDto {
  @IsUUID() variantId: string;
  @IsInt() @Min(1) qty: number;
  /** rupees off this line */
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  /** price charged at the counter - only honoured for offline sales being synced */
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
}

export class OfflineDto {
  /** provisional number printed on the offline receipt */
  @IsString() @Matches(/^OFF-[A-Z0-9-]{3,40}$/) ref: string;
  /** when the sale actually happened at the counter */
  @IsDateString() at: string;
}

export class BillDiscountDto {
  @IsIn(['flat', 'percent']) type: 'flat' | 'percent';
  @IsNumber() @Min(0) value: number;
}

export class PaymentDto {
  @IsIn(PAYMENT_METHODS as unknown as string[]) method: PaymentMethod;
  @IsNumber() @Min(0) amount: number;
  /** cash handed over by the customer (cash only) */
  @IsOptional() @IsNumber() @Min(0) tendered?: number;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
}

export class QuickCustomerDto {
  @IsString() @Length(1, 80) name: string;
  @Matches(/^\d{10}$/, { message: 'mobile must be 10 digits' }) mobile: string;
}

export class CreateSaleDto {
  @IsUUID() storeId: string;
  @IsOptional() @IsInt() @Min(1) counter?: number;
  @IsOptional() @IsString() @MaxLength(64) clientRef?: string;
  @IsOptional() @IsUUID() priceListId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @ValidateNested() @Type(() => QuickCustomerDto) customer?: QuickCustomerDto;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SaleItemDto) items: SaleItemDto[];
  @IsOptional() @ValidateNested() @Type(() => BillDiscountDto) billDiscount?: BillDiscountDto;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PaymentDto) payments: PaymentDto[];
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
  @IsOptional() @IsUUID() heldBillId?: string;
  @IsOptional() @ValidateNested() @Type(() => OfflineDto) offline?: OfflineDto;
}

export class CancelSaleDto {
  @IsString() @Length(3, 200) reason: string;
}

export class HoldBillDto {
  @IsUUID() storeId: string;
  @IsOptional() @IsString() @MaxLength(60) label?: string;
  @IsOptional() @IsString() @MaxLength(80) customerName?: string;
  @IsInt() @Min(0) itemCount: number;
  @IsNumber() total: number;
  @IsObject() payload: Record<string, unknown>;
}
