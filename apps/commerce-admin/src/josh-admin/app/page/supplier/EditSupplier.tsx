import { getSupplierById, updateSupplier } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const EditSupplier = () => {
  __useUiLocale();
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
      alert(__uiText("กรุณากรอกชื่อ Supplier"));
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
      alert(__uiText("เกิดข้อผิดพลาดในการบันทึก"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">{__uiText("กำลังโหลด...")}</div>;
  }

  if (loadError) {
    return (
      <div className="p-6 text-sm text-red-500">
        {__uiText("ไม่พบข้อมูล Supplier หรือโหลดข้อมูลไม่สำเร็จ")}</div>
    );
  }

  return (
    <AdminInsertLayout
      title={__uiText("แก้ไขผู้จัดจำหน่าย")}
      subtitle={__uiText("แก้ชื่อหรือช่องทางติดต่อ แล้วกดบันทึก")}
      saveLabel="บันทึกผู้จัดจำหน่าย"
      backPath={ADMIN_ROUTES.suppliers}
      saving={saving}
      onSave={handleSubmit}
    >
      <Input
        label={__uiText("ชื่อผู้จัดจำหน่าย")}
        required
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

export default EditSupplier;
