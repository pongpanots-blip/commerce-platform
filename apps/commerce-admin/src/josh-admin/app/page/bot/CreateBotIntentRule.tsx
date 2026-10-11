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
      alert(__uiText("กรุณากรอกรูปแบบคำที่ใช้จับ"));
      return false;
    }
    setSaving(true);
    try {
      await createBotIntentRule(form);
      navigate(ADMIN_ROUTES.botIntentRules);
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
      title={__uiText("เพิ่มกติกาให้แชตบอตเข้าใจคำถาม")}
      subtitle={__uiText("บอกคำที่ลูกค้าพิมพ์ แล้วเลือกว่าลูกค้าต้องการอะไร")}
      saveLabel="บันทึกกติกา"
      backPath={ADMIN_ROUTES.botIntentRules}
      saving={saving}
      onSave={handleSubmit}
    >
      <BotIntentRuleForm value={form} onChange={setForm} />
    </AdminInsertLayout>
  );
};

export default CreateBotIntentRule;
