import { useEffect, useState } from 'react';
import { getBanner } from './shared-api';

declare const process: { env?: Record<string, string | undefined> } | undefined;

/** Same origin resolution as the Banner admin page — asset paths are relative. */
const APP_URL = (
  (typeof process !== 'undefined' && (process.env?.VITE_APP_URL || process.env?.VITE_API_URL)) ||
  'https://joshapp.io/api'
).replace(/\/api\/?$/, '');

/** Banner library rows carry relative asset paths; push/popup need absolute URLs. */
export function toAbsoluteAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${APP_URL}${path}`;
}

export type BannerOption = { id?: string; title: string; url: string };

/**
 * Banners uploaded in `/admin/banner`, reusable as notify-template banners and
 * show_offer popup images — loaded once per mounting component.
 */
export function useBannerLibrary(): BannerOption[] {
  const [banners, setBanners] = useState<BannerOption[]>([]);
  useEffect(() => {
    getBanner(1, 100)
      .then((response: any) => {
        const rows = response?.data?.data ?? [];
        setBanners(
          (Array.isArray(rows) ? rows : [])
            .filter((row: any) => row.image_url_desktop)
            .map((row: any) => ({
              id: row.id,
              title: row.title || row.image_url_desktop,
              url: toAbsoluteAssetUrl(row.image_url_desktop),
            })),
        );
      })
      .catch(() => setBanners([]));
  }, []);
  return banners;
}
