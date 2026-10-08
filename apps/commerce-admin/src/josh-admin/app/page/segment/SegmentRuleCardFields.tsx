import type { UserSegmentRuleType } from '@josh/shared-api';
import { Select } from '@josh/shared-ui-web';
import React from 'react';
import CuisineMultiSelect from './CuisineMultiSelect';
import SegmentCustomerListField, { type ManualUsersInitialLoad } from './SegmentCustomerListField';
import SegmentRuleConfigFields from './SegmentRuleConfigFields';
import {
  getSegmentCard,
  OTHER_RULE_TYPE_OPTIONS,
  type SegmentRuleCard,
  type SegmentRuleFormState,
} from './segment-rule.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Props = {
  ruleType: UserSegmentRuleType;
  ruleForm: SegmentRuleFormState;
  onRuleTypeChange: (ruleType: UserSegmentRuleType) => void;
  onRuleFormChange: (next: SegmentRuleFormState) => void;
  /** Edit page only — status of resolving a `manual_user_list` segment's already-saved members. */
  manualUsersInitialLoad?: ManualUsersInitialLoad;
};

const CARDS: Array<{ card: SegmentRuleCard; title: string; hint: string }> = [
  { card: 'cuisine', get title() { return __uiText("ประเภทร้าน (Cuisine)"); }, get hint() { return __uiText("กำหนดกลุ่มลูกค้าตามประเภทร้านที่ขาย"); } },
  {
    card: 'manual_user_list',
    get title() { return __uiText("รายชื่อลูกค้า (อัปโหลด CSV / อีเมล)"); },
    get hint() { return __uiText("ระบุลูกค้าเป็นรายคน ด้วยไฟล์ CSV หรือวางรายชื่อ"); },
  },
  { card: 'other', get title() { return __uiText("เงื่อนไขอื่นๆ"); }, get hint() { return __uiText("เงื่อนไขอื่น เช่น role, ยอดสั่งซื้อ, วันที่สมัคร"); } },
];

/** "กำหนดกลุ่มลูกค้าโดย" — สามการ์ดเลือกได้ (radio semantics) + เนื้อหาของการ์ดที่เลือก. */
export function SegmentRuleCardFields({
  ruleType,
  ruleForm,
  onRuleTypeChange,
  onRuleFormChange,
  manualUsersInitialLoad,
}: Props) {
  __useUiLocale();
  const activeCard = getSegmentCard(ruleType);

  const selectCard = (card: SegmentRuleCard) => {
    if (card === activeCard) return;
    if (card === 'cuisine') onRuleTypeChange('cuisine');
    else if (card === 'manual_user_list') onRuleTypeChange('manual_user_list');
    else onRuleTypeChange(OTHER_RULE_TYPE_OPTIONS[0].value);
  };

  return (
    <div className="space-y-3">
      <span className="block text-sm font-medium text-gray-700">{__uiText("กำหนดกลุ่มลูกค้าโดย *")}</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label={__uiText("กำหนดกลุ่มลูกค้าโดย")}>
        {CARDS.map((option) => {
          const selected = activeCard === option.card;
          return (
            <div
              key={option.card}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              onClick={() => selectCard(option.card)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectCard(option.card);
                }
              }}
              className={`cursor-pointer rounded-xl border-2 p-4 text-sm transition-colors ${
                selected
                  ? 'border-primary bg-primary/5 text-ink'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-primary/40'
              }`}
            >
              <div className="font-semibold">{option.title}</div>
              <div className="mt-1 text-xs text-gray-500">{option.hint}</div>
            </div>
          );
        })}
      </div>

      {activeCard === 'cuisine' && (
        <CuisineMultiSelect
          selectedCuisineIds={ruleForm.cuisine_ids}
          selectedParentIds={ruleForm.parent_ids}
          onChange={(next) => onRuleFormChange({ ...ruleForm, ...next })}
        />
      )}

      {activeCard === 'manual_user_list' && (
        <SegmentCustomerListField
          value={ruleForm.manualUsers}
          onChange={(manualUsers) => onRuleFormChange({ ...ruleForm, manualUsers })}
          initialLoad={manualUsersInitialLoad}
        />
      )}

      {activeCard === 'other' && (
        <div className="space-y-3">
          <Select
            id="segment-rule-type-other"
            label={__uiText("เงื่อนไข")}
            hint={OTHER_RULE_TYPE_OPTIONS.find((option) => option.value === ruleType)?.description}
            value={ruleType}
            onChange={(event) => onRuleTypeChange(event.target.value as UserSegmentRuleType)}
          >
            {OTHER_RULE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <SegmentRuleConfigFields ruleType={ruleType} value={ruleForm} onChange={onRuleFormChange} />
        </div>
      )}
    </div>
  );
}

export default SegmentRuleCardFields;
