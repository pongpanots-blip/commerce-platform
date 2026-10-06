import { createCompanyAdmin } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';

export default function CreateCompanyAdmin() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [registerNumber, setRegisterNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [creditLimit, setCreditLimit] = useState('0');
  const [creditTermDays, setCreditTermDays] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      if (id) navigate(ADMIN_ROUTES.companyEdit(String(id)));
      else navigate(ADMIN_ROUTES.company);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-xl">
      <AdminListHeader title="สร้างบริษัท" subtitle="สร้างบริษัท B2B จาก Admin" />
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <Input label="ชื่อบริษัท" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input
          label="เลขทะเบียน"
          value={registerNumber}
          onChange={(e) => setRegisterNumber(e.target.value)}
        />
        <Input
          label="เบอร์โทร"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Input label="ที่อยู่" value={address} onChange={(e) => setAddress(e.target.value)} />
        <Input
          label="วงเงินเครดิต"
          type="number"
          value={creditLimit}
          onChange={(e) => setCreditLimit(e.target.value)}
        />
        <Input
          label="เทอมเครดิต (วัน)"
          type="number"
          value={creditTermDays}
          onChange={(e) => setCreditTermDays(e.target.value)}
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'กำลังบันทึก…' : 'สร้างบริษัท'}
        </button>
      </form>
    </div>
  );
}
