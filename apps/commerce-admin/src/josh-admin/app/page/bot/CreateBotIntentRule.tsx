import { createBotIntentRule } from '@josh/shared-api';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import BotIntentRuleForm, { BotIntentRuleFormValue } from '../../components/bot/BotIntentRuleForm';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const CreateBotIntentRule = () => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BotIntentRuleFormValue>({
    intent: 'order_lookup',
    pattern: '',
    active: true,
  });

  const handleSubmit = async () => {
    if (!form.pattern) {
      alert('กรุณากรอก Pattern');
      return;
    }
    setSaving(true);
    try {
      await createBotIntentRule(form);
      navigate(ADMIN_ROUTES.botIntentRules);
    } catch {
      alert('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminInsertLayout
      title="เพิ่ม Intent Rule"
      subtitle="กฎจับคู่ intent ของ chatbot จาก pattern (regex)"
      backPath={ADMIN_ROUTES.botIntentRules}
      saving={saving}
      onSave={handleSubmit}
    >
      <BotIntentRuleForm value={form} onChange={setForm} />
    </AdminInsertLayout>
  );
};

export default CreateBotIntentRule;
