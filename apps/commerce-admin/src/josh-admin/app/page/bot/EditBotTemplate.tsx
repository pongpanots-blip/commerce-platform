import { getBotTemplates, updateBotTemplate } from '@josh/shared-api';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import BotTemplateBuilder, {
  BotTemplateFormValue,
} from '../../components/bot/BotTemplateBuilder';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const EditBotTemplate = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
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
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmit = async () => {
    if (!id || !form.name) {
      alert('กรุณากรอกชื่อ Template');
      return;
    }
    let schema: any;
    let example: any;
    setSchemaError('');
    setExampleError('');
    try {
      schema = JSON.parse(form.schemaText);
    } catch {
      setSchemaError('Schema ไม่ใช่ JSON ที่ถูกต้อง');
      return;
    }
    try {
      example = JSON.parse(form.exampleText);
    } catch {
      setExampleError('Example ไม่ใช่ JSON ที่ถูกต้อง');
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
      title="แก้ไข Template"
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
