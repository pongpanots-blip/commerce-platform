// ui-metadata-migration: static labels and UI notices only
import { createCompanyAdmin } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
      setError(err?.response?.data?.message ?? __uiMessage("บันทึกไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-xl">
      <AdminListHeader title={__uiText("สร้างบริษัท")} subtitle={__uiText("สร้างบริษัท B2B จาก Admin")} />
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <Input label={__uiText("ชื่อบริษัท")} value={name} onChange={(e) => setName(e.target.value)} required />
        <Input
          label={__uiText("เลขทะเบียน")}
          value={registerNumber}
          onChange={(e) => setRegisterNumber(e.target.value)}
        />
        <Input
          label={__uiText("เบอร์โทร")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Input label={__uiText("ที่อยู่")} value={address} onChange={(e) => setAddress(e.target.value)} />
        <Input
          label={__uiText("วงเงินเครดิต")}
          type="number"
          value={creditLimit}
          onChange={(e) => setCreditLimit(e.target.value)}
        />
        <Input
          label={__uiText("เทอมเครดิต (วัน)")}
          type="number"
          value={creditTermDays}
          onChange={(e) => setCreditTermDays(e.target.value)}
        />
        {error && <p className="text-sm text-rose-600">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? __uiText("กำลังบันทึก…") : __uiText("สร้างบริษัท")}
        </button>
      </form>
    </div>
  );
}
