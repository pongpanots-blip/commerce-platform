import { createBotWorkflow, getBotTemplates } from '@josh/shared-api';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import BotWorkflowForm, { BotWorkflowFormValue } from '../../components/bot/BotWorkflowForm';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const CreateBotWorkflow = () => {
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
      alert('กรุณากรอกชื่อและ Trigger Pattern');
      return;
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
    } catch {
      alert('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminInsertLayout
      title="เพิ่ม Workflow"
      subtitle="กำหนด trigger, action และ response template ของ chatbot workflow"
      backPath={ADMIN_ROUTES.botWorkflows}
      saving={saving}
      onSave={handleSubmit}
    >
      <BotWorkflowForm value={form} onChange={setForm} templateOptions={templateOptions} />
    </AdminInsertLayout>
  );
};

export default CreateBotWorkflow;
