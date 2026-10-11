// ui-metadata-migration: static labels and UI notices only
import { Input, Select } from '@josh/shared-ui-web';
import { BotIntent } from '@josh/shared-api';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const INTENT_OPTIONS: { value: BotIntent; label: string }[] = [
  { value: 'order_lookup', get label(){return __uiText("ถามเรื่องคำสั่งซื้อ");} },
  { value: 'product_search', get label(){return __uiText("หาสินค้า");} },
  { value: 'faq_general', get label(){return __uiText("คำถามทั่วไป");} },
  { value: 'escalate', get label(){return __uiText("ขอคุยกับพนักงาน");} },
];

export interface BotIntentRuleFormValue {
  intent: BotIntent;
  pattern: string;
  active: boolean;
}

type Props = {
  value: BotIntentRuleFormValue;
  onChange: (value: BotIntentRuleFormValue) => void;
};

const BotIntentRuleForm = ({ value, onChange }: Props) => {
  __useUiLocale();
  return (
    <>
      <div>
        <Select
          label={__uiText("เจตนา (Intent)")}
          data={INTENT_OPTIONS}
          value={value.intent}
          onChange={(e) => onChange({ ...value, intent: e.target.value as BotIntent })}
        />
      </div>
      <div>
        <Input
          label={__uiText("รูปแบบข้อความที่จับคู่ (Pattern regex)")}
          value={value.pattern}
          onChange={(e) => onChange({ ...value, pattern: e.target.value })}
          placeholder={__uiText("เช่น (order|สั่งซื้อ).*(status|สถานะ)")}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.active}
          onChange={(e) => onChange({ ...value, active: e.target.checked })}
        />
        {__uiText("เปิดใช้งาน (Active)")}</label>
    </>
  );
};

export default BotIntentRuleForm;
