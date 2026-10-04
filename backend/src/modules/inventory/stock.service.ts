import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { AuthUser } from '../../common/auth';
import { Inventory, InventoryTransaction, InventoryTxnType } from '../../database/entities';

export interface StockMove {
  tenantId: string;
  storeId: string;
  variantId: string;
  /** signed quantity: + adds stock, - removes stock */
  qty: number;
  type: InventoryTxnType;
  referenceType?: string;
  referenceId?: string;
  referenceNo?: string;
  note?: string;
  /** allow the balance to go below zero (authorised override / tenant setting) */
  allowNegative?: boolean;
  /** label used in the error message when stock is short */
  label?: string;
}

/**
 * Single entry point for every stock change. Locks the inventory row (SELECT ... FOR UPDATE)
 * inside the caller's transaction, validates availability and appends to the stock ledger.
 */
@Injectable()
export class StockService {
  async move(em: EntityManager, m: StockMove, user: AuthUser | null, at?: Date) {
    const repo = em.getRepository(Inventory);
    let row = await repo
      .createQueryBuilder('i')
      .setLock('pessimistic_write')
      .where('i.storeId = :s AND i.variantId = :v', { s: m.storeId, v: m.variantId })
      .getOne();
    if (!row) {
      await repo.createQueryBuilder().insert().values({ tenantId: m.tenantId, storeId: m.storeId, variantId: m.variantId, quantity: 0 }).orIgnore().execute();
      row = await repo.createQueryBuilder('i').setLock('pessimistic_write').where('i.storeId = :s AND i.variantId = :v', { s: m.storeId, v: m.variantId }).getOneOrFail();
    }
    const balance = row.quantity + m.qty;
    if (m.qty < 0 && balance < 0 && !m.allowNegative) {
      throw new BadRequestException(`Insufficient stock for ${m.label ?? 'item'}: ${row.quantity} available, ${-m.qty} requested`);
    }
    await repo.update(row.id, { quantity: balance });
    await em.getRepository(InventoryTransaction).insert({
      tenantId: m.tenantId,
      storeId: m.storeId,
      variantId: m.variantId,
      type: m.type,
      quantity: m.qty,
      balanceAfter: balance,
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      referenceNo: m.referenceNo,
      note: m.note,
      userId: user?.sub ?? null,
      userName: user?.name,
      ...(at ? { createdAt: at, updatedAt: at } : {}),
    });
    return balance;
  }
}
