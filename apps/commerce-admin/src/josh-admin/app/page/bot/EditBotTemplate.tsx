import { getBotTemplates, updateBotTemplate } from '@josh/shared-api';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import BotTemplateBuilder, {
  BotTemplateFormValue,
} from '../../components/bot/BotTemplateBuilder';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { LoadError } from '../../components/LoadError';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const EditBotTemplate = () => {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [schemaError, setSchemaError] = useState('');
  const [exampleError, setExampleError] = useState('');
  const [form, setForm] = useState<BotTemplateFormValue>({
    name: '',
    type: 'card',
    schemaText: '{"fields":[]}',
    exampleText: '{}',
    active: true,
  });

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    getBotTemplates()
      .then((res: any) => {
        const rows = res.data?.data ?? res.data ?? [];
        const row = Array.isArray(rows) ? rows.find((r: any) => r.id === id) : null;
        if (row) {
          setForm({
            name: row.name,
            type: row.type,
            schemaText: JSON.stringify(row.schema ?? {}, null, 2),
            exampleText: JSON.stringify(row.example ?? {}, null, 2),
            active: row.active,
          });
        } else {
          setLoadError(__uiMessage('ไม่พบเทมเพลตบอตนี้'));
        }
      })
      .catch((error: unknown) => setLoadError(error))
      .finally(() => setLoading(false));
  }, [id, reload]);

  const handleSubmit = async () => {
    if (!id || !form.name) {
      alert(__uiText("กรุณากรอกชื่อ Template"));
      return;
    }
    let schema: any;
    let example: any;
    setSchemaError('');
    setExampleError('');
    try {
      schema = JSON.parse(form.schemaText);
    } catch {
      setSchemaError(__uiMessage("Schema ไม่ใช่ JSON ที่ถูกต้อง"));
      return;
    }
    try {
      example = JSON.parse(form.exampleText);
    } catch {
      setExampleError(__uiMessage("Example ไม่ใช่ JSON ที่ถูกต้อง"));
      return;
    }
    setSaving(true);
    try {
      await updateBotTemplate(id, {
        name: form.name,
        type: form.type,
        schema,
        example,
        active: form.active,
      });
      navigate(ADMIN_ROUTES.botTemplates);
    } catch {
      alert(__uiText("เกิดข้อผิดพลาดในการบันทึก"));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <LoadError title={__uiText('แก้ไขเทมเพลตบอต')} error={loadError} onRetry={() => setReload(value => value + 1)} />;
  if (loading) {
    return <div className="p-6 text-sm text-gray-500">{__uiText("กำลังโหลด...")}</div>;
  }

  return (
    <AdminInsertLayout
      title={__uiText("แก้ไข Template")}
      backPath={ADMIN_ROUTES.botTemplates}
      saving={saving}
      onSave={handleSubmit}
      wide
    >
      <BotTemplateBuilder
        value={form}
        onChange={setForm}
        schemaError={schemaError}
        exampleError={exampleError}
      />
    </AdminInsertLayout>
  );
};

export default EditBotTemplate;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
