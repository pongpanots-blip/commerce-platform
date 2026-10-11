import { getBotIntentRules, updateBotIntentRule } from '@josh/shared-api';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import BotIntentRuleForm, { BotIntentRuleFormValue } from '../../components/bot/BotIntentRuleForm';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { LoadError } from '../../components/LoadError';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const EditBotIntentRule = () => {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState<BotIntentRuleFormValue>({
    intent: 'order_lookup',
    pattern: '',
    active: true,
  });

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    getBotIntentRules()
      .then((res: any) => {
        if (!active) return;
        const rules = res.data?.data ?? res.data ?? [];
        const rule = Array.isArray(rules) ? rules.find((r: any) => r.id === id) : null;
        if (rule) {
          setForm({ intent: rule.intent, pattern: rule.pattern, active: rule.active });
        } else {
          setLoadError(__uiMessage('ไม่พบกฎเจตนาบอตนี้'));
        }
      })
      .catch((error: unknown) => { if (active) setLoadError(error); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, reload]);

  const handleSubmit = async () => {
    if (!id || !form.pattern) {
      alert(__uiText("กรุณากรอกรูปแบบคำที่ใช้จับ"));
      return false;
    }
    setSaving(true);
    try {
      await updateBotIntentRule(id, form);
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

  if (loading) {
    return <div className="cp-management-page text-sm text-gray-500">{__uiText("กำลังโหลด...")}</div>;
  }
  if (loadError) return <LoadError title={__uiText('แก้ไขกติกาที่บอทใช้ตอบ')} error={loadError} onRetry={() => setReload(value => value + 1)} />;

  return (
    <AdminInsertLayout
      title={__uiText("แก้ไขกติกาที่บอทใช้ตอบ")}
      saveLabel="บันทึกกติกา"
      backPath={ADMIN_ROUTES.botIntentRules}
      saving={saving}
      onSave={handleSubmit}
    >
      <BotIntentRuleForm value={form} onChange={setForm} />
    </AdminInsertLayout>
  );
};

export default EditBotIntentRule;
