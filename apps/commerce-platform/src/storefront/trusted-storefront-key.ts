import { SetMetadata } from '@nestjs/common';

export const TRUSTED_STOREFRONT_KEY = 'storefront:trustedKey';

/**
 * josh-only storefront route (customer upsert, checkout, orders, ERP / CS-CRM / DBD relays, winback login):
 * StorefrontApiKeyGuard also requires a TRUSTED key — a STOREFRONT_API_KEYS env key, or a DB key whose id is in
 * STOREFRONT_TRUSTED_KEY_IDS. Any other active key (e.g. one minted on the developer portal) is logged in `warn`
 * mode (the default) and refused with 403 when STOREFRONT_TRUSTED_KEYS_MODE=enforce. Catalog routes stay open to
 * any key.
 */
export const TrustedStorefrontKey = () => SetMetadata(TRUSTED_STOREFRONT_KEY, true);

/** Which key let the request in; set on the request by StorefrontApiKeyGuard. `open` = keyless non-production bootstrap. */
export type StorefrontKeyMatch = { source: 'db'; id: string } | { source: 'env'; id: 'env' } | { source: 'open'; id: null };

export const trustedKeyIds = (): string[] =>
  (process.env.STOREFRONT_TRUSTED_KEY_IDS ?? '').split(',').map((k) => k.trim()).filter(Boolean);

/** Only the exact value `enforce` refuses; anything else (unset included) only logs. */
export const trustedKeysEnforced = (): boolean => process.env.STOREFRONT_TRUSTED_KEYS_MODE?.trim().toLowerCase() === 'enforce';
