import { FormEvent, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import {
  Button, Chip, DetailSection, Empty, ErrorText, Field, FormPanel, Icon, Input, KeyValueGrid, Loading,
  Page, PageHeader, Panel, SearchInput, Span, StatusChip, statusLabel,
  TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { joshActionsApi, joshCustomerApi, JoshRow, session } from '../../lib/api';
import { useAsync } from '../hooks';
import { CompanyTermsPrices } from './CompanyTermsPrices';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const KYC: Record<string, [string, 'muted' | 'warn' | 'ok' | 'danger']> = { none: ['ไม่มีเอกสาร', 'muted'], pending: ['รอตรวจ', 'warn'], approved: ['ผ่าน', 'ok'], rejected: ['ไม่ผ่าน', 'danger'] };

/**
 * Edit customer data through josh (COMMERCE_OWNS_CUSTOMERS). Masked values start empty: fill a field only to
 * change it. josh validates with its own DTOs; company edits (credit limit / term) need an admin role in josh.
 */
function CustomerEdit({ kind, id, label, fields, onDone }: {
  kind: 'users' | 'branches' | 'companies'; id: string; label: string; onDone: () => void;
  fields: [key: string, label: string, current: unknown, type?: 'number'][];
}) {
  __useUiLocale();
  const start = () => Object.fromEntries(fields.map(([k, , v]) => [k, v == null ? '' : String(v)]));
  const [v, setV] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (session.claims()?.role !== 'admin') return null;
  if (!v) return <Button size="sm" variant="ghost" onClick={() => setV(start())}>{__uiText("แก้")}</Button>;

  const initial = start();
  const changed = fields.filter(([k]) => v[k].trim() !== '' && v[k] !== initial[k]);

  async function save() {
    const changes: Record<string, unknown> = {};
    for (const [k, l, , type] of changed) {
      if (type === 'number') {
        const n = Number(v![k]);
        if (!Number.isFinite(n) || n < 0) return setErr(__uiText('{0}: ต้องเป็นตัวเลขไม่ติดลบ', { 0: __uiText(l) }));
        changes[k] = n;
      } else changes[k] = v![k].trim();
    }
    if (!window.confirm(__uiText("บันทึก {0}: {1}?\n\nร้านค้าออนไลน์จะบันทึกจริงในนามของคุณ และเก็บอีเมลของคุณไว้ในประวัติการแก้ไข", {"0": label, "1": changed.map(([, l]) => __uiText(l)).join(', ')}))) return;
    setBusy(true); setErr('');
    try { await joshActionsApi.updateCustomer(kind, id, changes); setV(null); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <FormPanel
      title={label}
      icon="edit"
      cols={1}
      error={err}
      busy={busy}
      onSubmit={save}
      onCancel={() => setV(null)}
      description={__uiText("ว่าง = ไม่เปลี่ยนค่า")}
    >
      {fields.map(([k, l, , type]) => (
        <Field key={k} label={l} hint={initial[k] === '' ? __uiText(" (ว่าง = คงเดิม)") : undefined}>
          <Input
            inputMode={type === 'number' ? 'decimal' : undefined}
            type={k === 'email' ? 'email' : 'text'}
            value={v[k]}
            onChange={(e) => setV({ ...v, [k]: e.target.value })}
          />
        </Field>
      ))}
    </FormPanel>
  );
}

/** Customer detail page (from expanded row). */
export function JoshCustomerDetail() {
  __useUiLocale();
  const { id = '' } = useParams();
  const location = useLocation();
  const detail = useAsync(() => joshCustomerApi.detail(id), [id]);
  const d = detail.data;

  const backTo = `${location.state?.from ?? '/reports/customers'}${location.state?.search ?? ''}`;
  const kycText = (k: string) => (KYC[k] ? __uiText(KYC[k][0]) : k);
  const over = d && d.credit_limit > 0 && d.credit_used > d.credit_limit;

  return (
    <Page>
      <PageHeader
        back={{ to: backTo, label: 'รายงานลูกค้าและบริษัท' }}
        title={d ? d.name?.trim() || d.register_number || __uiText("ไม่มีชื่อบริษัท") : id}
        badge={d && <Chip tone={KYC[d.kyc_status]?.[1] ?? 'muted'} dot>{__uiText('เอกสารยืนยันตัวตน: {0}', { 0: kycText(d.kyc_status) })}</Chip>}
        subtitle={d ? [d.register_number, __uiText('วงเงิน {0} / {1}', { 0: fmt.baht(d.credit_used), 1: fmt.baht(d.credit_limit) }), d.credit_term_days ? __uiText('{0} วัน', { 0: d.credit_term_days }) : __uiText('เงินสด')].filter(Boolean).join(' · ') : undefined}
      />

      <ErrorText error={detail.error} />

      {detail.loading && !d ? (
        <Loading />
      ) : !d ? (
        <Panel><Empty>{__uiText("ไม่พบลูกค้า")}</Empty></Panel>
      ) : (
        <>
          <Panel className="p-4">
            <DetailSection title={__uiText("ภาพรวม")} icon="info">
              <KeyValueGrid
                items={[
                  { label: __uiText("โทร"), value: d.phone ?? '—' },
                  { label: __uiText("ออเดอร์"), value: fmt.num(d.orders?.orders ?? 0) },
                  { label: __uiText("ยอดที่ชำระแล้ว"), value: fmt.baht(d.orders?.paid_value) },
                  { label: __uiText("วงเงิน"), value: over ? <Chip tone="danger" dot>{__uiText("เกินวงเงิน")}</Chip> : `${fmt.baht(d.credit_used)} / ${fmt.baht(d.credit_limit)}` },
                ]}
              />
            </DetailSection>
          </Panel>

          <Panel className="p-4">
            <DetailSection title={__uiText("บริษัท {0}", {"0": d.name})} icon="business">
              <CustomerEdit
                kind="companies"
                id={d.id}
                label={__uiText("บริษัท {0}", {"0": d.name})}
                onDone={() => detail.reload()}
                fields={[['name', 'ชื่อบริษัท', d.name], ['credit_limit', 'วงเงิน (บาท)', d.credit_limit, 'number'], ['address', 'ที่อยู่', null], ['phone', 'โทร', null]]}
              />
            </DetailSection>
          </Panel>

          <CompanyTermsPrices company={d} onSaved={() => detail.reload()} />

          <Panel className="p-4">
            <DetailSection title={__uiText("สาขา")} icon="store">
              {d.branches && d.branches.length ? (
                <Table>
                  <THead>
                    <TH>{__uiText("สาขา")}</TH>
                    <TH>{__uiText("รหัสสาขา (ERP)")}</TH>
                    <TH>{__uiText("ส่งเข้าระบบขาย (ERP)")}</TH>
                    <TH>{__uiText("วันส่ง")}</TH>
                    <TH>{__uiText("โทร")}</TH>
                    <TH />
                  </THead>
                  <TBody>
                    {d.branches.map((b: JoshRow) => (
                      <TR key={b.id}>
                        <TD>
                          {b.name}
                          {b.is_default_delivery && <Chip tone="info" className="ml-2">{__uiText("หลัก")}</Chip>}
                        </TD>
                        <TD kind="code">{b.erp_branch_code ?? '—'}</TD>
                        <TD><StatusChip status={b.erp_sync_status} /></TD>
                        <TD>{b.delivery_days ?? '—'}</TD>
                        <TD>{b.phone ?? '—'}</TD>
                        <TD>
                          <CustomerEdit
                            kind="branches"
                            id={b.id}
                            label={__uiText("สาขา {0}", {"0": b.name})}
                            onDone={detail.reload}
                            fields={[['name', 'ชื่อสาขา', b.name], ['recipient_name', 'ผู้รับ', null], ['phone', 'โทร', null], ['delivery_address', 'ที่อยู่ส่ง', null]]}
                          />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <Empty>{__uiText("ไม่มีสาขา")}</Empty>
              )}
            </DetailSection>
          </Panel>

          <Panel className="p-4">
            <DetailSection title={__uiText("ผู้ใช้")} icon="person">
              {d.users && d.users.length ? (
                <Table>
                  <THead>
                    <TH>{__uiText("ผู้ใช้")}</TH>
                    <TH>{__uiText("อีเมล")}</TH>
                    <TH>{__uiText("โทร")}</TH>
                    <TH>{__uiText("บทบาท")}</TH>
                    <TH>{__uiText("เข้าแอปล่าสุด")}</TH>
                    <TH />
                  </THead>
                  <TBody>
                    {d.users.map((u: JoshRow) => (
                      <TR key={u.id}>
                        <TD>
                          {u.first_name} {u.last_name ?? ''}
                          {!u.is_active && <Chip tone="muted" className="ml-2">{__uiText("ปิด")}</Chip>}
                        </TD>
                        <TD kind="mono">{u.email ?? '—'}</TD>
                        <TD>{u.mobile_phone ?? '—'}</TD>
                        <TD>{u.role ? <Chip>{u.role}</Chip> : '—'}</TD>
                        <TD kind="time">{fmt.when(u.last_app_login_at)}</TD>
                        <TD>
                          <CustomerEdit
                            kind="users"
                            id={u.id}
                            label={__uiText("ผู้ใช้นี้")}
                            onDone={detail.reload}
                            fields={[['first_name', 'ชื่อ', null], ['last_name', 'นามสกุล', null], ['email', 'อีเมล', null], ['mobile_phone', 'มือถือ', null]]}
                          />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <Empty>{__uiText("ไม่มีผู้ใช้")}</Empty>
              )}
            </DetailSection>
          </Panel>

          <Panel className="p-4">
            <DetailSection title={__uiText("เอกสารยืนยันตัวตนและวงเงิน")} icon="verified_user">
              <KeyValueGrid
                cols={2}
                items={[
                  {
                    label: __uiText("เอกสารยืนยันตัวตน"),
                    value: d.kycDocuments && d.kycDocuments.length
                      ? d.kycDocuments.map((k: JoshRow) => `${k.document_type} ${kycText(k.status)}${k.rejection_reason ? ` (${k.rejection_reason})` : ''}`).join(' · ')
                      : __uiText("ยังไม่มีเอกสาร"),
                  },
                  {
                    label: __uiText("คำขอวงเงิน"),
                    value: d.creditApplications && d.creditApplications.length
                      ? d.creditApplications.map((a: JoshRow) => `${statusLabel(a.status)} · ${__uiText('ขอ {0} / {1} วัน', { 0: fmt.baht(a.requested_credit_limit), 1: a.requested_term_days })}${a.approved_credit_limit ? ` · ${__uiText('อนุมัติ {0}', { 0: fmt.baht(a.approved_credit_limit) })}` : ''}`).join(' · ')
                      : '—',
                  },
                ]}
              />
            </DetailSection>
          </Panel>
        </>
      )}
    </Page>
  );
}
