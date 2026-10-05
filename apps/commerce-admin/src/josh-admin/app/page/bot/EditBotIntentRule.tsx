import { getBotIntentRules, updateBotIntentRule } from '@josh/shared-api';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import BotIntentRuleForm, { BotIntentRuleFormValue } from '../../components/bot/BotIntentRuleForm';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const EditBotIntentRule = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<BotIntentRuleFormValue>({
    intent: 'order_lookup',
    pattern: '',
    active: true,
  });

  useEffect(() => {
    if (!id) return;
    getBotIntentRules()
      .then((res: any) => {
        const rules = res.data?.data ?? res.data ?? [];
        const rule = Array.isArray(rules) ? rules.find((r: any) => r.id === id) : null;
        if (rule) {
          setForm({ intent: rule.intent, pattern: rule.pattern, active: rule.active });
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmit = async () => {
    if (!id || !form.pattern) {
      alert('กรุณากรอก Pattern');
      return;
    }
    setSaving(true);
    try {
      await updateBotIntentRule(id, form);
      navigate(ADMIN_ROUTES.botIntentRules);
    } catch {
      alert('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">กำลังโหลด...</div>;
  }

  return (
    <AdminInsertLayout
      title="แก้ไข Intent Rule"
      backPath={ADMIN_ROUTES.botIntentRules}
      saving={saving}
      onSave={handleSubmit}
    >
      <BotIntentRuleForm value={form} onChange={setForm} />
    </AdminInsertLayout>
  );
};

export default EditBotIntentRule;
