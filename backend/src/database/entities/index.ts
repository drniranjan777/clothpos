import { Brand, Category, Color, PriceList, Product, ProductPrice, ProductVariant, Size } from './catalog.entities';
import { AuditLog, RefreshToken, Store, User } from './org.entities';
import { Purchase, PurchaseItem, StockTransfer, StockTransferItem, Supplier, SupplierPayment } from './purchase.entities';
import { Plan, Subscription, SubscriptionPayment, Tenant } from './platform.entities';
import {
  CashierShift, Customer, HeldBill, Inventory, InventoryTransaction, Sale, SaleItem, SalePayment, SaleReturn, SaleReturnItem,
} from './sales.entities';

export * from './catalog.entities';
export * from './org.entities';
export * from './platform.entities';
export * from './purchase.entities';
export * from './sales.entities';

export const ENTITIES = [
  Plan, Tenant, Subscription, SubscriptionPayment,
  Store, User, RefreshToken, AuditLog,
  Category, Brand, Size, Color, Product, ProductVariant, PriceList, ProductPrice,
  Inventory, InventoryTransaction, Customer, CashierShift,
  Sale, SaleItem, SalePayment, HeldBill, SaleReturn, SaleReturnItem,
  Supplier, Purchase, PurchaseItem, SupplierPayment, StockTransfer, StockTransferItem,
];
