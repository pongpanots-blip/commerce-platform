import { Input, Select } from '@josh/shared-ui-web';
import React from 'react';
import { FieldLabel } from './CouponCoreForm';
import {
  COUPON_GRANT_TIMING_OPTIONS,
  type CouponRewardForm,
} from './coupon-reward.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type CouponRewardRuleFieldsProps = {
  value: CouponRewardForm;
  onChange: (next: CouponRewardForm) => void;
  disabled?: boolean;
};

export default function CouponRewardRuleFields({
  value,
  onChange,
  disabled = false,
}: CouponRewardRuleFieldsProps) {
  __useUiLocale();
  const grantTimingId = React.useId();

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div>
        <FieldLabel htmlFor={grantTimingId}>{__uiText("เวลามอบคูปอง")}</FieldLabel>
        <Select
          id={grantTimingId}
          className="w-full"
          value={value.grant_timing}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...value,
              grant_timing: event.target.value as CouponRewardForm['grant_timing'],
            })
          }
        >
          {COUPON_GRANT_TIMING_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Input
          label={__uiText("หน่วงใช้ได้ (วัน)")}
          type="number"
          min={0}
          value={value.delay_days}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, delay_days: event.target.value })}
          placeholder="0"
        />
      </div>

      <div>
        <Input
          label={__uiText("ได้รับสูงสุดต่อคน (ครั้ง)")}
          type="number"
          min={1}
          value={value.reward_per_user_limit}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, reward_per_user_limit: event.target.value })
          }
          placeholder="1"
        />
        <p className="mt-1 text-xs text-gray-500">
          {__uiText("จำนวนครั้งที่ลูกค้าคนหนึ่งได้รับคูปองนี้จากการใช้คูปองต้นทางซ้ำ")}</p>
      </div>
    </div>
  );
}
