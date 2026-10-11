import { Alert, Button, Chip, Empty, FormField, FormPanel, Input, KeyValueGrid, Loading, PageHeader, Panel, PanelHead, Table, TBody, TD, TH, THead, TR, inputCls, type Tone } from '@cp/ui';
import { getCompanyById, updateCompany, type CompanyDetail } from '@josh/shared-api';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import CompanySpecialPricingPanel from './CompanySpecialPricingPanel';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type BranchUser = CompanyDetail['branches'][number]['users'][number];

const ROLE_TONES: Record<string, Tone> = {
  super_admin: 'primary',
  staff: 'info',
};

function UserTable({
  users,
  onViewUser,
}: {
  users: BranchUser[];
  onViewUser: (userId: string) => void;
}) {
  __useUiLocale();
  if (users.length === 0) {
    return <Empty icon="person_off">{__uiText("ยังไม่มีผู้ดูแลในสาขานี้")}</Empty>;
  }

  return (
    <Table>
      <THead>
        <TH>{__uiText("ชื่อ")}</TH>
        <TH>{__uiText("อีเมล")}</TH>
        <TH>{__uiText("เบอร์โทร")}</TH>
        <TH>{__uiText("บทบาท")}</TH>
        <TH>{__uiText("ตำแหน่ง")}</TH>
        <TH />
      </THead>
      <TBody>
        {users.map((user) => (
          <TR key={user.id}>
            <TD className="font-medium">{user.full_name}</TD>
            <TD kind="muted">{user.email}</TD>
            <TD kind="muted">{user.mobile_phone || '-'}</TD>
            <TD>
              <Chip tone={ROLE_TONES[user.role] ?? 'muted'} statusCode={user.role}>{user.role_label}</Chip>
            </TD>
            <TD kind="muted">{user.job_title_label || '-'}</TD>
            <TD kind="actions">
              <Button size="sm" variant="ghost" onClick={() => onViewUser(user.id)}>
                {__uiText("ดูโปรไฟล์")}</Button>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
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
    <Panel className="overflow-hidden">
      <PanelHead
        icon="storefront"
        title={branch.name}
        sub={<>{__uiText("สาขาที่ ")}{index + 1}{branch.type ? ` · ${branch.type}` : ''}</>}
        badge={<Chip>{branch.users.length} {__uiText(" คน")}</Chip>}
      />
      <div className="p-4">
        <KeyValueGrid
          cols={2}
          items={[
            { label: __uiText("ที่อยู่จัดส่งของสาขานี้"), value: branch.delivery_address?.trim() || __uiText("ยังไม่ระบุที่อยู่จัดส่ง") },
            { label: __uiText("โทรสาขา"), value: branch.phone || '—' },
          ]}
        />
      </div>
      <UserTable users={branch.users} onViewUser={onViewUser} />
    </Panel>
  );
}

const CompanyEdit = () => {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
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
      setNotice({ tone: 'danger', text: __uiText("กรุณากรอกชื่อบริษัท") });
      return;
    }

    setNotice(null);
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
        setNotice({ tone: 'ok', text: __uiText("บันทึกข้อมูลบริษัทสำเร็จ") });
      }
    } catch {
      setNotice({ tone: 'danger', text: __uiText("เกิดข้อผิดพลาดในการบันทึก") });
    } finally {
      setSaving(false);
    }
  };

  const back = { to: ADMIN_ROUTES.company, label: 'กลับรายการบริษัท' };

  if (loading) {
    return (
      <div className="cp-management-page grid w-full gap-6">
        <PageHeader back={back} title={__uiText("แก้ไขบริษัท")} />
        <Loading variant="form">{__uiText("กำลังโหลดข้อมูลบริษัท...")}</Loading>
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="cp-management-page grid w-full gap-6">
        <PageHeader back={back} title={__uiText("แก้ไขบริษัท")} />
        <Alert tone="danger">{error || __uiText("ไม่พบข้อมูลบริษัท")}</Alert>
      </div>
    );
  }

  const field = (key: 'name' | 'register_number' | 'phone') => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value }),
  });

  return (
    <div className="cp-management-page grid w-full gap-6">
      <PageHeader
        back={back}
        title={company.name || __uiText("แก้ไขบริษัท")}
        subtitle={__uiText("แก้ข้อมูลบริษัทด้านบน ส่วนผู้ใช้และที่อยู่จัดส่งแยกตามสาขาด้านล่าง")}
      />

      {notice && <Alert tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Alert>}

      <FormPanel
        title={__uiText("ข้อมูลบริษัท")}
        icon="business"
        submitLabel={saving ? __uiText("กำลังบันทึก...") : __uiText("บันทึกข้อมูลบริษัท")}
        busy={saving}
        onSubmit={handleSubmit}
        onCancel={() => navigate(ADMIN_ROUTES.company)}
      >
        <FormField label={__uiText("ชื่อบริษัท")} required className="md:col-span-2">
          <Input {...field('name')} placeholder={__uiText("ชื่อบริษัท / ร้าน")} />
        </FormField>
        <FormField label={__uiText("เลขทะเบียนนิติบุคคล")}>
          <Input {...field('register_number')} className="font-mono" />
        </FormField>
        <FormField label={__uiText("เบอร์โทรบริษัท")}>
          <Input {...field('phone')} />
        </FormField>
        <FormField
          label={__uiText("ที่อยู่บริษัท (สำนักงานใหญ่)")}
          hint={__uiText("ที่อยู่ตามทะเบียนบริษัท ไม่ใช่ที่อยู่จัดส่งของแต่ละสาขา")}
          className="md:col-span-2"
        >
          <textarea
            className={inputCls}
            value={form.address}
            onChange={(event) => setForm({ ...form, address: event.target.value })}
            rows={3}
          />
        </FormField>
        <FormField label={__uiText("วงเงินเครดิตสูงสุด (บาท)")}>
          <Input
            type="number"
            min={0}
            className="text-right"
            value={form.credit_limit}
            onChange={(event) =>
              setForm({ ...form, credit_limit: Number(event.target.value) })
            }
          />
        </FormField>
        <FormField label={__uiText("เครดิตเทอม (วัน)")}>
          <Input
            type="number"
            min={0}
            className="text-right"
            value={form.credit_term_days}
            onChange={(event) =>
              setForm({ ...form, credit_term_days: Number(event.target.value) })
            }
          />
        </FormField>
        <div className="md:col-span-2">
          <KeyValueGrid
            cols={2}
            items={[
              { label: __uiText("ใช้ไปแล้ว"), value: <span className="tabular-nums">{company.credit_used.toLocaleString()} {__uiText(" บาท")}</span> },
              { label: __uiText("คงเหลือ"), value: <span className="tabular-nums">{company.credit_balance.toLocaleString()} {__uiText(" บาท")}</span> },
            ]}
          />
        </div>
      </FormPanel>

      <Panel className="overflow-hidden">
        <PanelHead icon="sell" title={__uiText("ราคาพิเศษ (บริษัท)")} />
        <div className="p-4">
          <CompanySpecialPricingPanel
            companyId={company.id}
            branches={company.branches.map((b) => ({ id: b.id, name: b.name }))}
          />
        </div>
      </Panel>

      <section className="grid gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-on-surface">{__uiText("สาขา ที่อยู่จัดส่ง และผู้ใช้")}</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {__uiText("แต่ละสาขามีที่อยู่จัดส่งของตัวเอง และแสดงเฉพาะผู้ดูแลสาขา")}</p>
        </div>

        {company.branches.length === 0 ? (
          <Panel>
            <Empty icon="storefront">{__uiText("ยังไม่มีสาขาในบริษัทนี้")}</Empty>
          </Panel>
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
          <Panel className="overflow-hidden">
            <PanelHead
              icon="person_alert"
              title={<>{__uiText("ผู้ใช้ที่ยังไม่ผูกสาขา (")}{company.unassigned_users.length})</>}
              badge={<Chip tone="warn" dot>{__uiText("ควรผูกสาขา")}</Chip>}
              sub={__uiText("ผู้ใช้เหล่านี้ยังไม่ได้กำหนดสาขาที่จัดส่ง ควรผูกกับสาขาเพื่อระบุที่อยู่จัดส่ง")}
            />
            <UserTable
              users={company.unassigned_users}
              onViewUser={(userId) => navigate(ADMIN_ROUTES.userDetail(userId))}
            />
          </Panel>
        )}
      </section>
    </div>
  );
};

export default CompanyEdit;
