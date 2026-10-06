import { Input, Select } from '@josh/shared-ui-web';
import { BotIntent } from '@josh/shared-api';

const INTENT_OPTIONS: { value: BotIntent; label: string }[] = [
  { value: 'order_lookup', label: 'order_lookup' },
  { value: 'product_search', label: 'product_search' },
  { value: 'faq_general', label: 'faq_general' },
  { value: 'escalate', label: 'escalate' },
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
  return (
    <>
      <div>
        <Select
          label="เจตนา (Intent)"
          data={INTENT_OPTIONS}
          value={value.intent}
          onChange={(e) => onChange({ ...value, intent: e.target.value as BotIntent })}
        />
      </div>
      <div>
        <Input
          label="รูปแบบข้อความที่จับคู่ (Pattern regex)"
          value={value.pattern}
          onChange={(e) => onChange({ ...value, pattern: e.target.value })}
          placeholder="เช่น (order|สั่งซื้อ).*(status|สถานะ)"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.active}
          onChange={(e) => onChange({ ...value, active: e.target.checked })}
        />
        เปิดใช้งาน (Active)
      </label>
    </>
  );
};

export default BotIntentRuleForm;
