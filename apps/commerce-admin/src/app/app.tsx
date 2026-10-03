import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { session } from '../lib/api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Integrations } from './pages/Integrations';
import { Webhooks } from './pages/Webhooks';
import { Subscriptions } from './pages/Subscriptions';
import { SyncJobs } from './pages/SyncJobs';
import { Customers } from './pages/Customers';
import { Products } from './pages/Products';
import { Inventory } from './pages/Inventory';
import { Orders } from './pages/Orders';
import { Reservations } from './pages/Reservations';
import { ErpStock } from './pages/ErpStock';
import { ErpIngest } from './pages/ErpIngest';

const NAV = [
  { group: 'Platform', links: [{ to: '/', label: 'Overview', end: true }] },
  {
    group: 'Integration',
    links: [
      { to: '/integrations', label: 'Integrations', end: false },
      { to: '/webhooks', label: 'Webhook events (in)', end: false },
      { to: '/subscriptions', label: 'Outgoing webhooks', end: false },
      { to: '/sync-jobs', label: 'Sync jobs', end: false },
      { to: '/erp-stock', label: 'ERP stub stock', end: false },
      { to: '/erp-ingest', label: 'ERP ingest', end: false },
    ],
  },
  {
    group: 'Commerce data',
    links: [
      { to: '/customers', label: 'Customers', end: false },
      { to: '/products', label: 'Products', end: false },
      { to: '/inventory', label: 'Inventory', end: false },
      { to: '/orders', label: 'Orders', end: false },
      { to: '/reservations', label: 'Reservations', end: false },
    ],
  },
];

export function App() {
  const [signedIn, setSignedIn] = useState(() => Boolean(session.get()));
  useEffect(() => {
    const expired = () => setSignedIn(false);
    window.addEventListener('cp-session-expired', expired);
    return () => window.removeEventListener('cp-session-expired', expired);
  }, []);

  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

  function signOut() {
    session.clear();
    setSignedIn(false);
  }

  return (
    <BrowserRouter>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">Commerce Platform<small>Admin console</small></div>
          <nav className="nav">
            {NAV.map((section) => (
              <div key={section.group}>
                <div className="group">{section.group}</div>
                {section.links.map((l) => (
                  <NavLink key={l.to} to={l.to} end={l.end}>
                    {l.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <span>Signed in</span>
            <button className="btn ghost sm" type="button" onClick={signOut}>Sign out</button>
          </div>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/webhooks" element={<Webhooks />} />
            <Route path="/subscriptions" element={<Subscriptions />} />
            <Route path="/sync-jobs" element={<SyncJobs />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/products" element={<Products />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/reservations" element={<Reservations />} />
            <Route path="/erp-stock" element={<ErpStock />} />
            <Route path="/erp-ingest" element={<ErpIngest />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
