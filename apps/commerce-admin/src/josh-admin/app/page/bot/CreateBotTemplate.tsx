import { createBotTemplate } from '@josh/shared-api';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import BotTemplateBuilder, {
  BotTemplateFormValue,
} from '../../components/bot/BotTemplateBuilder';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const CreateBotTemplate = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [schemaError, setSchemaError] = useState('');
  const [exampleError, setExampleError] = useState('');
  const [form, setForm] = useState<BotTemplateFormValue>({
    name: '',
    type: 'card',
    schemaText: '{"fields":[]}',
    exampleText: '{}',
    active: true,
  });

  const handleSubmit = async () => {
    if (!form.name) {
      alert(__uiText("กรุณากรอกชื่อข้อความสำเร็จรูป"));
      return false;
    }
    let schema: any;
    let example: any;
    setSchemaError('');
    setExampleError('');
    try {
      schema = JSON.parse(form.schemaText);
    } catch {
      setSchemaError(__uiMessage("Schema ไม่ใช่ JSON ที่ถูกต้อง"));
      return false;
    }
    try {
      example = JSON.parse(form.exampleText);
    } catch {
      setExampleError(__uiMessage("Example ไม่ใช่ JSON ที่ถูกต้อง"));
      return false;
    }
    setSaving(true);
    try {
      await createBotTemplate({
        name: form.name,
        type: form.type,
        schema,
        example,
        active: form.active,
      });
      navigate(ADMIN_ROUTES.botTemplates);
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
      title={__uiText("เพิ่มข้อความสำเร็จรูป")}
      subtitle={__uiText("เขียนข้อความหรือการ์ดที่แชตบอตใช้ตอบลูกค้า")}
      saveLabel="บันทึกข้อความสำเร็จรูป"
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

export default CreateBotTemplate;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
