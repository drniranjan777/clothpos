import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { get, getSession, post, refresh, Role, SessionUser, setSession } from './api';

export interface StoreInfo {
  id: string;
  name: string;
  code: string;
  counters: number;
  address?: string;
  phone?: string;
  gstin?: string;
}
export interface Me {
  user: SessionUser;
  tenant: { id: string; businessName: string; gstin?: string; city?: string; stateCode?: string; status: string } | null;
  stores: StoreInfo[];
  subscription: {
    status: string;
    billingCycle: string;
    startDate: string;
    endDate: string;
    amount: number;
    plan: { name: string; code: string; maxStores: number | null; maxUsers: number | null; maxSkus: number | null };
  } | null;
  modules: string[];
  settings: { allowNegativeStock: boolean; cashierDiscountLimitPct: number; returnWindowDays: number; roundOff: boolean; invoiceFooter: string; receiptWidth: 58 | 80; loyaltyPointsPer100: number; cashVarianceTolerance: number } | null;
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  store: StoreInfo | null;
  setStoreId: (id: string) => void;
  login: (login: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
const STORE_KEY = 'clothpos.store';
const readStore = () => {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [storeId, setStoreIdState] = useState<string | null>(readStore());

  const reload = useCallback(async () => {
    try {
      // after a page load there is no access token yet: restore it from the refresh cookie
      if (!getSession() && !(await refresh())) {
        setMe(null);
        return;
      }
      setMe(await get<Me>('/auth/me'));
    } catch {
      setSession(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const onLogout = () => setMe(null);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, [reload]);

  const setStoreId = (id: string) => {
    setStoreIdState(id);
    try {
      localStorage.setItem(STORE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const login = async (loginId: string, password: string) => {
    setSession(await post('/auth/login', { login: loginId, password }));
    const m = await get<Me>('/auth/me');
    setMe(m);
    return m;
  };

  const logout = async () => {
    setSession(null);
    setMe(null);
    await post('/auth/logout').catch(() => undefined);
  };

  const store = me?.stores.find((s) => s.id === storeId) ?? me?.stores[0] ?? null;
  const can = (...roles: Role[]) => !!me && roles.includes(me.user.role);

  return <Ctx.Provider value={{ me, loading, store, setStoreId, login, logout, reload, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin',
  tenant_admin: 'Owner / Admin',
  store_manager: 'Store Manager',
  cashier: 'Cashier',
  inventory_user: 'Inventory',
  accountant: 'Accountant',
};

export const homePath = (role: Role) => (role === 'super_admin' ? '/admin' : role === 'cashier' ? '/pos' : role === 'inventory_user' ? '/inventory' : '/dashboard');
