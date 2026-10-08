// ui-metadata-migration: static labels and UI notices only
import { Input, Select } from '@josh/shared-ui-web';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const ACTION_TYPE_OPTIONS = [
  { value: 'tool', get label(){return __uiText("tool");} },
  { value: 'escalate', get label(){return __uiText("escalate");} },
  { value: 'llm', get label(){return __uiText("llm (ยังไม่รองรับ)");} },
];

const TOOL_NAME_OPTIONS = [
  { value: 'order_lookup', get label(){return __uiText("order_lookup");} },
  { value: 'product_search', get label(){return __uiText("product_search");} },
  { value: 'faq', get label(){return __uiText("faq");} },
];

export interface BotWorkflowFormValue {
  name: string;
  triggerPattern: string;
  actionType: 'tool' | 'llm' | 'escalate';
  toolName: string;
  templateId: string;
  active: boolean;
}

type Props = {
  value: BotWorkflowFormValue;
  onChange: (value: BotWorkflowFormValue) => void;
  templateOptions?: { value: string; label: string }[];
};

const BotWorkflowForm = ({ value, onChange, templateOptions }: Props) => {
  __useUiLocale();
  return (
    <>
      <div>
        <Input
          label={__uiText("ชื่อ Workflow")}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder={__uiText("เช่น order_status_lookup")}
        />
      </div>
      <div>
        <Input
          label={__uiText("รูปแบบข้อความที่กระตุ้น Workflow (Trigger Pattern regex)")}
          value={value.triggerPattern}
          onChange={(e) => onChange({ ...value, triggerPattern: e.target.value })}
          placeholder={__uiText("เช่น (order|สั่งซื้อ).*(status|สถานะ)")}
        />
      </div>
      <div>
        <Select
          label={__uiText("ประเภทการทำงาน (Action Type)")}
          data={ACTION_TYPE_OPTIONS}
          value={value.actionType}
          onChange={(e) =>
            onChange({ ...value, actionType: e.target.value as BotWorkflowFormValue['actionType'] })
          }
        />
      </div>
      {value.actionType === 'tool' && (
        <div>
          <Select
            label={__uiText("เครื่องมือที่ใช้ (Tool)")}
            data={TOOL_NAME_OPTIONS}
            value={value.toolName}
            onChange={(e) => onChange({ ...value, toolName: e.target.value })}
          />
        </div>
      )}
      <div>
        {templateOptions && templateOptions.length > 0 ? (
          <Select
            label={__uiText("Template คำตอบ (Response Template)")}
            data={templateOptions}
            value={value.templateId}
            onChange={(e) => onChange({ ...value, templateId: e.target.value })}
          />
        ) : (
          <Input
            label={__uiText("Template คำตอบ (Response Template)")}
            value={value.templateId}
            onChange={(e) => onChange({ ...value, templateId: e.target.value })}
            placeholder={__uiText("Template ID")}
          />
        )}
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

export default BotWorkflowForm;
