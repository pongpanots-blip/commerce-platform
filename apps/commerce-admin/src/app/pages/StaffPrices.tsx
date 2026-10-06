import { FormEvent, useState } from 'react';
import { Button, Chip, Empty, ErrorText, Field, FormPanel, Hint, Input, Loading, Page, PageHeader, Panel, PanelHead, SearchInput, Segmented, StatGrid, StatTile, StatusChip, Table, TBody, TD, TH, THead, TR, fmt } from '@cp/ui';
import { joshPriceApi, JoshRow, staffPricesApi, StaffPriceRow } from '../../lib/api';
import { useAsync } from '../hooks';

type Kind = 'customer' | 'contract';
const KIND: Record<Kind, string> = { customer: 'ราคาลูกค้า (ต่อบริษัท)', contract: 'ราคาสัญญา (ต่อสาขา)' };
const STATUS: Record<string, [string, 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'primary']> = {
  synced: ['josh ใช้แล้ว', 'ok'],
  pending: ['กำลังส่ง', 'warn'],
  failed: ['ส่งไม่สำเร็จ', 'danger'],
};

/**
 * Customer and branch contract prices owned by commerce. Saved here first, then josh writes its copy
 * with its own services (josh COMMERCE_OWNS_PRICES=true locks josh's own editing).
 */
export function StaffPrices() {
  const [kind, setKind] = useState<Kind>('customer');
  const [scope, setScope] = useState<JoshRow | null>(null);
  const [branchSearch, setBranchSearch] = useState('');
  const [branchQ, setBranchQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const summary = useAsync(() => staffPricesApi.summary(), []);
  const branches = useAsync(() => (branchQ ? joshPriceApi.branches(branchQ) : Promise.resolve([] as JoshRow[])), [branchQ]);
  const scopeId = scope ? (kind === 'customer' ? scope.company_id : scope.branch_id) : undefined;
  const list = useAsync(() => staffPricesApi.list({ kind, scopeId, search, status, page }), [kind, scopeId, search, status, page]);
  const count = (k: string, st: string) => summary.data?.rows.find((r) => r.kind === k && r.status === st)?.n ?? 0;
  const reload = () => { summary.reload(); list.reload(); };

  async function run(label: string | ((r: never) => string), fn: () => Promise<unknown>) {
    setBusy(true); setMsg('');
    try {
      const r = await fn() as Partial<StaffPriceRow> | undefined;
      setMsg(r?.status === 'failed' ? `บันทึกใน commerce แล้ว แต่ josh ยังไม่รับ: ${r.syncError}` : typeof label === 'function' ? label(r as never) : label);
      setForm({}); setEditing(null); reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  function save() {
    const body = { price: Number(form.price), startDate: form.startDate || undefined, endDate: form.endDate || null, ...(kind === 'contract' ? { contractRef: form.contractRef || undefined } : {}) };
    if (editing) return run('แก้ไขแล้ว และ josh ใช้ราคานี้แล้ว', () => staffPricesApi.update(editing, body));
    if (!scope) { setMsg(kind === 'customer' ? 'เลือกบริษัทก่อน (ค้นหาสาขาแล้วกดเลือก)' : 'เลือกสาขาก่อน'); return; }
    return run('เพิ่มแล้ว และ josh ใช้ราคานี้แล้ว', () => staffPricesApi.create({ kind, ...(kind === 'customer' ? { companyId: scope.company_id } : { branchId: scope.branch_id }), sku: form.sku, ...body }));
  }

  return (
    <Page>
      <PageHeader
        title="ราคาลูกค้า / ราคาสัญญา"
        subtitle="commerce เป็นที่เก็บหลัก · ทุกการแก้ไขจะส่งให้ josh บันทึกผ่านโค้ดของ josh และล้าง cache ราคาให้ · ราคาที่ josh สร้างเอง (ใบเสนอราคาจาก ERP, คำขอราคาจาก CS) จะถูกดึงเข้ามาด้วยปุ่มดึงจาก josh"
        actions={
          <>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run((r: { added: number; changedInJosh: number; removedInJosh: number }) => `ดึงจาก josh: ใหม่ ${r.added} · josh แก้ ${r.changedInJosh} · josh ลบ ${r.removedInJosh}`, staffPricesApi.importFromJosh)}>ดึงจาก josh</Button>
            <Button icon="refresh" onClick={reload}>Refresh</Button>
          </>
        }
      />

      {msg && <Hint>{msg}</Hint>}
      <ErrorText error={list.error || summary.error} />

      <StatGrid cols={2}>
        {(Object.keys(KIND) as Kind[]).map((k) => (
          <StatTile
            key={k}
            label={KIND[k]}
            value={fmt.num(count(k, 'synced') + count(k, 'pending') + count(k, 'failed'))}
            foot={`ส่งไม่สำเร็จ ${count(k, 'failed')} · กำลังส่ง ${count(k, 'pending')}`}
            onClick={() => { setKind(k); setPage(1); setEditing(null); }}
            selected={kind === k}
          />
        ))}
      </StatGrid>

      <Panel>
        <PanelHead title={kind === 'customer' ? 'บริษัท' : 'สาขา'} />
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <SearchInput
              value={branchSearch}
              onChange={(e) => setBranchSearch(e.target.value)}
              placeholder={`ค้นจากชื่อบริษัท / สาขา / รหัสลูกค้า`}
            />
            <Button onClick={() => setBranchQ(branchSearch.trim())}>ค้นหา</Button>
          </div>

          {scope && (
            <div className="flex items-center gap-2">
              <Chip>
                {kind === 'customer' ? scope.company_name : `${scope.company_name} › ${scope.branch_name}`}
              </Chip>
              <Button size="sm" variant="ghost" onClick={() => setScope(null)}>ล้าง</Button>
            </div>
          )}

          {!!branches.data?.length && !scope && (
            <div className="flex flex-wrap gap-2">
              {branches.data.slice(0, 30).map((b) => (
                <Button
                  key={b.branch_id}
                  size="sm"
                  variant="secondary"
                  onClick={() => { setScope(b); setPage(1); }}
                >
                  {b.company_name} › {b.branch_name}
                </Button>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {editing || !list.loading ? (
        <FormPanel
          title={editing ? 'แก้ไขราคา' : `เพิ่ม${KIND[kind]}`}
          icon={editing ? 'edit' : 'add_circle'}
          cols={kind === 'contract' ? 4 : 3}
          error={msg && msg.includes('commerce') ? msg : undefined}
          busy={busy}
          onSubmit={save}
          onCancel={editing ? () => { setEditing(null); setForm({}); } : undefined}
          submitLabel={editing ? 'บันทึก' : 'เพิ่ม'}
        >
          {!editing && (
            <Field label="SKU">
              <Input required value={form.sku ?? ''} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </Field>
          )}
          <Field label="ราคา (บาท)">
            <Input required type="number" min={0} step="0.01" value={form.price ?? ''} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </Field>
          <Field label="เริ่ม">
            <Input type="date" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label="สิ้นสุด">
            <Input type="date" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </Field>
          {kind === 'contract' && (
            <Field label="เลขสัญญา">
              <Input value={form.contractRef ?? ''} onChange={(e) => setForm({ ...form, contractRef: e.target.value })} />
            </Field>
          )}
        </FormPanel>
      ) : null}

      <Panel className="overflow-hidden">
        <PanelHead title="รายการ" />
        <div className="px-4 py-3 border-b border-secondary-container flex flex-wrap items-center gap-3">
          <SearchInput
            placeholder="ค้น SKU"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <Segmented
            options={[
              { value: '', label: 'ทั้งหมด' },
              { value: 'failed', label: 'ส่งไม่สำเร็จ', count: count('customer', 'failed') + count('contract', 'failed') },
              { value: 'pending', label: 'กำลังส่ง', count: count('customer', 'pending') + count('contract', 'pending') },
              { value: 'synced', label: 'josh ใช้แล้ว' },
            ]}
            value={status}
            onChange={(s) => { setStatus(s); setPage(1); }}
          />
        </div>

        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty>ยังไม่มีราคา · กด "ดึงจาก josh" เพื่อนำราคาปัจจุบันของ josh เข้ามาครั้งแรก</Empty>
        ) : (
          <>
            <Table>
              <THead>
                <TH>SKU</TH>
                <TH right>ราคา</TH>
                <TH>ช่วงเวลา</TH>
                {kind === 'contract' && <TH>เลขสัญญา</TH>}
                <TH>สถานะ</TH>
                <TH>แก้ล่าสุด</TH>
                <TH></TH>
              </THead>
              <TBody>
                {list.data.items.map((r) => (
                  <TR key={r.id}>
                    <TD kind="mono">{r.sku ?? r.productInventoryId}</TD>
                    <TD kind="money">{fmt.baht(r.price)}</TD>
                    <TD className="text-xs">{r.startDate} – {r.endDate ?? 'ไม่มีกำหนด'}</TD>
                    {kind === 'contract' && <TD className="text-xs">{r.contractRef ?? '—'}</TD>}
                    <TD>
                      <StatusChip status={STATUS[r.status]?.[0] ?? r.status} />
                      {r.syncError && <div className="text-[10px] text-error mt-1">{r.syncError}</div>}
                    </TD>
                    <TD className="text-xs">
                      {r.updatedBy ?? '—'}
                      <div className="text-on-surface-variant">{fmt.when(r.updatedAt)}</div>
                    </TD>
                    <TD kind="actions" className="space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(r.id); setForm({ price: String(r.price), startDate: r.startDate, endDate: r.endDate ?? '', contractRef: r.contractRef ?? '' }); }}>แก้</Button>
                      {r.status !== 'synced' && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('ส่งซ้ำแล้ว', () => staffPricesApi.retry(r.id))}>ส่งซ้ำ</Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger-ghost"
                        disabled={busy}
                        onClick={() => window.confirm(`ลบราคา ${r.sku} ${fmt.baht(r.price)}? josh จะเลิกใช้ราคานี้ทันที`) && run('ลบแล้ว', () => staffPricesApi.remove(r.id))}
                      >
                        ลบ
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {list.data.total > list.data.limit && (
              <div className="flex items-center justify-center gap-3 py-3 border-t border-secondary-container">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</Button>
                <Hint>หน้า {page} / {Math.ceil(list.data.total / list.data.limit)}</Hint>
                <Button size="sm" variant="secondary" disabled={page >= Math.ceil(list.data.total / list.data.limit)} onClick={() => setPage(page + 1)}>ถัดไป</Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </Page>
  );
}
