import { FormEvent, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import {
  Button, Chip, DetailSection, Empty, ErrorText, Field, FormPanel, Icon, Input, KeyValueGrid, Loading,
  Page, PageHeader, Panel, SearchInput, Span, StatusChip,
  TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { joshActionsApi, joshCustomerApi, JoshRow } from '../../lib/api';
import { useAsync } from '../hooks';

const KYC: Record<string, [string, string]> = { none: ['ไม่มีเอกสาร', 'muted'], pending: ['รอตรวจ', 'warn'], approved: ['ผ่าน', 'ok'], rejected: ['ไม่ผ่าน', 'danger'] };

/**
 * Edit customer data through josh (COMMERCE_OWNS_CUSTOMERS). Masked values start empty: fill a field only to
 * change it. josh validates with its own DTOs; company edits (credit limit / term) need an admin role in josh.
 */
function CustomerEdit({ kind, id, label, fields, onDone }: {
  kind: 'users' | 'branches' | 'companies'; id: string; label: string; onDone: () => void;
  fields: [key: string, label: string, current: unknown, type?: 'number'][];
}) {
  const start = () => Object.fromEntries(fields.map(([k, , v]) => [k, v == null ? '' : String(v)]));
  const [v, setV] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!v) return <Button size="sm" variant="ghost" onClick={() => setV(start())}>แก้</Button>;

  const initial = start();
  const changed = fields.filter(([k]) => v[k].trim() !== '' && v[k] !== initial[k]);

  async function save() {
    const changes: Record<string, unknown> = {};
    for (const [k, l, , type] of changed) {
      if (type === 'number') {
        const n = Number(v![k]);
        if (!Number.isFinite(n) || n < 0) return setErr(`${l}: ต้องเป็นตัวเลขไม่ติดลบ`);
        changes[k] = n;
      } else changes[k] = v![k].trim();
    }
    if (!window.confirm(`บันทึก ${label}: ${changed.map(([, l]) => l).join(', ')}?\n\njosh บันทึกจริงในนามของคุณ — josh บันทึกอีเมลคุณไว้ใน audit`)) return;
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
      description="ว่าง = ไม่เปลี่ยนค่า"
    >
      {fields.map(([k, l, , type]) => (
        <Field key={k} label={l} hint={initial[k] === '' ? ' (ว่าง = คงเดิม)' : undefined}>
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
  const { id = '' } = useParams();
  const location = useLocation();
  const detail = useAsync(() => joshCustomerApi.detail(id), [id]);
  const d = detail.data;

  const backTo = `${location.state?.from ?? '/reports/customers'}${location.state?.search ?? ''}`;
  const [kycLabel, kycTone] = d ? KYC[d.kyc_status] ?? [d.kyc_status, 'muted'] : ['—', 'muted'];
  const over = d && d.credit_limit > 0 && d.credit_used > d.credit_limit;

  return (
    <Page>
      <PageHeader
        back={{ to: backTo, label: 'ลูกค้า / บริษัท (josh)' }}
        title={d ? d.name?.trim() || d.register_number || 'ไม่มีชื่อบริษัท' : id}
        badge={d && <Chip tone={kycTone as any}>{kycLabel}</Chip>}
        subtitle={d ? [d.register_number, `วงเงิน ${fmt.baht(d.credit_used)} / ${fmt.baht(d.credit_limit)}`, d.credit_term_days ? `${d.credit_term_days} วัน` : 'เงินสด'].filter(Boolean).join(' · ') : undefined}
      />

      <ErrorText error={detail.error} />

      {detail.loading && !d ? (
        <Loading />
      ) : !d ? (
        <Panel><Empty>ไม่พบลูกค้า</Empty></Panel>
      ) : (
        <>
          <Panel className="p-4">
            <div className="text-xs text-on-surface-variant space-y-2">
              <div>
                โทร {d.phone ?? '—'} · ออเดอร์ {d.orders?.orders ?? 0} รายการ · ยอดที่ชำระแล้ว {fmt.baht(d.orders?.paid_value)}
              </div>
              {over && <div><Chip tone="danger">เกินวงเงิน</Chip></div>}
            </div>
          </Panel>

          <Panel className="p-4">
            <DetailSection title={`บริษัท ${d.name}`} icon="business">
              <CustomerEdit
                kind="companies"
                id={d.id}
                label={`บริษัท ${d.name}`}
                onDone={() => detail.reload()}
                fields={[['name', 'ชื่อบริษัท', d.name], ['credit_limit', 'วงเงิน (บาท)', d.credit_limit, 'number'], ['credit_term_days', 'เครดิต (วัน)', d.credit_term_days, 'number'], ['address', 'ที่อยู่', null], ['phone', 'โทร', null]]}
              />
            </DetailSection>
          </Panel>

          <Panel className="p-4">
            <DetailSection title="สาขา" icon="store">
              {d.branches && d.branches.length ? (
                <Table>
                  <THead>
                    <TH>สาขา</TH>
                    <TH>รหัส ERP</TH>
                    <TH>sync</TH>
                    <TH>วันส่ง</TH>
                    <TH>โทร</TH>
                    <TH />
                  </THead>
                  <TBody>
                    {d.branches.map((b: JoshRow) => (
                      <TR key={b.id}>
                        <TD>
                          {b.name}
                          {b.is_default_delivery && <Chip tone="info" className="ml-2">หลัก</Chip>}
                        </TD>
                        <TD kind="code">{b.erp_branch_code ?? '—'}</TD>
                        <TD>{b.erp_sync_status ?? '—'}</TD>
                        <TD>{b.delivery_days ?? '—'}</TD>
                        <TD>{b.phone ?? '—'}</TD>
                        <TD>
                          <CustomerEdit
                            kind="branches"
                            id={b.id}
                            label={`สาขา ${b.name}`}
                            onDone={detail.reload}
                            fields={[['name', 'ชื่อสาขา', b.name], ['recipient_name', 'ผู้รับ', null], ['phone', 'โทร', null], ['delivery_address', 'ที่อยู่ส่ง', null]]}
                          />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <Empty>ไม่มีสาขา</Empty>
              )}
            </DetailSection>
          </Panel>

          <Panel className="p-4">
            <DetailSection title="ผู้ใช้" icon="person">
              {d.users && d.users.length ? (
                <Table>
                  <THead>
                    <TH>ผู้ใช้</TH>
                    <TH>อีเมล</TH>
                    <TH>โทร</TH>
                    <TH>role</TH>
                    <TH>เข้าแอปล่าสุด</TH>
                    <TH />
                  </THead>
                  <TBody>
                    {d.users.map((u: JoshRow) => (
                      <TR key={u.id}>
                        <TD>
                          {u.first_name} {u.last_name ?? ''}
                          {!u.is_active && <Chip tone="muted" className="ml-2">ปิด</Chip>}
                        </TD>
                        <TD>{u.email ?? '—'}</TD>
                        <TD>{u.mobile_phone ?? '—'}</TD>
                        <TD>{u.role}</TD>
                        <TD>{fmt.when(u.last_app_login_at)}</TD>
                        <TD>
                          <CustomerEdit
                            kind="users"
                            id={u.id}
                            label="ผู้ใช้นี้"
                            onDone={detail.reload}
                            fields={[['first_name', 'ชื่อ', null], ['last_name', 'นามสกุล', null], ['email', 'อีเมล', null], ['mobile_phone', 'มือถือ', null]]}
                          />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <Empty>ไม่มีผู้ใช้</Empty>
              )}
            </DetailSection>
          </Panel>

          <Panel className="p-4">
            <DetailSection title="KYC และวงเงิน" icon="verified_user">
              <div className="space-y-3 text-xs text-on-surface-variant">
                <div>
                  <span className="font-semibold">KYC:</span>{' '}
                  {d.kycDocuments && d.kycDocuments.length
                    ? d.kycDocuments.map((k: JoshRow) => `${k.document_type} ${KYC[k.status]?.[0] ?? k.status}${k.rejection_reason ? ` (${k.rejection_reason})` : ''}`).join(' · ')
                    : 'ยังไม่มีเอกสาร'}
                </div>
                <div>
                  <span className="font-semibold">ขอวงเงิน:</span>{' '}
                  {d.creditApplications && d.creditApplications.length
                    ? d.creditApplications.map((a: JoshRow) => `${a.status} ขอ ${fmt.baht(a.requested_credit_limit)} / ${a.requested_term_days} วัน${a.approved_credit_limit ? ` → อนุมัติ ${fmt.baht(a.approved_credit_limit)}` : ''}`).join(' · ')
                    : '—'}
                </div>
              </div>
            </DetailSection>
          </Panel>
        </>
      )}
    </Page>
  );
}
