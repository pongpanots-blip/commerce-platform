import { useState } from 'react';
import {
  Alert, Button, CodeBlock, DetailSection, Empty, ErrorText, Field, FormPanel, Hint, Input, Loading, Page, PageHeader, Panel, PanelHead,
  SearchInput, Segmented, Select, StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { joshAdmin, joshCustomerApi, joshProductApi, JoshRow } from '../../lib/api';
import { useAsync } from '../hooks';

type Row = Record<string, unknown>;
/** josh answers lists as an array, `{ data }`, `{ data: { items } }` or `{ items }`. */
function rowsOf(answer: unknown): Row[] {
  const a = answer as { data?: unknown; items?: unknown } | unknown[] | null;
  if (Array.isArray(a)) return a as Row[];
  const d = a?.data as { items?: unknown; data?: unknown } | unknown[] | undefined;
  if (Array.isArray(d)) return d as Row[];
  if (Array.isArray(d?.items)) return d.items as Row[];
  if (Array.isArray(d?.data)) return d.data as Row[];
  if (Array.isArray(a?.items)) return a.items as Row[];
  return [];
}

const PAYMENT = [['credit', 'เครดิตเทอม'], ['qr', 'QR'], ['cod', 'เก็บปลายทาง'], ['payment_link', 'ลิงก์ชำระเงิน'], ['customer_credit', 'เครดิตลูกค้า']];
const SAMPLE_STATUS: Record<string, string> = { pending: 'รอพิจารณา', approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ', fulfilled: 'ส่งแล้ว' };
const show = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
type Tab = 'order' | 'samples' | 'merge';

/**
 * CS work that used to be in josh admin: order on behalf of a customer (josh quotes and places it
 * with its own checkout), sample requests, merging duplicate accounts. Everything runs as josh's own
 * CS-admin routes (josh COMMERCE_OWNS_CS_ORDERS / COMMERCE_OWNS_CUSTOMERS lock josh's own buttons).
 */
export function CsDesk() {
  const [tab, setTab] = useState<Tab>('order');
  return (
    <Page>
      <PageHeader title="งาน CS (josh)" subtitle="สั่งของแทนลูกค้า · คำขอสินค้าตัวอย่าง · รวมบัญชีซ้ำ — josh ทำจริงในนามของคุณ — josh บันทึกอีเมลคุณไว้ใน audit" />
      <div className="overflow-x-auto">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'order', label: 'สั่งของแทนลูกค้า' },
            { value: 'samples', label: 'คำขอสินค้าตัวอย่าง' },
            { value: 'merge', label: 'รวมบัญชี' },
          ]}
        />
      </div>
      {tab === 'order' ? <OrderOnBehalf /> : tab === 'samples' ? <Samples /> : <Merge />}
    </Page>
  );
}

/** Company → one of its users and branches (from josh's replica). */
function CustomerPick({ onPick }: { onPick: (p: { company: JoshRow; userId: string; branchId: string } | null) => void }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [userId, setUserId] = useState('');
  const [branchId, setBranchId] = useState('');
  const found = useAsync(() => (search ? joshCustomerApi.list({ search, page: 1, limit: 20 }) : Promise.resolve(null)), [search]);
  const detail = useAsync(() => (companyId ? joshCustomerApi.detail(companyId) : Promise.resolve(null)), [companyId]);
  const d = detail.data;
  const pick = (u: string, b: string) => { setUserId(u); setBranchId(b); onPick(d && u && b ? { company: d, userId: u, branchId: b } : null); };
  return (
    <DetailSection title="1 · ลูกค้า" icon="business">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <SearchInput className="flex-1" aria-label="ค้นหาบริษัท" placeholder="ชื่อบริษัท / รหัสลูกค้า ERP" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" icon="search">ค้นหา</Button>
      </form>
      {found.data && (
        <Field label="บริษัท">
          <Select value={companyId} onChange={(e) => { setCompanyId(e.target.value); pick('', ''); }}>
            <option value="">— เลือก —</option>
            {found.data.items.map((c) => <option key={c.id} value={c.id}>{c.name} {c.erp_customer_code ? `(${c.erp_customer_code})` : ''}</option>)}
          </Select>
        </Field>
      )}
      {d && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="ผู้ใช้">
            <Select value={userId} onChange={(e) => pick(e.target.value, branchId)}>
              <option value="">— เลือก —</option>
              {d.users.filter((u: JoshRow) => u.is_active).map((u: JoshRow) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name ?? ''} · {u.role}</option>)}
            </Select>
          </Field>
          <Field label="สาขาที่ส่ง">
            <Select value={branchId} onChange={(e) => pick(userId, e.target.value)}>
              <option value="">— เลือก —</option>
              {d.branches.map((b: JoshRow) => <option key={b.id} value={b.id}>{b.name}{b.is_default_delivery ? ' (หลัก)' : ''}</option>)}
            </Select>
          </Field>
          <Hint className="md:col-span-2">วงเงิน {fmt.baht(d.credit_limit)} · ใช้ไป {fmt.baht(d.credit_used)} · เครดิต {show(d.credit_term_days)} วัน</Hint>
        </div>
      )}
    </DetailSection>
  );
}

function OrderOnBehalf() {
  const [who, setWho] = useState<{ company: JoshRow; userId: string; branchId: string } | null>(null);
  const [items, setItems] = useState<{ id: string; sku: string; name: string; quantity: number }[]>([]);
  const [skuQ, setSkuQ] = useState('');
  const [skuSearch, setSkuSearch] = useState('');
  const [quote, setQuote] = useState<unknown>(null);
  const [pay, setPay] = useState({ payment_method: 'credit', coupon_code: '', delivery_date: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const products = useAsync(() => (skuSearch ? joshProductApi.list({ search: skuSearch, status: 'active', page: 1, limit: 10 }) : Promise.resolve(null)), [skuSearch]);
  const body = () => ({ user_id: who!.userId, branch_id: who!.branchId, items: items.map((i) => ({ product_inventory_id: i.id, quantity: i.quantity })) });

  async function run(fn: () => Promise<unknown>, after: (r: unknown) => void) {
    setBusy(true); setMsg(null);
    try { after(await fn()); } catch (e) { setMsg({ tone: 'danger', text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  }
  const getQuote = () => run(() => joshAdmin.call('POST', '/cs-admin/orders/quote', body()), (r) => setQuote(r));
  function place() {
    if (!window.confirm(`สั่ง ${items.length} รายการให้ ${who!.company.name} (${pay.payment_method})?\n\njosh จะสร้าง order จริงและส่งเข้า ERP ตามปกติ`)) return;
    run(() => joshAdmin.call('POST', '/cs-admin/orders/place-on-behalf', { ...body(), payment_method: pay.payment_method,
      ...(pay.coupon_code.trim() ? { coupon_code: pay.coupon_code.trim() } : {}), ...(pay.delivery_date ? { delivery_date: pay.delivery_date } : {}) }),
    (r) => { setMsg({ tone: 'ok', text: `สร้าง order แล้ว: ${JSON.stringify((r as { data?: unknown })?.data ?? r).slice(0, 200)}` }); setItems([]); setQuote(null); });
  }
  const changeItems = (next: typeof items) => { setItems(next); setQuote(null); };

  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Panel className="p-4 space-y-5">
        <CustomerPick onPick={(p) => { setWho(p); setQuote(null); }} />
        {who && (
          <DetailSection title="2 · สินค้า" icon="inventory_2">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSkuSearch(skuQ.trim()); }}>
              <SearchInput className="flex-1" aria-label="ค้นหาสินค้า" placeholder="SKU / ชื่อสินค้า" value={skuQ} onChange={(e) => setSkuQ(e.target.value)} />
              <Button type="submit" icon="search">ค้นหาสินค้า</Button>
            </form>
            {!!products.data?.items.length && (
              <div className="rounded-lg border border-secondary-container divide-y divide-secondary-container/70">
                {products.data.items.map((p) => (
                  <div key={p.product_inventory_id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="font-mono text-[11px] w-36 shrink-0">{p.product_inventory_sku}</span>
                    <span className="flex-1 min-w-0 truncate">{p.name_th ?? p.name_en}</span>
                    <span className="text-on-surface-variant whitespace-nowrap">{fmt.baht(p.selling_unit_price)} / {p.selling_unit ?? '—'}</span>
                    <Button size="sm" icon="add" onClick={() => changeItems([...items.filter((i) => i.id !== p.product_inventory_id), { id: p.product_inventory_id, sku: p.product_inventory_sku, name: p.name_th ?? '', quantity: 1 }])}>เพิ่ม</Button>
                  </div>
                ))}
              </div>
            )}
            {!!items.length && (
              <div className="rounded-lg border border-secondary-container overflow-hidden">
                <Table>
                  <THead>
                    <TH>SKU</TH>
                    <TH>สินค้า</TH>
                    <TH right>จำนวน</TH>
                    <TH />
                  </THead>
                  <TBody>
                    {items.map((i) => (
                      <TR key={i.id}>
                        <TD kind="mono">{i.sku}</TD>
                        <TD>{i.name}</TD>
                        <TD kind="num">
                          <Input aria-label={`จำนวน ${i.sku}`} type="number" min={1} className="w-20 text-right" value={i.quantity}
                            onChange={(e) => changeItems(items.map((x) => (x.id === i.id ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} />
                        </TD>
                        <TD kind="actions"><Button size="sm" variant="danger-ghost" icon="close" onClick={() => changeItems(items.filter((x) => x.id !== i.id))}>เอาออก</Button></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
            <div><Button variant="primary" icon="calculate" disabled={busy || !items.length} onClick={getQuote}>คิดราคา (josh)</Button></div>
          </DetailSection>
        )}
      </Panel>

      {quote != null && (
        <>
          <CodeBlock title="ราคาจาก josh" value={JSON.stringify(quote, null, 2).slice(0, 4000)} />
          <FormPanel title="3 · สั่งซื้อ" icon="shopping_cart_checkout" cols={3} submitLabel="สั่งซื้อ" busy={busy} onSubmit={place}>
            <Field label="ชำระด้วย">
              <Select value={pay.payment_method} onChange={(e) => setPay({ ...pay, payment_method: e.target.value })}>
                {PAYMENT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <Field label="คูปอง"><Input value={pay.coupon_code} onChange={(e) => setPay({ ...pay, coupon_code: e.target.value })} /></Field>
            <Field label="วันส่ง (ว่าง = ตามรอบ)"><Input type="date" value={pay.delivery_date} onChange={(e) => setPay({ ...pay, delivery_date: e.target.value })} /></Field>
          </FormPanel>
        </>
      )}
    </div>
  );
}

function Samples() {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const list = useAsync(() => joshAdmin.get('/cs-admin/sample-requests', status ? { status } : undefined), [status]);
  async function decide(id: string, next: string) {
    const note = window.prompt(`${SAMPLE_STATUS[next]} — หมายเหตุ CS (ไม่บังคับ)`, '');
    if (note === null) return;
    setBusy(true); setMsg('');
    try { await joshAdmin.call('PATCH', `/cs-admin/sample-requests/${id}`, { status: next, ...(note ? { cs_note: note } : {}) }); setMsg(`${SAMPLE_STATUS[next]}แล้ว`); list.reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const rows = rowsOf(list.data);
  return (
    <Panel className="overflow-hidden">
      <PanelHead
        icon="science"
        title="คำขอสินค้าตัวอย่าง"
        actions={<Segmented value={status} onChange={setStatus} options={[{ value: '', label: 'ทั้งหมด' }, ...Object.entries(SAMPLE_STATUS).map(([k, l]) => ({ value: k, label: l }))]} />}
      />
      {msg && <div className="px-4 pt-3"><Alert tone="info" onClose={() => setMsg('')}>{msg}</Alert></div>}
      <ErrorText error={list.error} />
      {list.loading && !list.data ? (
        <Loading />
      ) : rows.length ? (
        <Table>
          <THead>
            <TH>ขอเมื่อ</TH>
            <TH>ลูกค้า</TH>
            <TH>สินค้า</TH>
            <TH right>จำนวน</TH>
            <TH>สถานะ</TH>
            <TH>หมายเหตุ</TH>
            <TH />
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={String(r.id)}>
                <TD kind="time">{r.created_at ? fmt.when(String(r.created_at)) : '—'}</TD>
                <TD>{show((r.company as JoshRow)?.name ?? r.company_name ?? r.user_id)}</TD>
                <TD kind="mono">{show((r.product as JoshRow)?.product_inventory_sku ?? r.sku ?? r.product_inventory_id)}</TD>
                <TD kind="num">{show(r.quantity)}</TD>
                <TD><StatusChip status={SAMPLE_STATUS[String(r.status)] ?? show(r.status)} /></TD>
                <TD kind="muted">{show(r.cs_note)}</TD>
                <TD kind="actions">
                  <div className="inline-flex gap-1">
                    {r.status === 'pending' && (
                      <>
                        <Button size="sm" variant="primary" disabled={busy} onClick={() => decide(String(r.id), 'approved')}>อนุมัติ</Button>
                        <Button size="sm" variant="danger-ghost" disabled={busy} onClick={() => decide(String(r.id), 'rejected')}>ไม่อนุมัติ</Button>
                      </>
                    )}
                    {r.status === 'approved' && <Button size="sm" disabled={busy} onClick={() => decide(String(r.id), 'fulfilled')}>ส่งแล้ว</Button>}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <Empty icon="science">ไม่มีคำขอ</Empty>
      )}
    </Panel>
  );
}

function Merge() {
  const [v, setV] = useState({ primary_user_id: '', duplicate_user_id: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const uuid = /^[0-9a-f-]{36}$/i;
  async function submit() {
    setMsg(''); setErr('');
    if (!uuid.test(v.primary_user_id) || !uuid.test(v.duplicate_user_id) || v.primary_user_id === v.duplicate_user_id) return setErr('ใส่ user id (uuid) สองบัญชีที่ต่างกัน');
    if (!window.confirm(`รวมบัญชี ${v.duplicate_user_id} เข้า ${v.primary_user_id}?\n\nบัญชีซ้ำจะถูกย้ายข้อมูลเข้าบัญชีหลัก ย้อนกลับไม่ได้`)) return;
    setBusy(true);
    try { const r = await joshAdmin.call('POST', '/cs-admin/accounts/merge', v); setMsg(`รวมแล้ว: ${JSON.stringify(r).slice(0, 200)}`); setV({ primary_user_id: '', duplicate_user_id: '' }); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4 max-w-2xl">
      {msg && <Alert tone="ok" onClose={() => setMsg('')}>{msg}</Alert>}
      <FormPanel
        title="รวมบัญชีซ้ำ"
        icon="merge"
        description="หา user id ได้จาก รายงานร้าน › ลูกค้า (รายละเอียด) · ต้องเป็น admin · ย้อนกลับไม่ได้"
        cols={1}
        submitLabel="รวมบัญชี"
        busy={busy}
        error={err}
        onSubmit={submit}
      >
        <Field label="บัญชีหลัก (เก็บไว้)"><Input className="font-mono" value={v.primary_user_id} onChange={(e) => setV({ ...v, primary_user_id: e.target.value.trim() })} /></Field>
        <Field label="บัญชีซ้ำ (รวมเข้า)"><Input className="font-mono" value={v.duplicate_user_id} onChange={(e) => setV({ ...v, duplicate_user_id: e.target.value.trim() })} /></Field>
      </FormPanel>
    </div>
  );
}
