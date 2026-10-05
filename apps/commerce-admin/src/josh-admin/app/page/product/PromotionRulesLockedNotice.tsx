import React from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import type { PromotionMechanicRowForm } from '../campain/promotion-mechanic.helpers';

/** `promotion_rules_locked_by` on the admin product read: the mechanic that owns the SKU's price tiers. */
export type PromotionRulesLockedBy = { mechanic_id: string; mechanic_name: string };

/**
 * Read-only stand-in for the tier form on a SKU a promotion mechanic owns. The backend rejects
 * `promotion_rules` for it, so tiers are shown, not edited. `rules` = the MECHANIC's tiers; pass []
 * for an ended or non-tiered mechanic (percentage, BOGO…) — the form's default row is not one of its
 * tiers, so instead of a table the admin is sent to the promotion page for the actual conditions.
 */
export function PromotionRulesLockedNotice({
  lockedBy,
  rules,
}: {
  lockedBy: PromotionRulesLockedBy;
  rules: PromotionMechanicRowForm[];
}) {
  const editHref = ADMIN_ROUTES.promotionsMechanicEdit(lockedBy.mechanic_id);
  return (
    <div data-testid="promotion-rules-locked" className="space-y-3">
      <p className="text-sm text-amber-800">
        ราคาตามจำนวนของสินค้านี้มาจากโปรโมชัน <b>{lockedBy.mechanic_name}</b> — แก้ที่นี่ไม่ได้
      </p>
      {rules.length > 0 ? (
        <>
          <Link to={editHref} className="inline-block text-sm font-medium text-blue-700 underline">
            แก้ที่โปรโมชัน “{lockedBy.mechanic_name}”
          </Link>
          <table className="min-w-full text-sm text-gray-600">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-2 py-1 font-medium">ซื้อขั้นต่ำ</th>
                <th className="px-2 py-1 font-medium">ราคา/หน่วย (฿)</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t border-gray-100">
                  <td className="px-2 py-1">{rule.minQty}</td>
                  <td className="px-2 py-1">{rule.promotionPrice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <Link to={editHref} className="inline-block text-sm font-medium text-blue-700 underline">
          ดูเงื่อนไขในหน้าโปร
        </Link>
      )}
    </div>
  );
}
