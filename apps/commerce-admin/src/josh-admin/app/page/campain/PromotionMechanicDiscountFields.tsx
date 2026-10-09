import { Button, Input, Select } from '@josh/shared-ui-web';
import { useId } from 'react';
import { AiOutlineDelete, AiOutlinePlus } from 'react-icons/ai';
import {
  VALUE_TYPE_OPTIONS,
  nextTierRow,
  tierErrorKey,
  type MechanicForm,
  type MechanicFormErrors,
  type MechanicTierRow,
  type MechanicValueType,
} from './promotion-mechanic-form.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Props = {
  form: MechanicForm;
  onChange: (patch: Partial<MechanicForm>) => void;
  errors: MechanicFormErrors;
  /** Locked (legacy mechanic with no set picked yet): nothing here would be sent. */
  disabled?: boolean;
};

/** Fields for the one `value` every SKU of the mechanic shares. */
export default function PromotionMechanicDiscountFields({ form, onChange, errors, disabled }: Props) {
  __useUiLocale();
  const tiersErrorId = useId();
  const updateTier = (id: string, patch: Partial<MechanicTierRow>) =>
    onChange({
      tiers: form.tiers.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });

  return (
    <div className="space-y-4">
      <div className="sm:w-1/2 sm:pr-2">
        <Select
          label={__uiText("รูปแบบส่วนลด")}
          data={VALUE_TYPE_OPTIONS}
          value={form.valueType}
          disabled={disabled}
          onChange={(event) => onChange({ valueType: event.target.value as MechanicValueType })}
        />
      </div>

      {form.valueType === 'percentage' && (
        <div className="sm:w-1/2 sm:pr-2">
          <Input
            label={__uiText("ส่วนลด")}
            required
            type="number"
            min={0}
            max={100}
            unit="%"
            disabled={disabled}
            value={form.percent}
            error={errors.percent}
            aria-invalid={!!errors.percent}
            onChange={(event) => onChange({ percent: event.target.value })}
          />
        </div>
      )}

      {form.valueType === 'special_price' && (
        <div className="sm:w-1/2 sm:pr-2">
          <Input
            label={__uiText("ราคาโปร (ราคารวมต่อหน่วยสั่ง)")}
            required
            type="number"
            min={0}
            step="0.01"
            unit="บาท"
            hint={__uiText("ทุกสินค้าในโปรได้ราคานี้ตั้งแต่ชิ้นแรก")}
            disabled={disabled}
            value={form.specialPrice}
            error={errors.specialPrice}
            aria-invalid={!!errors.specialPrice}
            onChange={(event) => onChange({ specialPrice: event.target.value })}
          />
        </div>
      )}

      {form.valueType === 'tiered' && (
        <div
          role="group"
          aria-label={__uiText("ขั้นราคา")}
          aria-describedby={errors.tiers ? tiersErrorId : undefined}
          className="space-y-3"
        >
          {form.tiers.map((row, index) => (
            <div
              key={row.id}
              className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
            >
              <Input
                label={__uiText("ซื้อตั้งแต่ (ขั้นที่ {0})", {"0": index + 1})}
                required
                type="number"
                min={1}
                disabled={disabled}
                value={row.minQty}
                error={errors[tierErrorKey(row.id, 'min')]}
                aria-invalid={!!errors[tierErrorKey(row.id, 'min')]}
                onChange={(event) => updateTier(row.id, { minQty: event.target.value })}
              />
              <Input
                label={__uiText("ถึง (ว่าง = ไม่จำกัด)")}
                type="number"
                min={1}
                disabled={disabled}
                value={row.maxQty}
                error={errors[tierErrorKey(row.id, 'max')]}
                aria-invalid={!!errors[tierErrorKey(row.id, 'max')]}
                onChange={(event) => updateTier(row.id, { maxQty: event.target.value })}
              />
              <Input
                label={__uiText("ราคาโปร (ราคารวมต่อหน่วยสั่ง)")}
                required
                type="number"
                min={0}
                step="0.01"
                unit="บาท"
                disabled={disabled}
                value={row.price}
                error={errors[tierErrorKey(row.id, 'price')]}
                aria-invalid={!!errors[tierErrorKey(row.id, 'price')]}
                onChange={(event) => updateTier(row.id, { price: event.target.value })}
              />
              <button
                type="button"
                title={__uiText("ลบขั้นนี้")}
                aria-label={__uiText("ลบขั้นที่ {0}", {"0": index + 1})}
                disabled={disabled || form.tiers.length <= 1}
                onClick={() => onChange({ tiers: form.tiers.filter((r) => r.id !== row.id) })}
                className="mb-1 rounded-lg p-1.5 text-ink-muted hover:bg-alert-soft hover:text-alert disabled:pointer-events-none disabled:opacity-40"
              >
                <AiOutlineDelete size={18} />
              </button>
            </div>
          ))}
          {errors.tiers && (
            <p id={tiersErrorId} className="text-sm text-alert">
              {(typeof (errors.tiers) === 'string' ? __uiText(errors.tiers) : errors.tiers)}
            </p>
          )}
          <Button
            variant="secondary"
            disabled={disabled}
            text={__uiText("เพิ่มขั้น")}
            icon={<AiOutlinePlus size={20} />}
            onClick={() => onChange({ tiers: [...form.tiers, nextTierRow(form.tiers)] })}
          />
        </div>
      )}

      {form.valueType === 'bogo' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label={__uiText("ซื้อ (จำนวน)")}
            required
            type="number"
            min={1}
            disabled={disabled}
            value={form.buyQty}
            error={errors.buyQty}
            aria-invalid={!!errors.buyQty}
            onChange={(event) => onChange({ buyQty: event.target.value })}
          />
          <Input
            label={__uiText("แถม (จำนวน)")}
            required
            type="number"
            min={1}
            disabled={disabled}
            value={form.getQty}
            error={errors.getQty}
            aria-invalid={!!errors.getQty}
            onChange={(event) => onChange({ getQty: event.target.value })}
          />
          <Input
            label={__uiText("ส่วนลดของที่แถม")}
            required
            type="number"
            min={0}
            max={100}
            unit="%"
            hint={__uiText("100 = แถมฟรี")}
            disabled={disabled}
            value={form.getDiscountPercent}
            error={errors.getDiscountPercent}
            aria-invalid={!!errors.getDiscountPercent}
            onChange={(event) => onChange({ getDiscountPercent: event.target.value })}
          />
        </div>
      )}
    </div>
  );
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
