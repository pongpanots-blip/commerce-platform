import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button, Chip, DetailSection, Empty, ErrorText, Input, Loading, Panel, StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
  uiText as __uiText, useUiLocale as __useUiLocale,
} from '@cp/ui';
import { joshActionsApi, JoshRow, session, staffPricesApi, StaffPriceRow } from '../../lib/api';
import { canSee } from '../navigation';
import { useAsync } from '../hooks';

/** 0 = cash. Shopify's net-terms presets; any other day count can still be typed. */
export const TERM_PRESETS = [0, 7, 15, 30, 45, 60, 90];
const OPEN_APPLICATION = ['PENDING', 'REVIEW', 'REQUEST_DOC'];
const APPLICATION_LABEL: Record<string, string> = { PENDING: 'รอพิจารณา', REVIEW: 'กำลังตรวจ', REQUEST_DOC: 'รอเอกสารเพิ่ม' };
export const termLabel = (days: unknown) => (Number(days) > 0 ? __uiText('{0} วัน', { 0: Number(days) }) : __uiText('เงินสด'));

/** Company credit term (edit, admin) + the company's and its branches' own prices (commerce-owned staff_prices). */
export function CompanyTermsPrices({ company, onSaved }: { company: JoshRow; onSaved: () => void }) {
  __useUiLocale();
  const role = session.claims()?.role;
  const branches: JoshRow[] = company.branches ?? [];
  const openApplication = (company.creditApplications ?? []).find((a: JoshRow) => OPEN_APPLICATION.includes(String(a.status)));
  return (
    <Panel className="p-4">
      <DetailSection title={__uiText('เทอมและราคาเฉพาะบริษัท')} icon="request_quote">
        <TermEditor companyId={company.id} current={Number(company.credit_term_days) || 0} canEdit={role === 'admin'} onSaved={onSaved} />
        {openApplication && (
          <p className="mt-2 text-xs text-on-surface-variant">
            {__uiText('มีคำขอเครดิตที่ยังไม่ปิด ({0}) ถ้าอนุมัติ เทอมจะถูกเปลี่ยนตามคำขอ', { 0: __uiText(APPLICATION_LABEL[String(openApplication.status)]) })}
          </p>
        )}
        {branches.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {branches.map((b) => (
              <Chip key={b.id} tone="muted">{b.name}: {b.credit_term == null ? __uiText('ตามบริษัท') : termLabel(b.credit_term)}</Chip>
            ))}
          </div>
        )}
        {canSee(role, '/prices/staff')
          ? <CompanyPrices companyId={company.id} branches={branches} />
          : <p className="mt-4 text-xs text-on-surface-variant">{__uiText('ราคาเฉพาะบริษัทดูได้เฉพาะทีมสินค้าและแอดมิน')}</p>}
      </DetailSection>
    </Panel>
  );
}

function TermEditor({ companyId, current, canEdit, onSaved }: { companyId: string; current: number; canEdit: boolean; onSaved: () => void }) {
  const [days, setDays] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const value = days === null ? current : Number(days);
  const valid = days !== null && days.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= 365;

  async function save() {
    if (!valid || value === current) return;
    if (!window.confirm(__uiText('เปลี่ยนเครดิตเทอมจาก {0} เป็น {1}?', { 0: termLabel(current), 1: termLabel(value) }))) return;
    setBusy(true); setErr('');
    try {
      await joshActionsApi.updateCustomer('companies', companyId, { credit_term_days: value });
      setDays(null);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">{__uiText('เครดิตเทอมบริษัท')}: <strong>{termLabel(current)}</strong></span>
      {canEdit && (days === null ? (
        <Button size="sm" variant="ghost" onClick={() => setDays(String(current))}>{__uiText('แก้เทอม')}</Button>
      ) : (
        <>
          {TERM_PRESETS.map((d) => (
            <Button key={d} size="sm" variant={value === d ? 'primary' : 'ghost'} onClick={() => setDays(String(d))}>{termLabel(d)}</Button>
          ))}
          <Input className="w-24" inputMode="numeric" aria-label={__uiText('จำนวนวัน')} value={days} onChange={(e) => setDays(e.target.value)} />
          <Button size="sm" variant="primary" disabled={!valid || value === current || busy} onClick={save}>{busy ? '…' : __uiText('บันทึก')}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setDays(null); setErr(''); }}>{__uiText('ยกเลิก')}</Button>
        </>
      ))}
      <ErrorText error={err || (days !== null && !valid ? __uiText('ใส่จำนวนวัน 0–365') : null)} />
    </div>
  );
}

function CompanyPrices({ companyId, branches }: { companyId: string; branches: JoshRow[] }) {
  const prices = useAsync(async () => {
    const [company, ...perBranch] = await Promise.all([
      staffPricesApi.list({ kind: 'customer', scopeId: companyId, page: 1 }),
      ...branches.map((b) => staffPricesApi.list({ kind: 'contract', scopeId: b.id, page: 1 })),
    ]);
    const rows = [company, ...perBranch].flatMap((r) => r.items);
    const total = [company, ...perBranch].reduce((n, r) => n + r.total, 0);
    return { rows, total };
  }, [companyId, branches.map((b) => b.id).join(',')]);
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? '—';
  const data = prices.data;

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{__uiText('ราคาเฉพาะบริษัทและราคาสัญญาสาขา')}{data ? ` (${data.total})` : ''}</span>
        <Link className="text-xs text-primary hover:underline" to="/prices/staff">{__uiText('จัดการราคา')}</Link>
      </div>
      <ErrorText error={prices.error} />
      {prices.loading && !data ? <Loading /> : !data?.rows.length ? <Empty>{__uiText('ยังไม่มีราคาเฉพาะของบริษัทนี้')}</Empty> : (
        <Table>
          <THead>
            <TH>{__uiText('สินค้า')}</TH><TH>{__uiText('ใช้กับ')}</TH><TH kind="money">{__uiText('ราคา')}</TH><TH>{__uiText('ช่วงวันที่')}</TH><TH>{__uiText('สถานะ')}</TH>
          </THead>
          <TBody>
            {data.rows.map((p: StaffPriceRow) => (
              <TR key={p.id}>
                <TD kind="code">{p.sku ?? p.productInventoryId.slice(0, 8)}</TD>
                <TD>{p.kind === 'customer' ? __uiText('ทั้งบริษัท') : __uiText('สาขา {0}', { 0: branchName(p.branchId) })}</TD>
                <TD kind="money">{fmt.baht(p.price)}</TD>
                <TD kind="time">{p.startDate}{' – '}{p.endDate ?? __uiText('ไม่มีกำหนด')}</TD>
                <TD><StatusChip status={p.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {data && data.total > data.rows.length && (
        <p className="mt-1 text-xs text-on-surface-variant">{__uiText('แสดง {0} จาก {1} รายการ ดูทั้งหมดที่หน้าจัดการราคา', { 0: data.rows.length, 1: data.total })}</p>
      )}
    </div>
  );
}
