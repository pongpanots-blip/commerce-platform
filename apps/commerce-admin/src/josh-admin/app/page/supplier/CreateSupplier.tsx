import { createSupplier } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { toast, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const CreateSupplier = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supplier_name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
  });

  const handleSubmit = async () => {
    if (!form.supplier_name) {
      alert(__uiText("กรอกชื่อผู้จัดจำหน่าย เช่น บริษัท ตัวอย่าง จำกัด"));
      return;
    }
    setSaving(true);
    try {
      const response = await createSupplier(form);
      if (response.data?.message === '') {
        toast('บันทึกผู้จัดจำหน่ายแล้ว', { label: 'เปิดรายการผู้จัดจำหน่าย', href: ADMIN_ROUTES.suppliers });
        navigate(ADMIN_ROUTES.suppliers);
      } else if (response.data?.message) {
        alert(response.data.message);
      }
    } catch {
      alert(__uiText("เกิดข้อผิดพลาดในการบันทึก"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminInsertLayout
      title={__uiText("เพิ่มผู้จัดจำหน่าย")}
      subtitle={__uiText("ชื่อร้านหรือบริษัทที่ส่งสินค้าให้เรา")}
      backPath={ADMIN_ROUTES.suppliers}
      saving={saving}
      saveLabel="บันทึกผู้จัดจำหน่าย"
      steps={['กรอกชื่อ', 'ใส่ช่องทางติดต่อ', 'บันทึกผู้จัดจำหน่าย']}
      onSave={handleSubmit}
    >
      <Input
        label={__uiText("ชื่อผู้จัดจำหน่าย")}
        required
        hint={__uiText("ใช้ชื่อที่ทีมเรียกจริง")}
        placeholder={__uiText("เช่น บริษัท ตัวอย่าง จำกัด")}
        value={form.supplier_name}
        onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
      />
      <Input
        label={__uiText("ชื่อผู้ติดต่อ")}
        value={form.contact_name}
        onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label={__uiText("เบอร์โทร")}
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <Input
          label={__uiText("อีเมล")}
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </div>
      <Input
        label={__uiText("ที่อยู่")}
        value={form.address}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
      />
    </AdminInsertLayout>
  );
};

export default CreateSupplier;
