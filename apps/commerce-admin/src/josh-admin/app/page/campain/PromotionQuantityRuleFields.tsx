import { Input } from '@josh/shared-ui-web';
import React from 'react';
import {
  createEmptyPromotionRow,
  type PromotionMechanicForm,
  type PromotionMechanicRowForm,
} from './promotion-mechanic.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Props = {
  value: PromotionMechanicForm;
  onChange: (next: PromotionMechanicForm) => void;
  compact?: boolean;
};

export function PromotionQuantityRuleFields({ value, onChange, compact }: Props) {
  __useUiLocale();
  const setUnitLabel = (unitLabel: string) => {
    onChange({ ...value, unitLabel });
  };

  const updateRule = (
    id: string,
    field: keyof Pick<PromotionMechanicRowForm, 'minQty' | 'promotionPrice' | 'badgeText'>,
    fieldValue: string,
  ) => {
    onChange({
      ...value,
      rules: value.rules.map((rule) =>
        rule.id === id ? { ...rule, [field]: fieldValue } : rule,
      ),
    });
  };

  const addRule = () => {
    onChange({
      ...value,
      rules: [...value.rules, createEmptyPromotionRow(value)],
    });
  };

  const removeRule = (id: string) => {
    if (value.rules.length <= 1) return;
    onChange({
      ...value,
      rules: value.rules.filter((rule) => rule.id !== id),
    });
  };

  return (
    <div
      className={
        compact
          ? 'space-y-3'
          : 'space-y-4 rounded-xl border border-gray-100 bg-gray-50 p-4'
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {!compact && (
          <div>
            <h3 className="text-sm font-semibold text-gray-800">
              {__uiText("ราคาตามจำนวน (Quantity Tier)")}</h3>
            <p className="mt-1 text-xs text-gray-500">
              {__uiText("เช่น ซื้อ 1 ชิ้น = ฿100, ซื้อ 5 ชิ้นขึ้นไป = ฿95/ชิ้น")}</p>
          </div>
        )}
        <button
          type="button"
          onClick={addRule}
          className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
        >
          {__uiText("+ เพิ่มขั้นราคา")}</button>
      </div>

      <div className="max-w-xs">
        <Input
          label={__uiText("หน่วยขาย")}
          value={value.unitLabel}
          onChange={(e) => setUnitLabel(e.target.value)}
          placeholder={__uiText("หน่วย เช่น ชิ้น")}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">{__uiText("ซื้อขั้นต่ำ")}</th>
              <th className="px-4 py-2 font-medium">{__uiText("ราคา/หน่วย (฿)")}</th>
              <th className="px-4 py-2 font-medium">{__uiText("ป้ายโปร")}</th>
              <th className="px-4 py-2 font-medium w-16" />
            </tr>
          </thead>
          <tbody>
            {value.rules.map((rule, index) => (
              <tr key={rule.id} className="border-t border-gray-100">
                <td className="px-4 py-2 text-xs text-gray-400">{index + 1}</td>
                <td className="px-4 py-2">
                  <Input
                    aria-label={__uiText("ซื้อขั้นต่ำ แถวที่ {0}", {"0": index + 1})}
                    type="number"
                    min={1}
                    value={rule.minQty}
                    onChange={(e) => updateRule(rule.id, 'minQty', e.target.value)}
                    placeholder={index === 0 ? '1' : __uiText("เช่น 5")}
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    aria-label={__uiText("ราคา/หน่วย (฿) แถวที่ {0}", {"0": index + 1})}
                    type="number"
                    min={0}
                    step="0.01"
                    value={rule.promotionPrice}
                    onChange={(e) =>
                      updateRule(rule.id, 'promotionPrice', e.target.value)
                    }
                    placeholder={__uiText("เช่น 95")}
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    aria-label={__uiText("ป้ายโปร แถวที่ {0}", {"0": index + 1})}
                    value={rule.badgeText}
                    onChange={(e) => updateRule(rule.id, 'badgeText', e.target.value)}
                    placeholder={__uiText("เช่น ซื้อ 5 ลด")}
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeRule(rule.id)}
                    disabled={value.rules.length <= 1}
                    className="text-xs text-red-500 hover:underline disabled:cursor-not-allowed disabled:text-gray-300"
                  >
                    {__uiText("ลบ")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PromotionQuantityRuleFields;
