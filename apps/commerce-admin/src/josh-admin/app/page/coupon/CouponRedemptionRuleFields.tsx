import type { CouponDiscountScope } from '@josh/shared-api';
import { Input, Select } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { FieldLabel } from './CouponCoreForm';
import CouponOptionToggle from './CouponOptionToggle';
import PromotionProductSetPicker from './PromotionProductSetPicker';
import {
  COUPON_PAYMENT_METHOD_OPTIONS,
  effectiveMinSpendBasis,
  paymentMethodLabel,
  pruneRefreshIds,
  type CouponRedemptionForm,
} from './coupon-redemption.helpers';

type Props = {
  value: CouponRedemptionForm;
  onChange: (next: CouponRedemptionForm) => void;
  /** ขอบเขตส่วนลด — state lives in the core form (payload field), control rendered here. */
  discountScope: CouponDiscountScope;
  onDiscountScopeChange: (next: CouponDiscountScope) => void;
  disabled?: boolean;
};

/** เงื่อนไขเดิม (หมวด/SKU แบบเลือกตรง) จากคูปองที่สร้างก่อนมี Promotion Product Set — เก็บไว้ส่งต่อ ไม่มี UI แก้ไข */
function LegacyScopeNotice({
  categoryCount,
  skuCount,
  disabled,
  onClear,
}: {
  categoryCount: number;
  skuCount: number;
  disabled?: boolean;
  onClear: () => void;
}) {
  if (categoryCount === 0 && skuCount === 0) return null;
  const parts: string[] = [];
  if (categoryCount > 0) parts.push(`${categoryCount} หมวด`);
  if (skuCount > 0) parts.push(`${skuCount} SKU`);
  return (
    <p className="text-xs text-gray-500">
      เงื่อนไขเดิม: {parts.join(', ')}{' '}
      <button
        type="button"
        disabled={disabled}
        onClick={onClear}
        className="text-gray-500 underline hover:text-gray-700"
      >
        ล้าง
      </button>
    </p>
  );
}

/** คูปองที่เคยตั้ง "ซื้อ SKU ขั้นต่ำก่อนได้ส่วนลด" ไว้ก่อน UI ตัวนี้ถูกเอาออก (ยังไม่รองรับ) — backend ยัง
 * บังคับ sku_minimums เดิมอยู่ ค่านี้จึงยังต้อง round-trip ผ่านฟอร์ม (ไม่หายไปเฉย ๆ ตอนบันทึกซ้ำ)
 * แต่ไม่มี UI แก้ไขแล้ว มีแค่แจ้งเตือน + ปุ่มล้าง */
function SkuMinimumsLegacyNotice({
  count,
  disabled,
  onClear,
}: {
  count: number;
  disabled?: boolean;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <p className="text-xs text-gray-500">
      เงื่อนไข SKU ขั้นต่ำเดิม: {count} รายการ{' '}
      <button
        type="button"
        disabled={disabled}
        onClick={onClear}
        className="text-gray-500 underline hover:text-gray-700"
      >
        ล้าง
      </button>
    </p>
  );
}

/** คูปองที่เคยตั้ง "แยกยอดขั้นต่ำสินค้าเข้าเงื่อนไข" ไว้ก่อนตัวเลือกนี้ถูกเอาออกจากฟอร์ม —
 * ค่าเดิมยังอยู่ที่ backend จนกว่าจะบันทึกจากฟอร์มนี้อีกครั้ง ซึ่งจะ normalise ให้เท่ากับยอดตะกร้าขั้นต่ำ.
 * (ส่วนลดคิดจากทั้งตะกร้าเสมอที่ backend — ไม่มีค่า "ฐานคำนวณส่วนลด" ให้แจ้งเตือนแล้ว) */
function LegacyDiscountApplyNotice({ legacyMinEligible }: { legacyMinEligible: number | null }) {
  if (legacyMinEligible == null) return null;
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      คูปองนี้เคยตั้ง "ขั้นต่ำสินค้าเข้าเงื่อนไข ฿{legacyMinEligible.toLocaleString()}" ไว้ — ตัวเลือกนี้ถูกยกเลิกแล้ว
      เมื่อบันทึกจะใช้ขั้นต่ำตะกร้าเท่านั้น
    </p>
  );
}

export function CouponRedemptionRuleFields({
  value,
  onChange,
  discountScope,
  onDiscountScopeChange,
  disabled,
}: Props) {
  const discountScopeId = React.useId();
  const minSpendHeadingId = React.useId();
  const hasExcludeData =
    value.excludeProductSetIds.length > 0 ||
    value.excludeCategoryIds.length > 0 ||
    value.excludeProducts.length > 0;
  const [excludeExpanded, setExcludeExpanded] = useState(hasExcludeData);

  useEffect(() => {
    // Detail page loads exclude data asynchronously — re-open once it arrives.
    if (hasExcludeData) setExcludeExpanded(true);
  }, [
    value.excludeProductSetIds.length,
    value.excludeCategoryIds.length,
    value.excludeProducts.length,
    hasExcludeData,
  ]);

  const minSpendBasis = effectiveMinSpendBasis(value, discountScope);

  const patch = (partial: Partial<CouponRedemptionForm>) => {
    onChange({ ...value, ...partial });
  };

  return (
    <div className="space-y-6">
      <div className="sm:w-1/2 sm:pr-2">
        <FieldLabel required htmlFor={discountScopeId}>
          ขอบเขตส่วนลด / Discount scope
        </FieldLabel>
        <Select
          id={discountScopeId}
          className="w-full"
          value={discountScope}
          disabled={disabled}
          onChange={(event) =>
            onDiscountScopeChange(event.target.value as CouponDiscountScope)
          }
        >
          <option value="all">ทุกสินค้า (All products)</option>
          <option value="product">เฉพาะสินค้าที่ร่วมรายการ (Selected products)</option>
          <option value="brand">เฉพาะแบรนด์ที่ร่วมรายการ (Selected brands)</option>
          <option value="category">เฉพาะหมวดหมู่ที่ร่วมรายการ (Selected categories)</option>
        </Select>
        <p className="mt-1 text-xs text-gray-500">
          กำหนดข้อความที่ลูกค้าจะเห็นเมื่อตะกร้ายังไม่มีสินค้าที่เข้าเงื่อนไข — ถ้าไม่ใช่ "ทุกสินค้า"
          ต้องเลือก Promotion Product Set ที่ร่วมรายการด้านล่างอย่างน้อย 1 ชุด
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-gray-100 bg-white p-4">
        <div id={minSpendHeadingId} className="text-sm font-semibold text-gray-800">
          ยอดขั้นต่ำ
        </div>
        {discountScope !== 'all' && (
          <div role="radiogroup" aria-labelledby={minSpendHeadingId} className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="radio"
                className="mt-0.5"
                name="minSpendBasis"
                checked={minSpendBasis === 'cart'}
                disabled={disabled}
                onChange={() => patch({ minSpendBasis: 'cart' })}
              />
              <span>
                <span className="block font-medium text-gray-800">นับยอดทั้งตะกร้า</span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  ทุก SKU ในตะกร้า (ไม่รวมสินค้าที่ยกเว้น) ก่อน VAT — ตะกร้าต้องมีสินค้าร่วมรายการอย่างน้อย 1 ชิ้น
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="radio"
                className="mt-0.5"
                name="minSpendBasis"
                checked={minSpendBasis === 'eligible_items'}
                disabled={disabled}
                onChange={() => patch({ minSpendBasis: 'eligible_items' })}
              />
              <span>
                <span className="block font-medium text-gray-800">นับเฉพาะสินค้าที่เข้าเงื่อนไข</span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  รวมยอดก่อน VAT ของ SKU ที่ร่วมรายการ (หักสินค้าที่ยกเว้น)
                </span>
              </span>
            </label>
          </div>
        )}
        <Input
          type="number"
          min={0}
          inputMode="decimal"
          label={
            minSpendBasis === 'eligible_items'
              ? 'ยอดขั้นต่ำเฉพาะสินค้าที่เข้าเงื่อนไข (บาท, ก่อน VAT)'
              : 'ยอดขั้นต่ำทั้งตะกร้า (บาท, ก่อน VAT)'
          }
          value={value.minCartAmount}
          disabled={disabled}
          onChange={(event) => patch({ minCartAmount: event.target.value })}
          placeholder="0 = ไม่กำหนด"
        />
      </div>

      <LegacyDiscountApplyNotice legacyMinEligible={value.legacyMinEligible} />

      <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
        <div className="text-sm font-semibold text-gray-800">สินค้าที่นับเข้าเงื่อนไข</div>

        {discountScope === 'all' ? (
          <p className="text-xs text-gray-500">
            ทุกสินค้าในตะกร้าเข้าเงื่อนไข — เปลี่ยนได้ที่ "ขอบเขตส่วนลด" ด้านบน
          </p>
        ) : (
          <div className="space-y-2">
            <PromotionProductSetPicker
              title="Promotion Product Set ที่นับเข้าเงื่อนไข"
              hint="ส่วนลดคำนวณจากสินค้าในชุดที่เลือกเท่านั้น — ต้องเลือกอย่างน้อย 1 ชุด"
              selectedIds={value.includeProductSetIds}
              disabled={disabled}
              onChange={(includeProductSetIds) =>
                patch({
                  includeProductSetIds,
                  refreshProductSetIds: pruneRefreshIds(
                    value.refreshProductSetIds,
                    includeProductSetIds,
                    value.excludeProductSetIds,
                  ),
                })
              }
              snapshots={value.productSetSnapshots}
              refreshIds={value.refreshProductSetIds}
              onRefreshChange={(refreshProductSetIds) => patch({ refreshProductSetIds })}
            />
            <LegacyScopeNotice
              categoryCount={value.includeCategoryIds.length}
              skuCount={value.includeProducts.length}
              disabled={disabled}
              onClear={() => patch({ includeCategoryIds: [], includeProducts: [] })}
            />
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50/40 p-4">
        <div className="text-sm font-semibold text-gray-800">สินค้าที่ไม่รวมในเงื่อนไข</div>
        {excludeExpanded ? (
          <>
            <p className="text-xs text-gray-500">
              สินค้าในชุดที่เลือกจะไม่ถูกนับเข้ายอดขั้นต่ำและไม่ได้รับส่วนลด
            </p>
            <PromotionProductSetPicker
              title="Promotion Product Set ที่ไม่รวม"
              hint="เช่น สินค้าโปรโมชัน / แพ็กพิเศษ"
              selectedIds={value.excludeProductSetIds}
              disabled={disabled}
              onChange={(excludeProductSetIds) =>
                patch({
                  excludeProductSetIds,
                  refreshProductSetIds: pruneRefreshIds(
                    value.refreshProductSetIds,
                    value.includeProductSetIds,
                    excludeProductSetIds,
                  ),
                })
              }
              snapshots={value.productSetSnapshots}
              refreshIds={value.refreshProductSetIds}
              onRefreshChange={(refreshProductSetIds) => patch({ refreshProductSetIds })}
            />
            <LegacyScopeNotice
              categoryCount={value.excludeCategoryIds.length}
              skuCount={value.excludeProducts.length}
              disabled={disabled}
              onClear={() => patch({ excludeCategoryIds: [], excludeProducts: [] })}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setExcludeExpanded(false);
                patch({
                  excludeProductSetIds: [],
                  excludeCategoryIds: [],
                  excludeProducts: [],
                  refreshProductSetIds: pruneRefreshIds(
                    value.refreshProductSetIds,
                    value.includeProductSetIds,
                    [],
                  ),
                });
              }}
              className="text-xs text-gray-500 underline hover:text-gray-700"
            >
              ยกเลิก
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setExcludeExpanded(true)}
            className="rounded-lg border border-dashed border-amber-300 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50"
          >
            + กำหนดสินค้า/หมวดที่ไม่รวม
          </button>
        )}
      </div>

      <SkuMinimumsLegacyNotice
        count={value.skuMinimums.length}
        disabled={disabled}
        onClear={() => patch({ skuMinimums: [] })}
      />

      <div>
        <div className="mb-2 text-sm font-semibold text-gray-800">ช่องทางชำระเงิน</div>
        <div className="space-y-3">
          <CouponOptionToggle
            checked={value.restrictPaymentMethods}
            disabled={disabled}
            onChange={(checked) =>
              patch({
                restrictPaymentMethods: checked,
                allowedPaymentMethods: checked ? value.allowedPaymentMethods : [],
              })
            }
            title="จำกัดช่องทางชำระเงินที่ใช้คูปองได้"
          />
          {value.restrictPaymentMethods && (
            <Select
              label="ช่องทางชำระเงินที่ใช้ได้"
              placeholder="เลือกช่องทาง…"
              multiple
              disabled={disabled}
              value={value.allowedPaymentMethods}
              onChange={(event) =>
                patch({
                  allowedPaymentMethods: Array.from(
                    (event.target as HTMLSelectElement).selectedOptions,
                  ).map((option) => option.value),
                })
              }
            >
              {COUPON_PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {value.allowedPaymentMethods
                .filter(
                  (method) =>
                    !COUPON_PAYMENT_METHOD_OPTIONS.some(
                      (option) => option.value === method,
                    ),
                )
                .map((method) => (
                  <option key={method} value={method} disabled>
                    {paymentMethodLabel(method)} — เลิกใช้แล้ว
                  </option>
                ))}
            </Select>
          )}
        </div>
      </div>
    </div>
  );
}

export default CouponRedemptionRuleFields;
