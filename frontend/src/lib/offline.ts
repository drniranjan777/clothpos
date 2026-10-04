/**
 * Offline billing support (BRD §23): the store catalogue is cached in IndexedDB so barcodes still scan,
 * sales made without internet are queued with a client-generated id and synced when the connection returns.
 * The server dedupes on clientRef, so a retried sync can never create a second invoice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get, post } from './api';
import type { PosProduct } from '../pages/pos/types';

const DB = 'npos-pos';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'clientRef' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: 'kv' | 'queue', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => { resolve(req.result); db.close(); };
    t.onerror = () => { reject(t.error); db.close(); };
  });
}

// ------------------------------------------------------------ catalogue cache
export interface CachedCatalog {
  storeId: string;
  generatedAt: string;
  products: PosProduct[];
}
const catKey = (storeId: string) => `catalog:${storeId}`;

export async function refreshCatalog(storeId: string): Promise<CachedCatalog | null> {
  try {
    const c = await get<CachedCatalog>('/pos/catalog', { storeId });
    await tx('kv', 'readwrite', (s) => s.put(c, catKey(storeId)));
    return c;
  } catch {
    return null; // offline or server down - keep the previous copy
  }
}
export const loadCatalog = (storeId: string) => tx<CachedCatalog | undefined>('kv', 'readonly', (s) => s.get(catKey(storeId)));
export const saveCatalog = (c: CachedCatalog) => tx('kv', 'readwrite', (s) => s.put(c, catKey(c.storeId)));

/** Barcode / SKU lookup in the cached catalogue. */
export function findInCatalog(c: CachedCatalog | null | undefined, code: string) {
  if (!c) return null;
  const k = code.trim().toUpperCase();
  for (const p of c.products) {
    const v = p.variants.find((x) => x.barcode === code.trim() || x.sku.toUpperCase() === k);
    if (v) return { product: p, variant: v };
  }
  return null;
}

// ------------------------------------------------------------ sale queue
export interface QueuedSale {
  clientRef: string;
  offlineRef: string;
  storeId: string;
  createdAt: string;
  total: number;
  itemCount: number;
  customerName?: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'failed';
  error?: string;
  attempts: number;
}

export const queueAll = () => tx<QueuedSale[]>('queue', 'readonly', (s) => s.getAll());
export const queuePut = (q: QueuedSale) => tx('queue', 'readwrite', (s) => s.put(q));
export const queueDelete = (clientRef: string) => tx('queue', 'readwrite', (s) => s.delete(clientRef));

/** Provisional receipt number: OFF-<store><counter>-<seq>, unique per device. */
export function nextOfflineRef(storeCode: string, counter: number) {
  const key = `npos.offseq.${storeCode}.${counter}`;
  let n = 1;
  try {
    n = Number(localStorage.getItem(key) ?? '0') + 1;
    localStorage.setItem(key, String(n));
  } catch {
    n = Date.now() % 100000;
  }
  return `OFF-${storeCode}${counter}-${String(n).padStart(4, '0')}`;
}

let syncing: Promise<{ synced: number; failed: number }> | null = null;
/** Pushes queued sales oldest-first. Network errors stop the run; validation errors park the sale for review. */
export function syncQueue(): Promise<{ synced: number; failed: number }> {
  syncing ??= (async () => {
    let synced = 0, failed = 0;
    try {
      const items = (await queueAll()).filter((q) => q.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const q of items) {
        try {
          await post('/sales', q.payload);
          await queueDelete(q.clientRef);
          synced++;
        } catch (e) {
          if (e instanceof ApiError && e.status !== 0 && e.status < 500 && e.status !== 401) {
            await queuePut({ ...q, status: 'failed', error: e.message, attempts: q.attempts + 1 });
            failed++;
          } else {
            break; // still offline / server down - try again later
          }
        }
      }
    } finally {
      setTimeout(() => (syncing = null), 0);
    }
    return { synced, failed };
  })();
  return syncing;
}

/** Online status + queue counters for the POS header; syncs on reconnect and every 30 s. */
export function useOfflineSync(onSynced?: (n: number) => void) {
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [busy, setBusy] = useState(false);
  const cb = useRef(onSynced);
  cb.current = onSynced;

  const refreshQueue = useCallback(async () => setQueue(await queueAll().catch(() => [])), []);
  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    setBusy(true);
    const r = await syncQueue().catch(() => ({ synced: 0, failed: 0 }));
    setBusy(false);
    await refreshQueue();
    if (r.synced) cb.current?.(r.synced);
  }, [refreshQueue]);

  useEffect(() => {
    refreshQueue().then(sync);
    const on = () => { setOnline(true); sync(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const t = setInterval(sync, 30_000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t); };
  }, [sync, refreshQueue]);

  return {
    online, busy, queue, sync, refreshQueue,
    pending: queue.filter((q) => q.status === 'pending').length,
    failed: queue.filter((q) => q.status === 'failed').length,
    retry: async (q: QueuedSale) => { await queuePut({ ...q, status: 'pending', error: undefined }); await refreshQueue(); sync(); },
    discard: async (q: QueuedSale) => { await queueDelete(q.clientRef); await refreshQueue(); },
  };
}
