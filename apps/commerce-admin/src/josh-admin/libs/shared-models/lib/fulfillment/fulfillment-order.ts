/**
 * The one order shipment groups are presented in, everywhere: the cart's
 * sections, the checkout wizard's steps ("Shipment 1" is always the first entry
 * here), and the orders created from them.
 *
 * Plain constant on purpose — no env var, no runtime config. Change this array
 * and every surface follows.
 */
export const FULFILLMENT_ORDER = ['standard', 'preorder'] as const;

/** Section heading each group is shown under. */
export const FULFILLMENT_LABEL: Record<(typeof FULFILLMENT_ORDER)[number], string> = {
  standard: 'Ready to ship',
  preorder: 'Pre-order',
};
