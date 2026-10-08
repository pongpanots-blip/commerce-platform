import { Input } from '@josh/shared-ui-web';
import React from 'react';
import {
  EMPTY_NUTRITION_ROW,
  type NutritionItemRow,
} from './product-nutrition.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export type ProductDetailFormValues = {
  ingredients: string;
  allergens: string;
  expiration_info: string;
  storage_instruction: string;
  usage_direction: string;
  expected_restock_at: string;
  nutrition_basis: string;
  nutrition_items: NutritionItemRow[];
};

type Props = {
  values: ProductDetailFormValues;
  onChange: <K extends keyof ProductDetailFormValues>(
    name: K,
    value: ProductDetailFormValues[K],
  ) => void;
};

const TEXTAREA_CLASS =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium text-gray-600">{children}</span>
  );
}

export function ProductDetailFormFields({ values, onChange }: Props) {
  __useUiLocale();
  const updateItem = (index: number, patch: Partial<NutritionItemRow>) => {
    onChange(
      'nutrition_items',
      values.nutrition_items.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const removeItem = (index: number) => {
    onChange(
      'nutrition_items',
      values.nutrition_items.filter((_, i) => i !== index),
    );
  };

  const addItem = () => {
    onChange('nutrition_items', [
      ...values.nutrition_items,
      { ...EMPTY_NUTRITION_ROW },
    ]);
  };

  return (
    <>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">{__uiText("รายละเอียดสินค้า")}</h3>
        <label className="block">
          <FieldLabel>{__uiText("ส่วนประกอบ")}</FieldLabel>
          <textarea
            value={values.ingredients}
            onChange={(e) => onChange('ingredients', e.target.value)}
            rows={3}
            className={TEXTAREA_CLASS}
            placeholder={__uiText("ส่วนประกอบ")}
          />
        </label>
        <label className="block">
          <FieldLabel>{__uiText("สารก่อภูมิแพ้")}</FieldLabel>
          <textarea
            value={values.allergens}
            onChange={(e) => onChange('allergens', e.target.value)}
            rows={2}
            className={TEXTAREA_CLASS}
            placeholder={__uiText("สารก่อภูมิแพ้")}
          />
        </label>
        <label className="block">
          <FieldLabel>{__uiText("ข้อมูลวันหมดอายุ")}</FieldLabel>
          <textarea
            value={values.expiration_info}
            onChange={(e) => onChange('expiration_info', e.target.value)}
            rows={2}
            className={TEXTAREA_CLASS}
            placeholder={__uiText("ข้อมูลวันหมดอายุ")}
          />
        </label>
        <label className="block">
          <FieldLabel>{__uiText("วิธีเก็บรักษา")}</FieldLabel>
          <textarea
            value={values.storage_instruction}
            onChange={(e) => onChange('storage_instruction', e.target.value)}
            rows={2}
            className={TEXTAREA_CLASS}
            placeholder={__uiText("วิธีเก็บรักษา")}
          />
        </label>
        <label className="block">
          <FieldLabel>{__uiText("วิธีใช้")}</FieldLabel>
          <textarea
            value={values.usage_direction}
            onChange={(e) => onChange('usage_direction', e.target.value)}
            rows={2}
            className={TEXTAREA_CLASS}
            placeholder={__uiText("วิธีใช้")}
          />
        </label>
        <label className="block">
          <FieldLabel>{__uiText("คาดว่าจะมีสต็อกเข้า")}</FieldLabel>
          <Input
            type="datetime-local"
            value={values.expected_restock_at}
            onChange={(e) => onChange('expected_restock_at', e.target.value)}
          />
        </label>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">{__uiText("ข้อมูลโภชนาการ")}</h3>
        <label className="block">
          <FieldLabel>{__uiText("ฐาน (เช่น per 100 g)")}</FieldLabel>
          <Input
            value={values.nutrition_basis}
            onChange={(e) => onChange('nutrition_basis', e.target.value)}
            placeholder={__uiText("per 100 g")}
          />
        </label>

        <div className="hidden sm:grid sm:grid-cols-[1fr_8rem_6rem_auto] gap-2 text-xs font-medium text-gray-500 px-0.5">
          <span>{__uiText("สารอาหาร")}</span>
          <span>{__uiText("ค่า")}</span>
          <span>{__uiText("หน่วย")}</span>
          <span />
        </div>

        {values.nutrition_items.map((row, index) => (
          <div
            key={index}
            className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_6rem_auto] gap-2 items-center"
          >
            <Input
              aria-label={__uiText("สารอาหาร แถวที่ {0}", {"0": index + 1})}
              value={row.label}
              onChange={(e) => updateItem(index, { label: e.target.value })}
              placeholder={__uiText("เช่น Total Energy")}
            />
            <Input
              aria-label={__uiText("ค่า แถวที่ {0}", {"0": index + 1})}
              value={row.value}
              onChange={(e) => updateItem(index, { value: e.target.value })}
              placeholder="271"
            />
            <Input
              aria-label={__uiText("หน่วย แถวที่ {0}", {"0": index + 1})}
              value={row.unit}
              onChange={(e) => updateItem(index, { unit: e.target.value })}
              placeholder={__uiText("Kcal")}
            />
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="text-xs text-red-500 hover:underline text-left sm:text-center py-1"
            >
              {__uiText("ลบ")}</button>
          </div>
        ))}

        <button
          type="button"
          onClick={addItem}
          className="text-xs font-medium text-primary hover:underline"
        >
          {__uiText("+ เพิ่มแถว")}</button>
      </div>
    </>
  );
}

export default ProductDetailFormFields;
