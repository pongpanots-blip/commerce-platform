import { priceRequestId } from "../../../../../commerce-platform/src/modules/commerce/product-prices/price-approval-contracts";

export const contentHomeUrl = (productId: string) =>
  "/j/product/" + priceRequestId.parse(productId) + "/content";
export const contentEditUrl = (productId: string) =>
  contentHomeUrl(productId) + "/edit";
export const contentReviewUrl = (productId: string) =>
  contentHomeUrl(productId) + "/review";
export const contentOutcomeUrl = (productId: string, requestId: string) =>
  contentHomeUrl(productId) + "/requests/" + priceRequestId.parse(requestId);
export const canEditProductContent = (role: string) =>
  ["admin", "merchandising", "graphic"].includes(role.trim().toLowerCase());
