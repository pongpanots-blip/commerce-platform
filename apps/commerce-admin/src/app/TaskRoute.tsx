import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorText } from '@cp/ui';
import { isRouteAllowed } from '../lib/landing';
/** Check permissions before reads; base and action routes share the same component tree. */
export function TaskRoute({ role, children }: { role?: string; children: ReactNode }) {
  const { pathname } = useLocation();
  return isRouteAllowed(role, pathname) ? children : <ErrorText error="คุณไม่มีสิทธิ์เปิดหน้านี้" />;
}
