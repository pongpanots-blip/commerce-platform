import { isVisit } from './activity.helpers';

/**
 * Split the checked-out contact types into the one that reuses the open
 * activity row and the rest, which become new sibling "done" activities.
 *
 * A visit-family type (visit/store_visit) only wins as primary when the
 * caller actually selected one at checkout. The check-in row is always
 * created as `store_visit`, so falling back to `openType` here would keep
 * counting a phantom visit even when the caller only selected e.g. `call` -
 * instead, repurpose the row as the first selected type in that case.
 *
 * `openType` is accepted for call-site/API compatibility but no longer
 * influences the result.
 */
export function partitionCheckoutTypes(
  types: string[],
  _openType: string,
): { primaryType: string; extraTypes: string[] } {
  const unique = [...new Set(types)];
  const visitSelected = unique.find((t) => isVisit(t));
  const primaryType = visitSelected ?? unique[0];
  return {
    primaryType,
    extraTypes: unique.filter((t) => t !== primaryType),
  };
}
