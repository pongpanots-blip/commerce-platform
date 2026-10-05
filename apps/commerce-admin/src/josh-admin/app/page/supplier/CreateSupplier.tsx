import { createSupplier } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const CreateSupplier = () => {
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
      alert('กรุณากรอกชื่อ Supplier');
      return;
    }
    setSaving(true);
    try {
      const response = await createSupplier(form);
      if (response.data?.message === '') {
        navigate(ADMIN_ROUTES.suppliers);
      } else if (response.data?.message) {
        alert(response.data.message);
      }
    } catch {
      alert('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminInsertLayout
      title="เพิ่ม Supplier"
      subtitle="ข้อมูลผู้จัดจำหน่าย / ซัพพลายเออร์"
      backPath={ADMIN_ROUTES.suppliers}
      saving={saving}
      onSave={handleSubmit}
    >
      <Input
        label="ชื่อ Supplier *"
        value={form.supplier_name}
        onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
      />
      <Input
        label="ชื่อผู้ติดต่อ"
        value={form.contact_name}
        onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="เบอร์โทร"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <Input
          label="อีเมล"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </div>
      <Input
        label="ที่อยู่"
        value={form.address}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
      />
    </AdminInsertLayout>
  );
};

export default CreateSupplier;
