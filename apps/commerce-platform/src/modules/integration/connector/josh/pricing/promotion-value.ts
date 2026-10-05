// Copied from josh apps/backend/src/shared/{helpers,types} (origin/main d84d692b). Only imports changed:
// josh entities → slim copies in ./josh-pricing-tables, date helper → ../jagota/date-only.helper.
import { BadRequestException } from '@nestjs/common';
import {
  PromotionQuantityRuleRow,
  resolvePromotionPrice,
} from './pricing.types';

export type PromotionValue =
  | { type: 'fixed'; amount: number }
  | { type: 'percentage'; percent: number }
  | { type: 'tiered'; tiers: PromotionQuantityRuleRow[] }
  | {
      type: 'bogo';
      buy_qty: number;
      get_qty: number;
      get_discount_percent: number;
    };

export const PROMOTION_PREDICATE_FIELDS = [
  'cart.total',
  'cart.line_item_count',
  'sku',
  'group_id',
] as const;

export type PromotionPredicateField =
  (typeof PROMOTION_PREDICATE_FIELDS)[number];

export const PROMOTION_PREDICATE_OPS = [
  '>=',
  '<=',
  '>',
  '<',
  '==',
  '!=',
  'in',
] as const;

export type PromotionPredicateOp = (typeof PROMOTION_PREDICATE_OPS)[number];

export type PromotionPredicateCondition = {
  field: PromotionPredicateField;
  op: PromotionPredicateOp;
  value: number | string | string[];
};

export type PromotionPredicateNode =
  | { op: 'and' | 'or'; conditions: PromotionPredicateNode[] }
  | PromotionPredicateCondition;

function isConditionNode(
  node: PromotionPredicateNode,
): node is PromotionPredicateCondition {
  return 'field' in node;
}

/**
 * Validates predicate shape/whitelist at write time (creating/updating a
 * PromotionMechanic). Fails closed with a clear error rather than letting an
 * unrecognized field/op silently no-op at evaluation time.
 */
export function validatePromotionPredicate(
  predicate: PromotionPredicateNode | null | undefined,
): void {
  if (predicate == null) return;

  if ('conditions' in predicate) {
    if (predicate.op !== 'and' && predicate.op !== 'or') {
      throw new BadRequestException(
        `predicate.op ต้องเป็น 'and' หรือ 'or'`,
      );
    }
    if (!predicate.conditions?.length) {
      throw new BadRequestException('predicate.conditions ต้องมีอย่างน้อย 1 รายการ');
    }
    predicate.conditions.forEach(validatePromotionPredicate);
    return;
  }

  if (!isConditionNode(predicate)) {
    throw new BadRequestException('รูปแบบ predicate ไม่ถูกต้อง');
  }
  if (!PROMOTION_PREDICATE_FIELDS.includes(predicate.field)) {
    throw new BadRequestException(`predicate.field ไม่รองรับ: ${predicate.field}`);
  }
  if (!PROMOTION_PREDICATE_OPS.includes(predicate.op)) {
    throw new BadRequestException(`predicate.op ไม่รองรับ: ${predicate.op}`);
  }
}

export function validatePromotionValue(
  value: PromotionValue | null | undefined,
): void {
  if (value == null) return;

  switch (value.type) {
    case 'fixed':
      if (!(value.amount >= 0)) {
        throw new BadRequestException('value.amount ต้องไม่ติดลบ');
      }
      return;
    case 'percentage':
      if (!(value.percent >= 0 && value.percent <= 100)) {
        throw new BadRequestException('value.percent ต้องอยู่ระหว่าง 0-100');
      }
      return;
    case 'tiered':
      if (!value.tiers?.length) {
        throw new BadRequestException('value.tiers ต้องมีอย่างน้อย 1 รายการ');
      }
      return;
    case 'bogo':
      if (!(value.buy_qty > 0) || !(value.get_qty > 0)) {
        throw new BadRequestException('value.buy_qty และ value.get_qty ต้องมากกว่า 0');
      }
      if (!(value.get_discount_percent >= 0 && value.get_discount_percent <= 100)) {
        throw new BadRequestException('value.get_discount_percent ต้องอยู่ระหว่าง 0-100');
      }
      return;
    default:
      throw new BadRequestException('รูปแบบ value ไม่ถูกต้อง');
  }
}

export type PromotionDiscountResult = {
  /** Set for value types that resolve to a final unit price (e.g. tiered). */
  finalPrice?: number;
  /** Set for value types that resolve to a discount amount off the line total. */
  discountAmount?: number;
};

/**
 * Resolves a PromotionValue against a base price/quantity.
 * SKU path: pricing.resolver.ts wires active mechanic sku-item `value`
 * (tiered / percentage / bogo) into resolveSkuPrice / resolveSkuPricesBatch
 * as source `promotion_mechanic`. Cart/group-level discount orchestration
 * vs Coupon remains a separate decision.
 */
export function resolvePromotionValue(
  value: PromotionValue | null | undefined,
  ctx: { basePrice: number; quantity: number },
): PromotionDiscountResult {
  if (value == null) return {};

  const lineTotal = ctx.basePrice * ctx.quantity;

  switch (value.type) {
    case 'fixed':
      return { discountAmount: Math.min(value.amount, Math.max(lineTotal, 0)) };
    case 'percentage':
      return { discountAmount: (lineTotal * value.percent) / 100 };
    case 'tiered':
      return {
        finalPrice: resolvePromotionPrice(value.tiers, ctx.quantity, ctx.basePrice),
      };
    case 'bogo': {
      const setSize = value.buy_qty + value.get_qty;
      const numSets = Math.floor(ctx.quantity / setSize);
      const freeItems = numSets * value.get_qty;
      return {
        discountAmount: freeItems * ctx.basePrice * (value.get_discount_percent / 100),
      };
    }
    default:
      return {};
  }
}
