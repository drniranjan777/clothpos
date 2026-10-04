export interface PosVariant {
  id: string;
  sku: string;
  barcode: string;
  size?: string;
  color?: string;
  colorHex?: string;
  mrp: number;
  price: number;
  stock: number;
  minStock: number;
}
export interface PosProduct {
  id: string;
  name: string;
  code: string;
  categoryId: string | null;
  brand?: string;
  hsnCode?: string;
  gstRate: number;
  imageUrl?: string | null;
  artType: string;
  artColor: string;
  variants: PosVariant[];
}
export interface CartLine {
  variant: PosVariant;
  product: Pick<PosProduct, 'id' | 'name' | 'gstRate' | 'artType' | 'artColor' | 'imageUrl' | 'hsnCode'>;
  qty: number;
  /** rupees off this line */
  discount: number;
}
export interface PosCustomer {
  id?: string;
  name: string;
  mobile: string;
  loyaltyPoints?: number;
  storeCredit?: number;
  gstin?: string;
}
export type BillDiscount = { type: 'flat' | 'percent'; value: number } | null;

export const variantLabel = (v: Pick<PosVariant, 'size' | 'color'>) => [v.size, v.color].filter(Boolean).join(' · ');
