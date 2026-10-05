import { getTrustedUserById, updateTrustedUser } from '@josh/shared-api';
import { Input, Select } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import LogoUploadField from '../../components/LogoUploadField';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const EditTrustedUser = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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

  useEffect(() => {
    if (!id) return;
    getTrustedUserById(id)
      .then((res) => {
        const data = res.data?.data;
        if (data) {
          setForm({
            user_name: data.user_name ?? '',
            avatar_url: data.avatar_url ?? '',
            company_or_position: data.company_or_position ?? '',
            testimonial_text: data.testimonial_text ?? '',
            rating: data.rating ?? 5,
            link_type: data.link_type ?? 'NONE',
            link_url: data.link_url ?? '',
            sort_order: data.sort_order ?? 0,
            is_active: data.is_active ?? true,
          });
        } else {
          setLoadError(true);
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmit = async () => {
    if (!id) return;
    if (!form.user_name || !form.testimonial_text) {
      alert('กรุณากรอกชื่อและข้อความรีวิว');
      return;
    }
    setSaving(true);
    try {
      const response = await updateTrustedUser(id, form);
      if (response.data?.status) {
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

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">กำลังโหลด...</div>;
  }

  if (loadError) {
    return (
      <div className="p-6 text-sm text-red-500">
        ไม่พบข้อมูลรีวิว หรือโหลดข้อมูลไม่สำเร็จ
      </div>
    );
  }

  return (
    <AdminInsertLayout
      title="แก้ไข Trusted Restaurant"
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
        <label className="text-sm text-gray-600" htmlFor="trusted-user-edit-testimonial">ข้อความรีวิว *</label>
        <textarea
          id="trusted-user-edit-testimonial"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          rows={4}
          value={form.testimonial_text}
          onChange={(e) => setForm({ ...form, testimonial_text: e.target.value })}
          placeholder="เช่น คุณภาพเนื้อจาก JOSH ดีเยี่ยม ส่งตรงเวลาทุกครั้ง"
        />
      </div>
      <Select
        id="trusted-user-edit-rating"
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

export default EditTrustedUser;
