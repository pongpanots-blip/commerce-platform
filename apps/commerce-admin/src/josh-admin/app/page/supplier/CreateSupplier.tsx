import { createSupplier } from '@josh/shared-api';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { emptySupplier, SupplierFields } from './supplier-form';

import { toast, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';

const CreateSupplier = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptySupplier);
  const [nameError, setNameError] = useState(false);

  const handleSubmit = async () => {
    if (!form.supplier_name.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
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
      alert(__uiText('เกิดข้อผิดพลาดในการบันทึก'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminInsertLayout
      title={__uiText('เพิ่มผู้จัดจำหน่าย')}
      subtitle={__uiText('ชื่อร้านหรือบริษัทที่ส่งสินค้าให้เรา')}
      backPath={ADMIN_ROUTES.suppliers}
      saving={saving}
      saveLabel="บันทึกผู้จัดจำหน่าย"
      steps={['กรอกชื่อ', 'ใส่ช่องทางติดต่อ', 'บันทึกผู้จัดจำหน่าย']}
      onSave={handleSubmit}
    >
      <SupplierFields value={form} onChange={setForm} nameError={nameError ? 'กรอกชื่อผู้จัดจำหน่าย เช่น บริษัท ตัวอย่าง จำกัด' : undefined} />
    </AdminInsertLayout>
  );
};

export default CreateSupplier;
