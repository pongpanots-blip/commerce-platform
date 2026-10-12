// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Button, Empty, ErrorText, Field, FormPanel, Input, KeyValueGrid, Loading, Modal, Page, PageHeader, Panel, PanelHead, RowLink,
  StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { customerFields, missingRequired } from './catalog-fields';
import { api, customersApi, Customer, OrderRow, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Form = { name: string; code: string; email: string; phone: string };
const toForm = (c: Customer): Form => ({ name: c.name, code: c.code ?? '', email: c.email ?? '', phone: c.phone ?? '' });

/** One commerce customer: facts, edit (PATCH /customers/:id) and their orders. */
export function CustomerDetail() {
  __useUiLocale();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const customer = useAsync<Customer>(() => customersApi.get(id), [id]);
  const orders = useAsync(() => api.get<Paginated<OrderRow>>(`/orders?customerId=${encodeURIComponent(id)}&pageSize=100`), [id]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>({ name: '', code: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const c = customer.data;
  useEffect(() => { if (c) setForm(toForm(c)); }, [c]);

  async function save() {
    const missing = missingRequired(customerFields, form);
    if (missing) { setError(missing); return; }
    if (!window.confirm(__uiText("บันทึกการแก้ไขลูกค้า {0}?", {"0": c?.name}))) return;
    setBusy(true);
    setError(null);
    try {
      await customersApi.update(id, { name: form.name.trim(), code: form.code.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null });
      setMsg(__uiMessage("บันทึกการแก้ไขลูกค้าเรียบร้อยแล้ว"));
      setEditing(false);
      customer.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const list = orders.data?.items ?? [];
  const values = list.reduce<Record<string, number>>((sums, order) => ({ ...sums, [order.currency]: (sums[order.currency] ?? 0) + Number(order.total || 0) }), {});
  function cancelEdit() {
    if (busy) return;
    setEditing(false);
    if (c) setForm(toForm(c));
    setError(null);
  }

  return (
    <Page>
      <PageHeader
        back={{ to: '/customers', label: 'ลูกค้าแพลตฟอร์ม' }}
        title={c?.name ?? __uiText("รายละเอียดลูกค้า")}
        badge={c && <StatusChip status={c.status} />}
        subtitle={c?.code && <span className="font-mono">{c.code}</span>}
        actions={<>
          <Button icon="refresh" onClick={() => { customer.reload(); orders.reload(); }}>{__uiText("รีเฟรช")}</Button>
          {c && <Button icon="edit" variant="primary" onClick={() => setEditing(true)}>{__uiText("แก้ไขลูกค้า")}</Button>}
        </>}
      />

      {msg && <Alert tone="ok" onClose={() => setMsg('')}>{(typeof msg === 'string' ? __uiText(msg) : msg)}</Alert>}
      <ErrorText error={customer.error} />

      {customer.loading && !c ? (
        <Loading />
      ) : c ? (
        <>
          {editing && <Modal title={__uiText("แก้ไขลูกค้า")} onClose={cancelEdit} width={640}>
            <FormPanel title={__uiText("ข้อมูลลูกค้า")} description={__uiText("ช่องเดียวกับตอนเพิ่มลูกค้า")} icon="edit" submitLabel={__uiText("บันทึกลูกค้า")} busy={busy} error={error} onSubmit={save} onCancel={cancelEdit}>
              {customerFields.map((f) => {
                const key = f.name as keyof Form;
                return <Field key={f.name} label={f.label} required={f.required} hint={f.hint}><Input type={f.type === 'textarea' ? 'text' : f.type} placeholder={f.placeholder} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></Field>;
              })}
            </FormPanel>
          </Modal>}
            <Panel className="p-4">
              <KeyValueGrid
                items={[
                  { label: __uiText("รหัสลูกค้า"), value: c.code ?? '—', mono: true },
                  { label: __uiText("อีเมล"), value: c.email ?? '—' },
                  { label: __uiText("เบอร์โทร"), value: c.phone ?? '—' },
                  { label: __uiText("รหัสอ้างอิง"), value: c.id, copy: true },
                  { label: __uiText("จำนวนออเดอร์"), value: orders.data ? fmt.num(orders.data.total) : orders.error ? __uiText("โหลดไม่สำเร็จ") : '…' },
                  { label: __uiText("มูลค่าออเดอร์ที่แสดง"), value: Object.entries(values).map(([currency, value]) => `${currency} ${fmt.num(value.toFixed(2))}`).join(' · ') || '—' },
                ]}
              />
            </Panel>

          <Panel className="overflow-hidden">
            <PanelHead icon="receipt_long" title={__uiText("ออเดอร์ของลูกค้า")} sub={orders.data && __uiText("แสดง {0} จาก {1} รายการ",{'0':list.length,'1':fmt.num(orders.data.total)})} />
            <ErrorText error={orders.error} />
            {orders.loading && !orders.data ? (
              <Loading />
            ) : orders.error && !orders.data ? null : list.length ? (
              <Table>
                <THead>
                  <TH>{__uiText("รหัสออเดอร์")}</TH>
                  <TH>{__uiText("สถานะ")}</TH>
                  <TH right>{__uiText("ยอดรวม")}</TH>
                  <TH>{__uiText("สร้างเมื่อ")}</TH>
                </THead>
                <TBody>
                  {list.map((o) => (
                    <TR key={o.id} onClick={() => navigate(`/orders/${o.id}`)}>
                      <TD><RowLink to={`/orders/${o.id}`}>{o.code ?? `${o.id.slice(0, 8)}…`}</RowLink></TD>
                      <TD><StatusChip status={o.status} /></TD>
                      <TD kind="money">{o.currency} {fmt.num(o.total)}</TD>
                      <TD kind="time">{fmt.when(o.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty icon="receipt_long">{__uiText("ยังไม่มีออเดอร์ของลูกค้านี้")}</Empty>
            )}
          </Panel>
        </>
      ) : null}
    </Page>
  );
}
