import { createCompanyAdmin } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import { FormSection, toast } from '@cp/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';

import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from '@cp/ui';

export default function CreateCompanyAdmin() {
  __useUiLocale();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [registerNumber, setRegisterNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [creditLimit, setCreditLimit] = useState('0');
  const [creditTermDays, setCreditTermDays] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(__uiMessage('กรอกชื่อบริษัท เช่น บริษัท ตัวอย่าง จำกัด'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res: any = await createCompanyAdmin({
        name,
        register_number: registerNumber || undefined,
        phone: phone.trim() || undefined,
        address: address || undefined,
        credit_limit: Number(creditLimit),
        credit_term_days: Number(creditTermDays),
      });
      const id = res?.data?.data?.id ?? res?.data?.id;
      const next = id ? ADMIN_ROUTES.companyEdit(String(id)) : ADMIN_ROUTES.company;
      toast('บันทึกบริษัทแล้ว', { label: 'เปิดบริษัท', href: next });
      navigate(next);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? __uiMessage('บันทึกไม่สำเร็จ'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminInsertLayout
      title={__uiText('สร้างบริษัท')}
      subtitle={__uiText('ชื่อบริษัทมาก่อน วงเงินใส่ทีหลังได้')}
      backPath={ADMIN_ROUTES.company}
      saving={saving}
      saveLabel="บันทึกบริษัท"
      steps={['กรอกชื่อบริษัท', 'ใส่ที่อยู่ถ้ามี', 'บันทึกบริษัท']}
      onSave={() => void handleSubmit()}
    >
      {error && <p className="text-sm text-alert">{typeof error === 'string' ? __uiText(error) : error}</p>}
      <FormSection title="ข้อมูลบริษัท" description="ชื่อที่ทีมใช้เรียกบริษัทนี้">
        <Input label={__uiText('ชื่อบริษัท')} value={name} onChange={(e) => setName(e.target.value)} required placeholder={__uiText('เช่น บริษัท ตัวอย่าง จำกัด')} hint={__uiText('ชื่อบนเอกสาร')} />
        <Input label={__uiText('เลขทะเบียน')} value={registerNumber} onChange={(e) => setRegisterNumber(e.target.value)} placeholder="0105500000000" hint={__uiText('ไม่จำเป็น เว้นว่างได้')} />
        <Input label={__uiText('เบอร์โทร')} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="021234567" hint={__uiText('ไม่จำเป็น เว้นว่างได้')} />
        <Input label={__uiText('ที่อยู่')} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={__uiText('เช่น 99 ถนนสุขุมวิท กรุงเทพ')} hint={__uiText('ไม่จำเป็น เว้นว่างได้')} />
      </FormSection>
      <FormSection title="วงเงิน" description="ไม่จำเป็นตอนสร้าง ใส่ 0 ได้" collapsed>
        <Input label={__uiText('วงเงินเครดิต')} type="number" unit={__uiText('บาท')} value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="0" hint={__uiText('จำนวนเงินสูงสุดที่บริษัทซื้อเชื่อได้')} />
        <Input label={__uiText('จำนวนวันเครดิต')} type="number" unit={__uiText('วัน')} value={creditTermDays} onChange={(e) => setCreditTermDays(e.target.value)} placeholder="30" hint={__uiText('กี่วันหลังส่งของจึงต้องชำระ')} />
      </FormSection>
    </AdminInsertLayout>
  );
}
