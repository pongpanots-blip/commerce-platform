import { createBotWorkflow, getBotTemplates } from '@josh/shared-api';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import BotWorkflowForm, { BotWorkflowFormValue } from '../../components/bot/BotWorkflowForm';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const CreateBotWorkflow = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [templateOptions, setTemplateOptions] = useState<{ value: string; label: string }[]>([]);
  const [form, setForm] = useState<BotWorkflowFormValue>({
    name: '',
    triggerPattern: '',
    actionType: 'tool',
    toolName: 'order_lookup',
    templateId: '',
    active: true,
  });

  useEffect(() => {
    getBotTemplates()
      .then((res: any) => {
        const data = res?.data?.data ?? res?.data ?? [];
        const list = Array.isArray(data) ? data : [];
        setTemplateOptions(list.map((t: any) => ({ value: t.id, label: t.name })));
      })
      .catch(() => setTemplateOptions([]));
  }, []);

  const handleSubmit = async () => {
    if (!form.name || !form.triggerPattern) {
      alert(__uiText("กรุณากรอกชื่อและรูปแบบคำที่ใช้จับ"));
      return false;
    }
    setSaving(true);
    try {
      await createBotWorkflow({
        name: form.name,
        trigger: { type: 'regex', pattern: form.triggerPattern },
        action:
          form.actionType === 'tool'
            ? { type: 'tool', toolName: form.toolName }
            : { type: form.actionType },
        response: { templateId: form.templateId },
        active: form.active,
      });
      navigate(ADMIN_ROUTES.botWorkflows);
      return true;
    } catch {
      alert(__uiText("เกิดข้อผิดพลาดในการบันทึก"));
      return false;
    } finally {
      setSaving(false);
    }
    return false;
  };

  return (
    <AdminInsertLayout
      title={__uiText("เพิ่มลำดับการตอบ")}
      subtitle={__uiText("เลือกว่าเริ่มเมื่อไร แชตบอตทำอะไร และตอบด้วยข้อความไหน")}
      saveLabel="บันทึกลำดับการตอบ"
      backPath={ADMIN_ROUTES.botWorkflows}
      saving={saving}
      onSave={handleSubmit}
    >
      <BotWorkflowForm value={form} onChange={setForm} templateOptions={templateOptions} />
    </AdminInsertLayout>
  );
};

export default CreateBotWorkflow;
