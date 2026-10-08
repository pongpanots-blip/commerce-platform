/**
 * `iss` on every access JWT commerce signs (AuthModule signOptions, so the staff login, the portal login and the
 * refresh-token path all carry it). Lets a verifier pick the right secret from the token itself instead of trying
 * secrets in turn — josh's tokens have no `iss` and carry `tokenVersion` / `companyId` instead.
 */
export const COMMERCE_JWT_ISSUER = 'commerce-platform';
