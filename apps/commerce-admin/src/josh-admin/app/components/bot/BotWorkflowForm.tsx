import { Input, Select } from '@josh/shared-ui-web';

const ACTION_TYPE_OPTIONS = [
  { value: 'tool', label: 'tool' },
  { value: 'escalate', label: 'escalate' },
  { value: 'llm', label: 'llm (ยังไม่รองรับ)' },
];

const TOOL_NAME_OPTIONS = [
  { value: 'order_lookup', label: 'order_lookup' },
  { value: 'product_search', label: 'product_search' },
  { value: 'faq', label: 'faq' },
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
  return (
    <>
      <div>
        <Input
          label="ชื่อ Workflow"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="เช่น order_status_lookup"
        />
      </div>
      <div>
        <Input
          label="รูปแบบข้อความที่กระตุ้น Workflow (Trigger Pattern regex)"
          value={value.triggerPattern}
          onChange={(e) => onChange({ ...value, triggerPattern: e.target.value })}
          placeholder="เช่น (order|สั่งซื้อ).*(status|สถานะ)"
        />
      </div>
      <div>
        <Select
          label="ประเภทการทำงาน (Action Type)"
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
            label="เครื่องมือที่ใช้ (Tool)"
            data={TOOL_NAME_OPTIONS}
            value={value.toolName}
            onChange={(e) => onChange({ ...value, toolName: e.target.value })}
          />
        </div>
      )}
      <div>
        {templateOptions && templateOptions.length > 0 ? (
          <Select
            label="Template คำตอบ (Response Template)"
            data={templateOptions}
            value={value.templateId}
            onChange={(e) => onChange({ ...value, templateId: e.target.value })}
          />
        ) : (
          <Input
            label="Template คำตอบ (Response Template)"
            value={value.templateId}
            onChange={(e) => onChange({ ...value, templateId: e.target.value })}
            placeholder="Template ID"
          />
        )}
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

export default BotWorkflowForm;
