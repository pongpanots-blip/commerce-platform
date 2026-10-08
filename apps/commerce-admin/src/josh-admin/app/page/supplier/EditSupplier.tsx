import { getSupplierById, updateSupplier } from '@josh/shared-api';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { emptySupplier, SupplierFields, type SupplierFormValue } from './supplier-form';

import { toast, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';

const EditSupplier = () => {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState<SupplierFormValue>(emptySupplier);
  const [nameError, setNameError] = useState(false);

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
        } else setLoadError(true);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmit = async () => {
    if (!id) return;
    if (!form.supplier_name.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setSaving(true);
    try {
      const response = await updateSupplier(id, form);
      if (response.data?.status) {
        toast('บันทึกผู้จัดจำหน่ายแล้ว', { label: 'เปิดรายการผู้จัดจำหน่าย', href: ADMIN_ROUTES.suppliers });
        navigate(ADMIN_ROUTES.suppliers);
      } else if (response.data?.message) {
        alert(response.data.message);
      }
    } catch {
      alert(__uiText('เกิดข้อผิดพลาดในการบันทึก'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-gray-500">{__uiText('กำลังโหลด...')}</div>;
  if (loadError) return <div className="p-6 text-sm text-red-500">{__uiText('ไม่พบผู้จัดจำหน่าย หรือโหลดข้อมูลไม่สำเร็จ')}</div>;

  return (
    <AdminInsertLayout
      title={__uiText('แก้ไขผู้จัดจำหน่าย')}
      subtitle={__uiText('แก้ชื่อหรือช่องทางติดต่อ แล้วกดบันทึก')}
      saveLabel="บันทึกผู้จัดจำหน่าย"
      backPath={ADMIN_ROUTES.suppliers}
      saving={saving}
      onSave={handleSubmit}
    >
      <SupplierFields value={form} onChange={setForm} nameError={nameError ? 'กรอกชื่อผู้จัดจำหน่าย เช่น บริษัท ตัวอย่าง จำกัด' : undefined} />
    </AdminInsertLayout>
  );
};

export default EditSupplier;
