/**
 * Minting a new storefront key needs an approved developer account. Approval is the operator adding the
 * account id (users.id, shown as `accountId` by register/login) to PORTAL_KEY_MINT_ACCOUNT_IDS
 * (comma-separated). Unset = no account may mint. `*` = any active account (dev/e2e only, like the
 * pre-approval behaviour). Listing, revoking and every key already issued
 * (including josh's) keep working: the storefront guard never reads this list.
 */
export const KEY_MINT_NOT_APPROVED_MESSAGE =
  'This developer account is not approved to create API keys; contact the Commerce Platform team';

export const keyMintApprovedAccountIds = (): string[] =>
  (process.env.PORTAL_KEY_MINT_ACCOUNT_IDS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const keyMintApproved = (accountId: string | undefined): boolean =>
  !!accountId && (() => {
    const ids = keyMintApprovedAccountIds();
    return ids.includes('*') || ids.includes(accountId.trim().toLowerCase());
  })();
