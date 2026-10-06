import { FormEvent, Fragment, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button, Chip, Empty, ErrorText, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, Pager, Select, Span, StatGrid, StatTile, Textarea,
  TBody, TD, TH, THead, TR, Table, fmt, RowLink } from '@cp/ui';
import { joshActionsApi, joshProductApi, JoshProductDetail, ProductIssueKey } from '../../lib/api';
import { useAsync } from '../hooks';

const ISSUES: [ProductIssueKey, string][] = [
  ['pending_approval', 'รออนุมัติข้อมูลจาก ERP'], ['no_image', 'ไม่มีรูป'], ['no_category', 'ไม่มีหมวด'],
  ['no_price', 'ไม่มีราคาขาย'], ['out_of_stock', 'หมด'], ['low_stock', 'ใกล้หมด'],
];
const STATUS: Record<string, string> = { active: 'เปิดขาย', draft: 'draft (ยังไม่เปิด)', inactive: 'ปิด' };
const LIMIT = 50;
const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** josh's product catalog from josh's replica. ERP approval and master-data edits go through josh's own services; images stay in josh admin. */
export function JoshProducts() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const summary = useAsync(() => joshProductApi.summary(), []);
  const categories = useAsync(() => joshProductApi.categories(), []);
  const [draft, setDraft] = useState({ search: '', status: '', categoryId: '', orderTaking: '' });
  const [f, setF] = useState({ ...draft, issue: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(LIMIT);
  const list = useAsync(() => joshProductApi.list({ ...f, page, limit: pageSize }), [f, page, pageSize]);
  const s = summary.data;
  const pickIssue = (issue: string) => { setPage(1); setF({ ...f, issue: f.issue === issue ? '' : issue }); };
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const togglePick = (id: string) => { const next = new Set(picked); if (next.has(id)) next.delete(id); else next.add(id); setPicked(next); };

  async function decide(action: 'approve' | 'reject', ids: string[]) {
    const verb = action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ';
    if (!ids.length || !window.confirm(`${verb}ข้อมูลจาก ERP ของสินค้า ${ids.length} รายการ?\n\n${action === 'approve' ? 'สินค้า draft จะขึ้นขาย และค่าที่ ERP ส่งมาจะใช้ทันที' : 'ค่าที่ ERP ส่งมาจะถูกทิ้ง สินค้าคงค่าเดิม'} (josh ทำในชื่อบัญชี josh ที่อีเมลตรงกับคุณ)`)) return;
    setBusy(true); setMsg('');
    try {
      const r = action === 'approve' ? await joshActionsApi.approveProducts(ids) : await joshActionsApi.rejectProducts(ids);
      setMsg(`${verb}แล้ว: ${JSON.stringify(r)}`); setPicked(new Set()); summary.reload(); list.reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const pending = (p: { product_status: string; erp_pending_at: string | null }) => p.product_status === 'draft' || !!p.erp_pending_at;

  return (
    <Page>
      <PageHeader
        title="สินค้า (josh)"
        subtitle="แค็ตตาล็อกหน้าร้าน อ่านจาก replica ของ josh · อนุมัติ / ไม่อนุมัติข้อมูลจาก ERP ทำที่นี่ได้ (josh เป็นคนบันทึก) · แก้ไขอื่นๆ / ใส่รูป ยังทำที่ josh admin"
        actions={<Button icon="refresh" onClick={() => { summary.reload(); list.reload(); }}>Refresh</Button>}
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={summary.error || list.error} />
      {msg && <div className="px-4 py-2 text-xs text-on-surface-variant bg-surface-container-low">{msg}</div>}

      {s && (
        <div>
          <StatGrid cols={2}>
            <StatTile
              label="สินค้าทั้งหมด"
              value={fmt.num(s.total)}
              foot={s.byStatus.map((b) => `${STATUS[b.status] ?? b.status} ${b.n}`).join(' · ')}
            />
            {ISSUES.map(([k, label]) => (
              <StatTile
                key={k}
                accent={s[k as ProductIssueKey] > 0}
                tone={s[k as ProductIssueKey] > 0 ? 'warn' : 'ok'}
                icon={s[k as ProductIssueKey] > 0 ? 'warning' : 'check_circle'}
                label={label}
                value={fmt.num(s[k as ProductIssueKey])}
                selected={f.issue === k}
                onClick={() => pickIssue(k)}
              />
            ))}
          </StatGrid>
        </div>
      )}

      <Panel className="overflow-hidden">
        <form className="flex flex-wrap items-end gap-3 p-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setPage(1); setF({ ...draft, issue: f.issue }); }}>
          <Field label="ค้นหา" className="flex-1 min-w-48">
            <Input value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} placeholder="SKU หรือชื่อสินค้า" />
          </Field>
          <Field label="สถานะ">
            <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">ทั้งหมด</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="หมวด">
            <Select value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
              <option value="">ทั้งหมด</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.category_path ?? c.category_name_th}</option>)}
            </Select>
          </Field>
          <Field label="แบบสั่งจอง (order taking)">
            <Select value={draft.orderTaking} onChange={(e) => setDraft({ ...draft, orderTaking: e.target.value })}>
              <option value="">ทั้งหมด</option>
              <option value="Y">ใช่</option>
              <option value="N">ไม่ใช่</option>
            </Select>
          </Field>
          <Button type="submit">ค้นหา</Button>
        </form>
        {f.issue && (
          <div className="px-4 py-2 text-xs text-on-surface-variant border-t border-secondary-container flex items-center gap-2">
            <span>กรอง: {ISSUES.find(([k]) => k === f.issue)?.[1]}</span>
            <Button size="sm" variant="ghost" onClick={() => pickIssue(f.issue)}>ล้าง</Button>
          </div>
        )}
      </Panel>

      {list.loading && !list.data ? (
        <Loading />
      ) : list.data ? (
        <>
          <div className="flex items-center gap-4 px-4 py-3 text-xs text-on-surface-variant">
            <span>{fmt.num(list.data.total)} รายการ</span>
            {picked.size > 0 && (
              <>
                <Button size="sm" disabled={busy} onClick={() => decide('approve', [...picked])}>อนุมัติที่เลือก ({picked.size})</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('reject', [...picked])}>ไม่อนุมัติที่เลือก</Button>
              </>
            )}
          </div>

          <Panel className="overflow-hidden">
            {list.data.items.length ? (
              <Table>
                <THead>
                    <TH></TH>
                    <TH></TH>
                    <TH>SKU</TH>
                    <TH>สินค้า</TH>
                    <TH>หมวด</TH>
                    <TH>ราคาขาย</TH>
                    <TH>สต็อก</TH>
                    <TH>สถานะ</TH>
                    <TH />
                  </THead>
                <TBody>
                  {list.data.items.map((p) => (
                    <TR key={p.product_inventory_id} onClick={() => !pending(p) && navigate(`/reports/products/${p.product_inventory_id}`, { state: { from: '/reports/products', search: `?${searchParams.toString()}` } })}>
                      <TD>
                        {pending(p) && (
                          <div onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`เลือก ${p.product_inventory_sku}`}
                              checked={picked.has(p.product_inventory_id)}
                              onChange={() => togglePick(p.product_inventory_id)}
                            />
                          </div>
                        )}
                      </TD>
                      <TD className="w-16">
                        {p.image_url ? (
                          <img src={p.image_url} alt="" width={40} height={40} className="object-cover rounded bg-surface-container-low" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                        ) : (
                          <Chip tone="warn">ไม่มีรูป</Chip>
                        )}
                      </TD>
                      <TD kind="code"><RowLink to={`/reports/products/${p.product_inventory_id}`} state={{ from: '/reports/products', search: `?${searchParams.toString()}` }}>{p.product_inventory_sku}</RowLink></TD>
                      <TD>
                        {p.name_th ?? p.name_en ?? '—'}
                        <div className="text-[11px] text-on-surface-variant">{[p.brand_name, p.pack_size, p.selling_unit].filter(Boolean).join(' · ')}</div>
                      </TD>
                      <TD>{p.category_name_th ?? <Chip tone="warn">ไม่มีหมวด</Chip>}</TD>
                      <TD kind="money">
                        {p.selling_unit_price ? fmt.baht(p.selling_unit_price) : <Chip tone="danger">ไม่มีราคา</Chip>}
                      </TD>
                      <TD>
                        {p.order_taking_flag === 'Y' ? <Chip>สั่งจอง</Chip> : p.product_inventory_quantity ?? '—'}
                      </TD>
                      <TD>
                        <Chip tone={p.product_status === 'active' ? 'ok' : 'muted'}>{STATUS[p.product_status] ?? p.product_status}</Chip>
                        {p.erp_pending_at && (
                          <div className="mt-1">
                            <Chip tone="warn">ERP รออนุมัติ ({p.erp_pending_source})</Chip>
                          </div>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty>ไม่พบสินค้า</Empty>
            )}
          </Panel>

          <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} />
        </>
      ) : null}
    </Page>
  );
}

