// ui-metadata-migration: static labels and UI notices only
import { FormEvent, Fragment, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, Button, Chip, Empty, ErrorText, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, Pager, Select, Span, StatGrid, StatTile, Textarea,
  TBody, TD, TH, THead, TR, Table, fmt, RowLink } from '@cp/ui';
import { joshActionsApi, joshProductApi, JoshProductDetail, ProductIssueKey } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const ISSUES: [ProductIssueKey, string][] = [
  ['pending_approval', 'รออนุมัติข้อมูลจากระบบขาย (ERP)'], ['no_image', 'ไม่มีรูป'], ['no_category', 'ไม่มีหมวด'],
  ['no_price', 'ไม่มีราคาขาย'], ['out_of_stock', 'สินค้าหมด'], ['low_stock', 'ใกล้หมด'],
];
const STATUS: Record<string, string> = { active: 'เปิดขาย', draft: 'ฉบับร่าง (ยังไม่เปิดขาย)', inactive: 'ปิดขาย' };
const statusText = (s: string) => (STATUS[s] ? __uiText(STATUS[s]) : s);
const LIMIT = 50;
const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** josh's product catalog from josh's replica. ERP approval and master-data edits go through josh's own services; images stay in josh admin. */
export function JoshProducts() {
  __useUiLocale();
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
    if (!ids.length || !window.confirm(__uiText("{0}ข้อมูลจากระบบขาย (ERP) ของสินค้า {1} รายการ?\n\n{2} (ร้านค้าออนไลน์บันทึกในนามของคุณ และเก็บอีเมลของคุณไว้ในประวัติการแก้ไข)", {"0": __uiText(verb), "1": ids.length, "2": __uiText(action === 'approve' ? 'สินค้าฉบับร่างจะเปิดขาย และใช้ค่าที่ระบบขายส่งมาทันที' : 'ไม่ใช้ค่าที่ระบบขายส่งมา สินค้าคงค่าเดิม')}))) return;
    setBusy(true); setMsg('');
    try {
      const r = action === 'approve' ? await joshActionsApi.approveProducts(ids) : await joshActionsApi.rejectProducts(ids);
      setMsg(__uiMessage("{0}แล้ว: {1}", {"0": verb, "1": JSON.stringify(r)})); setPicked(new Set()); summary.reload(); list.reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const pending = (p: { product_status: string; erp_pending_at: string | null }) => p.product_status === 'draft' || !!p.erp_pending_at;

  return (
    <Page>
      <PageHeader
        title={__uiText("รายงานสินค้า")}
        subtitle={__uiText("สินค้าบนร้านค้าออนไลน์ ราคา สต็อก และสถานะ · อนุมัติข้อมูลที่ระบบขาย (ERP) ส่งมาได้ที่นี่ ส่วนการแก้ข้อมูลอื่นและรูปทำที่หน้าสินค้าบนร้านค้า")}
        actions={<Button icon="refresh" onClick={() => { summary.reload(); list.reload(); }}>{__uiText("โหลดใหม่")}</Button>}
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={summary.error || list.error} />
      {msg && <Alert tone="info" onClose={() => setMsg('')}>{__uiText(msg)}</Alert>}

      {s && (
        <div>
          <StatGrid cols={2}>
            <StatTile
              label={__uiText("สินค้าทั้งหมด")}
              value={fmt.num(s.total)}
              foot={s.byStatus.map((b) => `${statusText(b.status)} ${fmt.num(b.n)}`).join(' · ')}
            />
            {ISSUES.map(([k, label]) => (
              <StatTile
                key={k}
                accent={s[k as ProductIssueKey] > 0}
                tone={s[k as ProductIssueKey] > 0 ? 'warn' : 'ok'}
                icon={s[k as ProductIssueKey] > 0 ? 'warning' : 'check_circle'}
                label={__uiText(label)}
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
          <Field label={__uiText("ค้นหา")} className="flex-1 min-w-48">
            <Input value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} placeholder={__uiText("รหัสหรือชื่อสินค้า")} />
          </Field>
          <Field label={__uiText("สถานะ")}>
            <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">{__uiText("ทั้งหมด")}</option>
              {Object.keys(STATUS).map((k) => <option key={k} value={k}>{statusText(k)}</option>)}
            </Select>
          </Field>
          <Field label={__uiText("หมวด")}>
            <Select value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
              <option value="">{__uiText("ทั้งหมด")}</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.category_path ?? c.category_name_th}</option>)}
            </Select>
          </Field>
          <Field label={__uiText("สินค้าสั่งจอง")}>
            <Select value={draft.orderTaking} onChange={(e) => setDraft({ ...draft, orderTaking: e.target.value })}>
              <option value="">{__uiText("ทั้งหมด")}</option>
              <option value="Y">{__uiText("ใช่")}</option>
              <option value="N">{__uiText("ไม่ใช่")}</option>
            </Select>
          </Field>
          <Button type="submit">{__uiText("ค้นหา")}</Button>
        </form>
        {f.issue && (
          <div className="px-4 py-2 text-xs text-on-surface-variant border-t border-secondary-container flex items-center gap-2">
            <span>{__uiText("กรอง: ")}{__uiText(ISSUES.find(([k]) => k === f.issue)?.[1] ?? f.issue)}</span>
            <Button size="sm" variant="ghost" onClick={() => pickIssue(f.issue)}>{__uiText("ล้าง")}</Button>
          </div>
        )}
      </Panel>

      {list.loading && !list.data ? (
        <Loading />
      ) : list.data ? (
        <>
          <div className="flex items-center gap-4 px-4 py-3 text-xs text-on-surface-variant">
            <span>{fmt.num(list.data.total)} {__uiText(" รายการ")}</span>
            {picked.size > 0 && (
              <>
                <Button size="sm" disabled={busy} onClick={() => decide('approve', [...picked])}>{__uiText("อนุมัติที่เลือก ({0})", { 0: picked.size })}</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('reject', [...picked])}>{__uiText("ไม่อนุมัติที่เลือก")}</Button>
              </>
            )}
          </div>

          <Panel className="overflow-hidden">
            {list.data.items.length ? (
              <Table>
                <THead>
                    <TH></TH>
                    <TH></TH>
                    <TH>{__uiText("รหัสสินค้า")}</TH>
                    <TH>{__uiText("สินค้า")}</TH>
                    <TH>{__uiText("หมวด")}</TH>
                    <TH kind="money">{__uiText("ราคาขาย")}</TH>
                    <TH kind="num">{__uiText("สต็อก")}</TH>
                    <TH>{__uiText("สถานะ")}</TH>
                  </THead>
                <TBody>
                  {list.data.items.map((p) => (
                    <TR key={p.product_inventory_id} onClick={() => !pending(p) && navigate(`/reports/products/${p.product_inventory_id}`, { state: { from: '/reports/products', search: `?${searchParams.toString()}` } })}>
                      <TD>
                        {pending(p) && (
                          <div onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={__uiText("เลือก {0}", {"0": p.product_inventory_sku})}
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
                          <Chip tone="warn">{__uiText("ไม่มีรูป")}</Chip>
                        )}
                      </TD>
                      <TD kind="code"><RowLink to={`/reports/products/${p.product_inventory_id}`} state={{ from: '/reports/products', search: `?${searchParams.toString()}` }}>{p.product_inventory_sku}</RowLink></TD>
                      <TD>
                        {p.name_th ?? p.name_en ?? '—'}
                        <div className="text-[11px] text-on-surface-variant">{[p.brand_name, p.pack_size, p.selling_unit].filter(Boolean).join(' · ')}</div>
                      </TD>
                      <TD>{p.category_name_th ?? <Chip tone="warn">{__uiText("ไม่มีหมวด")}</Chip>}</TD>
                      <TD kind="money">
                        {p.selling_price ? fmt.baht(p.selling_price) : <Chip tone="danger">{__uiText("ไม่มีราคา")}</Chip>}
                      </TD>
                      <TD kind="num">
                        {p.order_taking_flag === 'Y' ? <Chip>{__uiText("สั่งจอง")}</Chip> : fmt.num(p.product_inventory_quantity)}
                      </TD>
                      <TD>
                        <Chip tone={p.product_status === 'active' ? 'ok' : 'muted'} dot>{statusText(p.product_status)}</Chip>
                        {p.erp_pending_at && (
                          <div className="mt-1">
                            <Chip tone="warn" dot>{__uiText("ข้อมูลจาก ERP รออนุมัติ")}{p.erp_pending_source ? ` (${p.erp_pending_source})` : ''}</Chip>
                          </div>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty>{__uiText("ไม่พบสินค้าตามตัวกรองนี้ ลองเปลี่ยนคำค้นหรือล้างตัวกรอง")}</Empty>
            )}
          </Panel>

          <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} />
        </>
      ) : null}
    </Page>
  );
}

