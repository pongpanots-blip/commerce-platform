import { getSupplierById, updateSupplier } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const EditSupplier = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState({
    supplier_name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
  });

  useEffect(() => {
    if (!id) return;
    getSupplierById(id)
      .then((res) => {
        const data = res.data?.data;
        if (data) {
          setForm({
            supplier_name: data.supplier_name ?? '',
            contact_name: data.contact_name ?? '',
            phone: data.phone ?? '',
            email: data.email ?? '',
            address: data.address ?? '',
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
    if (!form.supplier_name) {
      alert('กรุณากรอกชื่อ Supplier');
      return;
    }
    setSaving(true);
    try {
      const response = await updateSupplier(id, form);
      if (response.data?.status) {
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

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">กำลังโหลด...</div>;
  }

  if (loadError) {
    return (
      <div className="p-6 text-sm text-red-500">
        ไม่พบข้อมูล Supplier หรือโหลดข้อมูลไม่สำเร็จ
      </div>
    );
  }

  return (
    <AdminInsertLayout
      title="แก้ไข Supplier"
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

export default EditSupplier;
