import { getCompanyById, updateCompany, type CompanyDetail } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import CompanySpecialPricingPanel from './CompanySpecialPricingPanel';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type BranchUser = CompanyDetail['branches'][number]['users'][number];

const ROLE_BADGE_STYLES: Record<string, string> = {
  super_admin: 'bg-violet-100 text-violet-800 border-violet-200',
  staff: 'bg-blue-100 text-blue-800 border-blue-200',
};

function RoleBadge({ role, label }: { role: string; label: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        ROLE_BADGE_STYLES[role] ?? 'bg-gray-100 text-gray-600 border-gray-200'
      }`}
    >
      {label}
    </span>
  );
}

function UserTable({
  users,
  onViewUser,
}: {
  users: BranchUser[];
  onViewUser: (userId: string) => void;
}) {
  __useUiLocale();
  if (users.length === 0) {
    return <p className="text-sm text-gray-500">{__uiText("ยังไม่มี Admin ในสาขานี้")}</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-100">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2 font-semibold">{__uiText("ชื่อ")}</th>
            <th className="px-3 py-2 font-semibold">{__uiText("อีเมล")}</th>
            <th className="px-3 py-2 font-semibold">{__uiText("เบอร์โทร")}</th>
            <th className="px-3 py-2 font-semibold">{__uiText("บทบาท")}</th>
            <th className="px-3 py-2 font-semibold">{__uiText("ตำแหน่ง")}</th>
            <th className="px-3 py-2 font-semibold" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {users.map((user) => (
            <tr key={user.id} className="hover:bg-gray-50/80">
              <td className="px-3 py-2.5 font-medium text-gray-900">
                {user.full_name}
              </td>
              <td className="px-3 py-2.5 text-gray-600">{user.email}</td>
              <td className="px-3 py-2.5 text-gray-600">
                {user.mobile_phone || '-'}
              </td>
              <td className="px-3 py-2.5">
                <RoleBadge role={user.role} label={user.role_label} />
              </td>
              <td className="px-3 py-2.5 text-gray-600">
                {user.job_title_label || '-'}
              </td>
              <td className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => onViewUser(user.id)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {__uiText("ดูโปรไฟล์")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BranchPanel({
  index,
  branch,
  onViewUser,
}: {
  index: number;
  branch: CompanyDetail['branches'][number];
  onViewUser: (userId: string) => void;
}) {
  __useUiLocale();
  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <header className="border-b border-gray-100 bg-slate-50 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {__uiText("สาขาที่ ")}{index + 1}
            </p>
            <h3 className="mt-1 text-lg font-bold text-gray-900">{branch.name}</h3>
            {branch.type && (
              <p className="mt-1 text-xs text-blue-600">{branch.type}</p>
            )}
          </div>
          {branch.phone && (
            <p className="rounded-lg bg-white px-3 py-1.5 text-xs text-gray-600 ring-1 ring-gray-200">
              {__uiText("โทรสาขา: ")}{branch.phone}
            </p>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {__uiText("ที่อยู่จัดส่งของสาขานี้")}</p>
          <p className="mt-1 text-sm leading-6 text-emerald-950">
            {branch.delivery_address?.trim() || __uiText("ยังไม่ระบุที่อยู่จัดส่ง")}
          </p>
        </div>
      </header>

      <div className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-bold text-gray-900">{__uiText("Admin สาขา")}</h4>
          <span className="text-xs text-gray-500">{branch.users.length} {__uiText(" คน")}</span>
        </div>
        <UserTable users={branch.users} onViewUser={onViewUser} />
      </div>
    </article>
  );
}

const CompanyEdit = () => {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [form, setForm] = useState({
    name: '',
    register_number: '',
    phone: '',
    address: '',
    credit_limit: 0,
    credit_term_days: 0,
  });

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await getCompanyById(id);
        const data = response.data?.data;
        if (!data) {
          setError(__uiMessage("ไม่พบข้อมูลบริษัท"));
          return;
        }
        setCompany(data);
        setForm({
          name: data.name ?? '',
          register_number: data.register_number ?? '',
          phone: data.phone ?? '',
          address: data.address ?? '',
          credit_limit: data.credit_limit ?? 0,
          credit_term_days: data.credit_term_days ?? 0,
        });
      } catch (err: unknown) {
        const message =
          (err as { response?: { data?: { message?: string } } })?.response?.data
            ?.message ?? 'โหลดข้อมูลไม่สำเร็จ';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [id]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!id || !form.name.trim()) {
      alert(__uiText("กรุณากรอกชื่อบริษัท"));
      return;
    }

    setSaving(true);
    try {
      const response = await updateCompany(id, {
        name: form.name.trim(),
        register_number: form.register_number.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        credit_limit: Number(form.credit_limit),
        credit_term_days: Number(form.credit_term_days),
      });
      const data = response.data?.data;
      if (data) {
        setCompany(data);
        alert(__uiText("บันทึกข้อมูลบริษัทสำเร็จ"));
      }
    } catch {
      alert(__uiText("เกิดข้อผิดพลาดในการบันทึก"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="cp-management-page text-sm text-gray-500">
        {__uiText("กำลังโหลดข้อมูลบริษัท...")}</div>
    );
  }

  if (error || !company) {
    return (
      <div className="cp-management-page">
        <p className="text-sm text-red-600">{error || __uiText("ไม่พบข้อมูลบริษัท")}</p>
        <button
          type="button"
          onClick={() => navigate(ADMIN_ROUTES.company)}
          className="mt-3 text-sm text-primary hover:underline"
        >
          {__uiText("กลับรายการบริษัท")}</button>
      </div>
    );
  }

  return (
    <div className="cp-management-page grid w-full gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate(ADMIN_ROUTES.company)}
            className="mb-2 text-sm text-gray-500 hover:text-gray-800"
          >
            {__uiText("← กลับรายการบริษัท")}</button>
          <h1 className="text-2xl font-bold text-gray-900">{__uiText("แก้ไขบริษัท")}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {__uiText("ข้อมูลบริษัทด้านบน · ผู้ใช้และที่อยู่จัดส่งแยกตามสาขาด้านล่าง")}</p>
        </div>
        <button
          type="submit"
          form="company-edit-form"
          disabled={saving}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {saving ? __uiText("กำลังบันทึก...") : __uiText("บันทึกข้อมูลบริษัท")}
        </button>
      </div>

      <form
        id="company-edit-form"
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm md:grid-cols-2"
      >
        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            {__uiText("ชื่อบริษัท")}</span>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder={__uiText("ชื่อบริษัท / ร้าน")}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            {__uiText("เลขทะเบียนนิติบุคคล")}</span>
          <Input
            value={form.register_number}
            onChange={(event) =>
              setForm({ ...form, register_number: event.target.value })
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            {__uiText("เบอร์โทรบริษัท")}</span>
          <Input
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            {__uiText("ที่อยู่บริษัท (สำนักงานใหญ่)")}</span>
          <textarea
            value={form.address}
            onChange={(event) => setForm({ ...form, address: event.target.value })}
            rows={3}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"
            placeholder={__uiText("ที่อยู่ตามทะเบียนบริษัท — ไม่ใช่ที่อยู่จัดส่งของแต่ละสาขา")}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            {__uiText("วงเงินเครดิตสูงสุด (บาท)")}</span>
          <Input
            type="number"
            min={0}
            value={form.credit_limit}
            onChange={(event) =>
              setForm({ ...form, credit_limit: Number(event.target.value) })
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            {__uiText("เครดิตเทอม (วัน)")}</span>
          <Input
            type="number"
            min={0}
            value={form.credit_term_days}
            onChange={(event) =>
              setForm({ ...form, credit_term_days: Number(event.target.value) })
            }
          />
        </label>

        <div className="md:col-span-2 flex flex-wrap gap-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <span>
            {__uiText("ใช้ไปแล้ว:")}{' '}
            <strong className="text-gray-900">
              {company.credit_used.toLocaleString()} {__uiText(" บาท")}</strong>
          </span>
          <span>
            {__uiText("คงเหลือ:")}{' '}
            <strong className="text-emerald-700">
              {company.credit_balance.toLocaleString()} {__uiText(" บาท")}</strong>
          </span>
        </div>
      </form>

      <section className="overflow-hidden rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-lg font-bold text-gray-900">{__uiText("ราคาพิเศษ (บริษัท)")}</h2>
        <CompanySpecialPricingPanel
          companyId={company.id}
          branches={company.branches.map((b) => ({ id: b.id, name: b.name }))}
        />
      </section>

      <section className="grid gap-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{__uiText("สาขา · ที่อยู่จัดส่ง · ผู้ใช้")}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {__uiText("แต่ละสาขามีที่อยู่จัดส่งของตัวเอง และแสดงเฉพาะ Admin สาขา")}</p>
        </div>

        {company.branches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white p-6 text-sm text-gray-500">
            {__uiText("ยังไม่มีสาขาในบริษัทนี้")}</div>
        ) : (
          company.branches.map((branch, index) => (
            <BranchPanel
              key={branch.id}
              index={index}
              branch={branch}
              onViewUser={(userId) => navigate(ADMIN_ROUTES.userDetail(userId))}
            />
          ))
        )}

        {company.unassigned_users.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h3 className="text-sm font-bold text-amber-900">
              {__uiText("ผู้ใช้ที่ยังไม่ผูกสาขา (")}{company.unassigned_users.length})
            </h3>
            <p className="mt-1 text-xs text-amber-800">
              {__uiText("รายชื่อเหล่านี้ยังไม่ถูกกำหนดว่าจัดส่งที่สาขาใด — ควรผูกกับสาขาเพื่อระบุที่อยู่จัดส่ง")}</p>
            <div className="mt-3">
              <UserTable
                users={company.unassigned_users}
                onViewUser={(userId) => navigate(ADMIN_ROUTES.userDetail(userId))}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default CompanyEdit;
