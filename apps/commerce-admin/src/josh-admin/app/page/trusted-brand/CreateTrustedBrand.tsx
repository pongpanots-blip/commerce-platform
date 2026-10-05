import { createTrustedBrand } from '@josh/shared-api';
import { Input, Select } from '@josh/shared-ui-web';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import LogoUploadField from '../../components/LogoUploadField';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const CreateTrustedBrand = () => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    brand_name: '',
    logo_url: '',
    link_type: 'EXTERNAL',
    link_url: '',
    sort_order: 0,
    is_active: true,
  });

  const handleSubmit = async () => {
    if (!form.brand_name || !form.logo_url) {
      alert('กรุณากรอกชื่อแบรนด์และโลโก้');
      return;
    }
    setSaving(true);
    try {
      const response = await createTrustedBrand(form);
      if (response.data?.message === '') {
        navigate(ADMIN_ROUTES.trustedBrands);
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
      title="เพิ่ม Trusted Brand"
      subtitle="แบรนด์ที่แสดงในส่วน Trusted Brands บนหน้า Landing"
      backPath={ADMIN_ROUTES.trustedBrands}
      saving={saving}
      onSave={handleSubmit}
    >
      <Input
        label="ชื่อแบรนด์ *"
        value={form.brand_name}
        onChange={(e) => setForm({ ...form, brand_name: e.target.value })}
      />
      <LogoUploadField
        label="โลโก้แบรนด์"
        value={form.logo_url}
        onChange={(url) => setForm({ ...form, logo_url: url })}
      />
      <Select
        id="trusted-brand-link-type"
        label="ประเภทลิงก์"
        className="w-full"
        value={form.link_type}
        onChange={(e) => setForm({ ...form, link_type: e.target.value })}
      >
        <option value="EXTERNAL">EXTERNAL</option>
        <option value="INTERNAL_SKU">INTERNAL_SKU</option>
        <option value="INTERNAL_PROMO">INTERNAL_PROMO</option>
        <option value="NONE">NONE</option>
      </Select>
      <Input
        label="ลิงก์ปลายทาง (ถ้ามี)"
        value={form.link_url}
        onChange={(e) => setForm({ ...form, link_url: e.target.value })}
      />
      <Input
        label="ลำดับการแสดงผล"
        value={String(form.sort_order)}
        onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
        />
        เปิดใช้งาน
      </label>
    </AdminInsertLayout>
  );
};

export default CreateTrustedBrand;
