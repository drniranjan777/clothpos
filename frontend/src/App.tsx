import { lazy, ReactNode, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/Layout';
import { Loading } from './components/ui';
import { Role } from './lib/api';
import { homePath, useAuth } from './lib/auth';
import Login from './pages/Login';

const PosPage = lazy(() => import('./pages/pos/PosPage'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Products = lazy(() => import('./pages/Products'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Invoices = lazy(() => import('./pages/Invoices'));
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'));
const Returns = lazy(() => import('./pages/Returns'));
const Customers = lazy(() => import('./pages/Customers'));
const Shift = lazy(() => import('./pages/Shift'));
const Reports = lazy(() => import('./pages/Reports'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const Tenants = lazy(() => import('./pages/admin/Tenants'));
const Plans = lazy(() => import('./pages/admin/Plans'));
const AdminPayments = lazy(() => import('./pages/admin/Payments'));
const AuditLogs = lazy(() => import('./pages/admin/AuditLogs'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Transfers = lazy(() => import('./pages/Transfers'));
const Staff = lazy(() => import('./pages/Staff'));
const Settings = lazy(() => import('./pages/Settings'));

const MANAGE: Role[] = ['tenant_admin', 'store_manager'];
const STOCK: Role[] = ['tenant_admin', 'store_manager', 'inventory_user'];
const ALL: Role[] = ['tenant_admin', 'store_manager', 'cashier', 'inventory_user', 'accountant'];

/** Route guard: signed in + allowed role. `bare` pages (POS) render without the admin shell. */
function Guard({ roles, bare, children }: { roles: Role[]; bare?: boolean; children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (!roles.includes(me.user.role)) return <Navigate to={homePath(me.user.role)} replace />;
  const page = <Suspense fallback={<Loading />}>{children}</Suspense>;
  return bare ? page : <AppShell>{page}</AppShell>;
}

export default function App() {
  const { me, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/pos" element={<Guard roles={['tenant_admin', 'store_manager', 'cashier']} bare><PosPage /></Guard>} />
      <Route path="/dashboard" element={<Guard roles={[...MANAGE, 'accountant']}><Dashboard /></Guard>} />
      <Route path="/products" element={<Guard roles={STOCK}><Products /></Guard>} />
      <Route path="/inventory" element={<Guard roles={STOCK}><Inventory /></Guard>} />
      <Route path="/invoices" element={<Guard roles={ALL}><Invoices /></Guard>} />
      <Route path="/invoices/:id" element={<Guard roles={ALL}><InvoiceDetail /></Guard>} />
      <Route path="/returns" element={<Guard roles={[...MANAGE, 'cashier']}><Returns /></Guard>} />
      <Route path="/customers" element={<Guard roles={[...MANAGE, 'cashier', 'accountant']}><Customers /></Guard>} />
      <Route path="/shift" element={<Guard roles={[...MANAGE, 'cashier']}><Shift /></Guard>} />
      <Route path="/reports" element={<Guard roles={[...MANAGE, 'accountant']}><Reports /></Guard>} />
      <Route path="/purchases" element={<Guard roles={[...STOCK, 'accountant']}><Purchases /></Guard>} />
      <Route path="/suppliers" element={<Guard roles={[...STOCK, 'accountant']}><Suppliers /></Guard>} />
      <Route path="/transfers" element={<Guard roles={STOCK}><Transfers /></Guard>} />
      <Route path="/staff" element={<Guard roles={MANAGE}><Staff /></Guard>} />
      <Route path="/settings" element={<Guard roles={[...MANAGE, 'accountant']}><Settings /></Guard>} />
      <Route path="/admin" element={<Guard roles={['super_admin']}><AdminDashboard /></Guard>} />
      <Route path="/admin/tenants" element={<Guard roles={['super_admin']}><Tenants /></Guard>} />
      <Route path="/admin/plans" element={<Guard roles={['super_admin']}><Plans /></Guard>} />
      <Route path="/admin/payments" element={<Guard roles={['super_admin']}><AdminPayments /></Guard>} />
      <Route path="/admin/audit" element={<Guard roles={['super_admin']}><AuditLogs /></Guard>} />
      <Route path="*" element={loading ? <Loading /> : <Navigate to={me ? homePath(me.user.role) : '/login'} replace />} />
    </Routes>
  );
}
