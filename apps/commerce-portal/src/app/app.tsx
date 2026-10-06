import { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell, Button, IconButton, NavGroup, Sidebar, TopBar } from '@cp/ui';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { ApiKeys } from './pages/ApiKeys';
import { Webhooks } from './pages/Webhooks';
import { Docs } from './pages/Docs';
import { auth, tokenClaims } from '../lib/api';

const NAV: NavGroup[] = [
  {
    links: [
      { to: '/', label: 'Dashboard', end: true, icon: 'dashboard' },
      { to: '/keys', label: 'API Keys', end: false, icon: 'key' },
      { to: '/webhooks', label: 'Webhooks', end: false, icon: 'webhook' },
      { to: '/docs', label: 'Documentation', end: false, icon: 'description' },
    ],
  },
];

/** Every non-auth route requires a token; bounce to /login without one. */
function RequireAuth({ children }: { children: ReactNode }) {
  if (!auth.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function PortalTopBar() {
  const route = window.location.pathname;
  const pageTitle = route === '/' ? 'Dashboard' : route === '/keys' ? 'API Keys' : route === '/webhooks' ? 'Webhooks' : 'Documentation';

  return (
    <TopBar
      left={
        <>
          <span className="font-headline text-xs font-semibold text-on-surface">Commerce Platform</span>
          <span className="text-outline-variant">/</span>
          <span className="text-outline-variant">Developer portal</span>
          <span className="text-outline-variant">/</span>
          <span className="text-primary font-semibold">{pageTitle}</span>
        </>
      }
      right={
        <>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 border border-green-200 text-emerald-700 rounded-full text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            <span>{import.meta.env.MODE === 'production' ? 'Production' : 'Local dev'}</span>
          </div>
          <div className="h-4 w-px bg-outline-variant/30" />
          <IconButton icon="help" title="Docs" onClick={() => window.location.assign('/docs')} />
          <div className="h-4 w-px bg-outline-variant/30" />
          <Button
            variant="primary"
            icon="add"
            onClick={() => window.location.assign('/keys')}
          >
            Create Key
          </Button>
        </>
      }
    />
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
              <AppShell
                sidebar={
                  <Sidebar
                    brand={{ title: 'Commerce Platform', subtitle: 'Developer portal', icon: 'polyline' }}
                    nav={NAV}
                    user={{
                      name: tokenClaims()?.email?.split('@')[0] ?? 'Partner',
                      detail: tokenClaims()?.email,
                      onSignOut: () => {
                        auth.logout();
                        window.location.assign('/login');
                      },
                    }}
                  />
                }
                topbar={<PortalTopBar />}
              >
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/keys" element={<ApiKeys />} />
                  <Route path="/webhooks" element={<Webhooks />} />
                  <Route path="/docs" element={<Docs />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppShell>
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
