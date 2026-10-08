import { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell, Button, CommandMenu, IconButton, LanguageSelector, NavGroup, Sidebar, TopBar, NavProvider, useUiLocale } from '@cp/ui';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { ApiKeys } from './pages/ApiKeys';
import { Webhooks } from './pages/Webhooks';
import { Docs } from './pages/Docs';
import { auth, tokenClaims } from '../lib/api';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
  __useUiLocale();
  const { pathname: route } = useLocation();
  const navigate = useNavigate();
  const pageTitle = route === '/' ? 'Dashboard' : route === '/keys' ? 'API Keys' : route === '/webhooks' ? 'Webhooks' : 'Documentation';

  return (
    <TopBar
      left={
        <>
          <span className="font-headline text-xs font-semibold text-on-surface">{__uiText("Commerce Platform")}</span>
          <span className="text-outline-variant">/</span>
          <span className="text-outline-variant">{__uiText("Developer portal")}</span>
          <span className="text-outline-variant">/</span>
          <span className="text-primary font-semibold">{__uiText(pageTitle)}</span>
        </>
      }
      right={
        <>
          <LanguageSelector />
          <CommandMenu />
          <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 border border-green-200 text-emerald-700 rounded-full text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            <span>{import.meta.env.MODE === 'production' ? __uiText("Production") : __uiText("Local dev")}</span>
          </div>
          <div className="h-4 w-px bg-outline-variant/30" />
          <IconButton icon="help" title={__uiText("Docs")} onClick={() => navigate('/docs')} />
          <div className="h-4 w-px bg-outline-variant/30" />
          <Button
            variant="primary"
            icon="add"
            onClick={() => navigate('/keys?create=1')}
          >
            {__uiText("Create Key")}</Button>
        </>
      }
    />
  );
}

export function App() {
  useUiLocale();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <NavProvider nav={NAV}>
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
              </NavProvider>
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
