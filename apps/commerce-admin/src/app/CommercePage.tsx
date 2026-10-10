import type { ReactNode } from 'react';
import { PageChrome } from '@cp/ui';

/** Fluid workspace content, opted into by individual Commerce pages. */
export function CommercePage({ children }: { children: ReactNode }) {
  return <div className="w-full min-w-0 space-y-4" data-commerce-page="fluid">
    <PageChrome>{children}</PageChrome>
  </div>;
}
