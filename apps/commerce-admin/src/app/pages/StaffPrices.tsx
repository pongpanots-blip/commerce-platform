// ui-metadata-migration: static labels and UI notices only
import { FormEvent, useState } from 'react';
import { Button, Chip, Empty, ErrorText, Field, FormPanel, Hint, Input, Loading, Page, PageHeader, Panel, PanelHead, SearchInput, Segmented, StatGrid, StatTile, Table, TBody, TD, TH, THead, TR, fmt } from '@cp/ui';
import { joshPriceApi, JoshRow, staffPricesApi, StaffPriceRow } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Kind = 'customer' | 'contract';
const KIND: Record<Kind, string> = { get customer(){return __uiText("ราคาลูกค้า (ต่อบริษัท)");}, get contract(){return __uiText("ราคาสัญญา (ต่อสาขา)");} };
const STATUS: Record<string, [string, 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'primary']> = {
  synced: ['ร้านค้าใช้แล้ว', 'ok'],
  pending: ['กำลังส่ง', 'warn'],
  failed: ['ส่งไม่สำเร็จ', 'danger'],
};

/**
 * Customer and branch contract prices owned by commerce. Saved here first, then josh writes its copy
 * with its own services (josh COMMERCE_OWNS_PRICES=true locks josh's own editing).
 */
export function StaffPrices() {
  __useUiLocale();
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
  const [syncFailed, setSyncFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const summary = useAsync(() => staffPricesApi.summary(), []);
  const branches = useAsync(() => (branchQ ? joshPriceApi.branches(branchQ) : Promise.resolve([] as JoshRow[])), [branchQ]);
  const scopeId = scope ? (kind === 'customer' ? scope.company_id : scope.branch_id) : undefined;
  const list = useAsync(() => staffPricesApi.list({ kind, scopeId, search, status, page }), [kind, scopeId, search, status, page]);
  const count = (k: string, st: string) => summary.data?.rows.find((r) => r.kind === k && r.status === st)?.n ?? 0;
  const reload = () => { summary.reload(); list.reload(); };

  async function run(label: string | ((r: never) => string), fn: () => Promise<unknown>) {
    setBusy(true); setMsg(''); setSyncFailed(false);
    try {
      const r = await fn() as Partial<StaffPriceRow> | undefined;
      setSyncFailed(r?.status === 'failed');
      setMsg(r?.status === 'failed' ? __uiMessage("บันทึกแล้ว แต่ร้านค้ายังไม่รับราคานี้: {0}", {"0": r.syncError}) : typeof label === 'function' ? label(r as never) : label);
      setForm({}); setEditing(null); setAdding(false); reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  function save() {
    const body = { price: Number(form.price), startDate: form.startDate || undefined, endDate: form.endDate || null, ...(kind === 'contract' ? { contractRef: form.contractRef || undefined } : {}) };
    if (editing) return run('แก้ไขแล้ว และร้านค้าใช้ราคานี้แล้ว', () => staffPricesApi.update(editing, body));
    if (!scope) { setMsg(kind === 'customer' ? __uiMessage("เลือกบริษัทก่อน (ค้นหาสาขาแล้วกดเลือก)") : __uiMessage("เลือกสาขาก่อน")); return; }
    return run('เพิ่มแล้ว และร้านค้าใช้ราคานี้แล้ว', () => staffPricesApi.create({ kind, ...(kind === 'customer' ? { companyId: scope.company_id } : { branchId: scope.branch_id }), sku: form.sku, ...body }));
  }

  return (
    <Page>
      <PageHeader
        title={__uiText("ราคาเฉพาะลูกค้าและราคาสัญญา")}
        subtitle={__uiText("ราคาที่บันทึกที่นี่จะส่งไปใช้บนร้านค้าทันที ราคาที่ร้านค้าสร้างเอง เช่น ใบเสนอราคาหรือคำขอราคาจากลูกค้า ให้กดดึงราคาจากร้านค้า")}
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => run((r: { added: number; changedInJosh: number; removedInJosh: number }) => __uiMessage("ดึงราคาจากร้านค้าแล้ว: ใหม่ {0} · ร้านค้าแก้ {1} · ร้านค้าลบ {2}", { 0: r.added, 1: r.changedInJosh, 2: r.removedInJosh }), staffPricesApi.importFromJosh)}>{__uiText("ดึงราคาจากร้านค้า")}</Button>
            <Button icon="refresh" onClick={reload}>{__uiText("รีเฟรช")}</Button>
            <Button variant="primary" icon="add" onClick={() => { setEditing(null); setForm({}); setAdding(true); }}>{__uiText("เพิ่มราคา")}</Button>
          </>
        }
      />

      {msg && <Hint>{(typeof msg === 'string' ? __uiText(msg) : msg)}</Hint>}
      <ErrorText error={list.error || summary.error} />

      <StatGrid cols={2}>
        {(Object.keys(KIND) as Kind[]).map((k) => (
          <StatTile
            key={k}
            label={KIND[k]}
            value={fmt.num(count(k, 'synced') + count(k, 'pending') + count(k, 'failed'))}
            foot={__uiText("ส่งไม่สำเร็จ {0} · กำลังส่ง {1}",{'0':count(k, 'failed'),'1':count(k, 'pending')})}
            onClick={() => { setKind(k); setPage(1); setEditing(null); }}
            selected={kind === k}
          />
        ))}
      </StatGrid>

      <Panel>
        <PanelHead title={kind === 'customer' ? __uiText("บริษัท") : __uiText("สาขา")} />
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <SearchInput
              value={branchSearch}
              onChange={(e) => setBranchSearch(e.target.value)}
              placeholder={__uiText("ค้นจากชื่อบริษัท / สาขา / รหัสลูกค้า")}
            />
            <Button onClick={() => setBranchQ(branchSearch.trim())}>{__uiText("ค้นหา")}</Button>
          </div>

          {scope && (
            <div className="flex items-center gap-2">
              <Chip>
                {kind === 'customer' ? scope.company_name : `${scope.company_name} › ${scope.branch_name}`}
              </Chip>
              <Button size="sm" variant="ghost" onClick={() => setScope(null)}>{__uiText("ล้าง")}</Button>
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

      {editing || adding ? (
        <FormPanel
          title={editing ? __uiText("แก้ไขราคา") : __uiText("เพิ่ม{0}", {"0": KIND[kind]})}
          icon={editing ? 'edit' : 'add_circle'}
          cols={kind === 'contract' ? 4 : 3}
          error={msg && syncFailed ? msg : undefined}
          busy={busy}
          onSubmit={save}
          onCancel={() => { setEditing(null); setAdding(false); setForm({}); }}
          submitLabel={editing ? __uiText("บันทึก") : __uiText("เพิ่ม")}
        >
          {!editing && (
            <Field label={__uiText("รหัสสินค้า")}>
              <Input required value={form.sku ?? ''} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </Field>
          )}
          <Field label={__uiText("ราคา (บาท)")}>
            <Input required type="number" min={0} step="0.01" value={form.price ?? ''} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </Field>
          <Field label={__uiText("วันเริ่ม")}>
            <Input type="date" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label={__uiText("วันสิ้นสุด")}>
            <Input type="date" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </Field>
          {kind === 'contract' && (
            <Field label={__uiText("เลขสัญญา")}>
              <Input value={form.contractRef ?? ''} onChange={(e) => setForm({ ...form, contractRef: e.target.value })} />
            </Field>
          )}
        </FormPanel>
      ) : null}

      <Panel className="overflow-hidden">
        <PanelHead title={__uiText("รายการ")} />
        <div className="px-4 py-3 border-b border-secondary-container flex flex-wrap items-center gap-3">
          <SearchInput
            placeholder={__uiText("ค้นหารหัสสินค้า")}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <Segmented
            options={[
              { value: '', label: __uiText("ทั้งหมด") },
              { value: 'failed', label: __uiText("ส่งไม่สำเร็จ"), count: count('customer', 'failed') + count('contract', 'failed') },
              { value: 'pending', label: __uiText("กำลังส่ง"), count: count('customer', 'pending') + count('contract', 'pending') },
              { value: 'synced', label: __uiText("ร้านค้าใช้แล้ว") },
            ]}
            value={status}
            onChange={(s) => { setStatus(s); setPage(1); }}
          />
        </div>

        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty>{__uiText("ยังไม่มีราคา กด \"ดึงราคาจากร้านค้า\" เพื่อนำราคาปัจจุบันเข้ามาครั้งแรก หรือกด \"เพิ่มราคา\"")}</Empty>
        ) : (
          <>
            <Table>
              <THead>
                <TH>{__uiText("รหัสสินค้า")}</TH>
                <TH right>{__uiText("ราคา")}</TH>
                <TH>{__uiText("ช่วงเวลา")}</TH>
                {kind === 'contract' && <TH>{__uiText("เลขสัญญา")}</TH>}
                <TH>{__uiText("สถานะ")}</TH>
                <TH>{__uiText("แก้ล่าสุด")}</TH>
                <TH></TH>
              </THead>
              <TBody>
                {list.data.items.map((r) => (
                  <TR key={r.id}>
                    <TD kind="mono">{r.sku ?? r.productInventoryId}</TD>
                    <TD kind="money">{fmt.baht(r.price)}</TD>
                    <TD className="text-xs">{r.startDate} – {r.endDate ?? __uiText("ไม่มีกำหนด")}</TD>
                    {kind === 'contract' && <TD className="text-xs">{r.contractRef ?? '—'}</TD>}
                    <TD>
                      <Chip tone={STATUS[r.status]?.[1] ?? 'muted'} statusCode={r.status} dot>{STATUS[r.status] ? __uiText(STATUS[r.status][0]) : r.status}</Chip>
                      {r.syncError && <div className="text-[10px] text-error mt-1">{r.syncError}</div>}
                    </TD>
                    <TD className="text-xs">
                      {r.updatedBy ?? '—'}
                      <div className="text-on-surface-variant">{fmt.when(r.updatedAt)}</div>
                    </TD>
                    <TD kind="actions" className="space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setEditing(r.id); setForm({ price: String(r.price), startDate: r.startDate, endDate: r.endDate ?? '', contractRef: r.contractRef ?? '' }); }}>{__uiText("แก้ไข")}</Button>
                      {r.status !== 'synced' && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('ส่งซ้ำแล้ว', () => staffPricesApi.retry(r.id))}>{__uiText("ส่งซ้ำ")}</Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger-ghost"
                        disabled={busy}
                        onClick={() => window.confirm(__uiText("ลบราคา {0} {1}? ร้านค้าจะเลิกใช้ราคานี้ทันที", {"0": r.sku, "1": fmt.baht(r.price)})) && run('ลบแล้ว', () => staffPricesApi.remove(r.id))}
                      >
                        {__uiText("ลบ")}</Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {list.data.total > list.data.limit && (
              <div className="flex items-center justify-center gap-3 py-3 border-t border-secondary-container">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{__uiText("ก่อนหน้า")}</Button>
                <Hint>{__uiText("หน้า ")}{page} / {Math.ceil(list.data.total / list.data.limit)}</Hint>
                <Button size="sm" variant="secondary" disabled={page >= Math.ceil(list.data.total / list.data.limit)} onClick={() => setPage(page + 1)}>{__uiText("ถัดไป")}</Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </Page>
  );
}
