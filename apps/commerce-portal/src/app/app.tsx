import { ReactNode } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { ApiKeys } from './pages/ApiKeys';
import { Webhooks } from './pages/Webhooks';
import { Docs } from './pages/Docs';
import { auth } from '../lib/api';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/keys', label: 'API Keys', end: false },
  { to: '/webhooks', label: 'Webhooks', end: false },
  { to: '/docs', label: 'Docs', end: false },
];

/** Every non-auth route requires a token; bounce to /login without one. */
function RequireAuth({ children }: { children: ReactNode }) {
  if (!auth.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Commerce Platform<small>Developer portal</small></div>
        <nav className="nav">
          {NAV.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: '10px' }}>
          <button
            className="btn ghost sm"
            style={{ width: '100%' }}
            onClick={() => {
              auth.logout();
              window.location.assign('/login');
            }}
          >
            Logout
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <PortalLayout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/keys" element={<ApiKeys />} />
                  <Route path="/webhooks" element={<Webhooks />} />
                  <Route path="/docs" element={<Docs />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </PortalLayout>
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
