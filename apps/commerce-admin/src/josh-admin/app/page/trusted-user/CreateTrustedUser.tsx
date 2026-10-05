import { createTrustedUser } from '@josh/shared-api';
import { Input, Select } from '@josh/shared-ui-web';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import LogoUploadField from '../../components/LogoUploadField';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const CreateTrustedUser = () => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    user_name: '',
    avatar_url: '',
    company_or_position: '',
    testimonial_text: '',
    rating: 5,
    link_type: 'NONE',
    link_url: '',
    sort_order: 0,
    is_active: true,
  });

  const handleSubmit = async () => {
    if (!form.user_name || !form.testimonial_text) {
      alert('กรุณากรอกชื่อและข้อความรีวิว');
      return;
    }
    setSaving(true);
    try {
      const response = await createTrustedUser(form);
      if (response.data?.message === '') {
        navigate(ADMIN_ROUTES.trustedUsers);
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
      title="เพิ่ม Trusted Restaurant"
      subtitle="§1.8 Our Trusted Restaurant — รีวิวจากลูกค้า B2B"
      backPath={ADMIN_ROUTES.trustedUsers}
      saving={saving}
      onSave={handleSubmit}
    >
      <Input
        label="ชื่อผู้รีวิว *"
        value={form.user_name}
        onChange={(e) => setForm({ ...form, user_name: e.target.value })}
      />
      <Input
        label="ชื่อร้าน / ตำแหน่ง"
        value={form.company_or_position}
        onChange={(e) => setForm({ ...form, company_or_position: e.target.value })}
      />
      <LogoUploadField
        label="รูปโปรไฟล์"
        value={form.avatar_url}
        onChange={(url) => setForm({ ...form, avatar_url: url })}
      />
      <div>
        <label className="text-sm text-gray-600" htmlFor="trusted-user-testimonial">ข้อความรีวิว *</label>
        <textarea
          id="trusted-user-testimonial"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          rows={4}
          value={form.testimonial_text}
          onChange={(e) => setForm({ ...form, testimonial_text: e.target.value })}
          placeholder="เช่น คุณภาพเนื้อจาก JOSH ดีเยี่ยม ส่งตรงเวลาทุกครั้ง"
        />
      </div>
      <Select
        id="trusted-user-rating"
        label="คะแนน (1-5)"
        className="w-full"
        value={form.rating}
        onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
      >
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n}>
            {'★'.repeat(n)} ({n})
          </option>
        ))}
      </Select>
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

export default CreateTrustedUser;
