/**
 * Longest customer email ERP can store (CUSTOMER_DETAILS_P.EMAIL). The backend
 * enforces it on signup; frontends use it to show the error before submitting.
 * Keep in sync with `CUSTOMER_EMAIL_MAX_LENGTH` in
 * apps/backend/src/shared/constants/customer-email.constants.ts.
 */
export const CUSTOMER_EMAIL_MAX_LENGTH = 50;
