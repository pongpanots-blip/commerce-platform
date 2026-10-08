import type { UserSegmentRuleType } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React from 'react';
import type { SegmentRuleFormState } from './segment-rule.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Props = {
  ruleType: UserSegmentRuleType;
  value: SegmentRuleFormState;
  onChange: (next: SegmentRuleFormState) => void;
};

/** Fields for the "เงื่อนไขอื่นๆ" card's rule types — cuisine and manual_user_list have their
 * own dedicated cards/components (CuisineMultiSelect, SegmentCustomerListField). */
export function SegmentRuleConfigFields({ ruleType, value, onChange }: Props) {
  __useUiLocale();
  const patch = (partial: Partial<SegmentRuleFormState>) => {
    onChange({ ...value, ...partial });
  };

  switch (ruleType) {
    case 'guest':
    case 'member':
    case 'staff':
    case 'has_company':
      return (
        <p className="text-sm text-gray-500">
          {__uiText("ไม่ต้องตั้งค่าเพิ่มเติมสำหรับ rule นี้")}</p>
      );

    case 'role':
      return (
        <div>
          <Input
            label={__uiText("บทบาทผู้ใช้ (Role) คั่นด้วยคอมมา")}
            value={value.roles}
            onChange={(event) => patch({ roles: event.target.value })}
            placeholder={__uiText("customer, admin, staff")}
          />
        </div>
      );

    case 'custype':
      return (
        <div>
          <Input
            label={__uiText("ประเภทลูกค้า (custype) คั่นด้วยคอมมา")}
            value={value.custypes}
            onChange={(event) => patch({ custypes: event.target.value })}
            placeholder={__uiText("ร้านอาหารจีน, ร้านกาแฟ")}
          />
        </div>
      );

    case 'min_order_count':
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Input
              label={__uiText("จำนวนออเดอร์ขั้นต่ำ")}
              value={value.min}
              onChange={(event) => patch({ min: event.target.value })}
              placeholder="5"
            />
          </div>
          <div>
            <Input
              label={__uiText("ภายในกี่วันย้อนหลัง (ไม่บังคับ)")}
              value={value.within_days}
              onChange={(event) => patch({ within_days: event.target.value })}
              placeholder="90"
            />
          </div>
        </div>
      );

    case 'no_order_days':
      return (
        <div>
          <Input
            label={__uiText("ไม่สั่งซื้อเกิน (วัน)")}
            value={value.days}
            onChange={(event) => patch({ days: event.target.value })}
            placeholder="30"
          />
        </div>
      );

    case 'first_visit':
      return (
        <div>
          <Input
            label={__uiText("นับว่า \"เพิ่งเข้าครั้งแรก\" ภายใน (ชั่วโมง)")}
            value={value.withinHours}
            onChange={(event) => patch({ withinHours: event.target.value })}
            placeholder="24"
          />
          <p className="mt-1 text-xs text-gray-400">
            {__uiText("นับจาก page view แรกของอุปกรณ์ — ใช้ได้กับ Banner Targeting (guest เข้าเงื่อนไขได้)")}</p>
        </div>
      );

    case 'min_order_value':
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Input
              label={__uiText("มูลค่ารวมขั้นต่ำ (บาท)")}
              value={value.min_value}
              onChange={(event) => patch({ min_value: event.target.value })}
              placeholder="50000"
            />
          </div>
          <div>
            <Input
              label={__uiText("ภายในกี่วันย้อนหลัง (ไม่บังคับ)")}
              value={value.within_days}
              onChange={(event) => patch({ within_days: event.target.value })}
              placeholder="180"
            />
          </div>
        </div>
      );

    case 'max_order_value':
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Input
              label={__uiText("มูลค่ารวมน้อยกว่า (บาท)")}
              value={value.max_value}
              onChange={(event) => patch({ max_value: event.target.value })}
              placeholder="50000"
            />
          </div>
          <div>
            <Input
              label={__uiText("ภายในกี่วันย้อนหลัง (ไม่บังคับ)")}
              value={value.within_days}
              onChange={(event) => patch({ within_days: event.target.value })}
              placeholder={__uiText("เว้นว่าง = ยอดสะสมทั้งหมด")}
            />
          </div>
        </div>
      );

    case 'registered_between':
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Input
              label={__uiText("วันที่เริ่ม")}
              type="date"
              value={value.registered_from}
              onChange={(event) => patch({ registered_from: event.target.value })}
            />
          </div>
          <div>
            <Input
              label={__uiText("วันที่สิ้นสุด")}
              type="date"
              value={value.registered_to}
              onChange={(event) => patch({ registered_to: event.target.value })}
            />
          </div>
        </div>
      );

    default:
      return null;
  }
}

export default SegmentRuleConfigFields;
