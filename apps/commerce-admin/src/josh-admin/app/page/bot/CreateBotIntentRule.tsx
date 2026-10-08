import { createBotIntentRule } from '@josh/shared-api';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import BotIntentRuleForm, { BotIntentRuleFormValue } from '../../components/bot/BotIntentRuleForm';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const CreateBotIntentRule = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BotIntentRuleFormValue>({
    intent: 'order_lookup',
    pattern: '',
    active: true,
  });

  const handleSubmit = async () => {
    if (!form.pattern) {
      alert(__uiText("กรุณากรอก Pattern"));
      return;
    }
    setSaving(true);
    try {
      await createBotIntentRule(form);
      navigate(ADMIN_ROUTES.botIntentRules);
    } catch {
      alert(__uiText("เกิดข้อผิดพลาดในการบันทึก"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminInsertLayout
      title={__uiText("เพิ่ม Intent Rule")}
      subtitle={__uiText("กฎจับคู่ intent ของ chatbot จาก pattern (regex)")}
      backPath={ADMIN_ROUTES.botIntentRules}
      saving={saving}
      onSave={handleSubmit}
    >
      <BotIntentRuleForm value={form} onChange={setForm} />
    </AdminInsertLayout>
  );
};

export default CreateBotIntentRule;
