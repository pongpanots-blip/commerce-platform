// ui-caption-migration: literal captions only
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Empty, ErrorText, Field, FormPanel, Input, Loading, MasterDataSelect, Modal, Page, PageHeader, Panel, PanelHead, Pager, StatusChip, TBody, TD, TH, THead, TR, Table, fmt, RowLink, Icon } from '@cp/ui';
import { api, customersApi, productsApi, Customer, Product, OrderRow, Paginated, session } from '../../lib/api';
import { roleCanWrite } from '../role-can';
import { useAsync } from '../hooks';
import { CurrentPageFilters, useCurrentPageFilter } from '../components/CurrentPageFilters';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
interface LineForm {
  productId: string;
  qty: string;
  unitPrice: string;
}

const emptyLine: LineForm = { productId: '', qty: '1', unitPrice: '' };

export function Orders() {
  __useUiLocale();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [creating, setCreating] = useState(false);
  const customers = useAsync(() => creating ? api.get<Paginated<Customer>>('/customers?page=1&pageSize=100') : Promise.resolve(null), [creating]);
  const products = useAsync(() => creating ? api.get<Paginated<Product>>('/products?page=1&pageSize=100') : Promise.resolve(null), [creating]);
  const { data, loading, error, reload } = useAsync(
    () => api.get<Paginated<OrderRow>>(`/orders?page=${page}&pageSize=${pageSize}`),
    [page],
  );

  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<LineForm[]>([{ ...emptyLine }]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function updateLine(i: number, patch: Partial<LineForm>) {
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        customerId,
        lines: lines
          .filter((l) => l.productId)
          .map((l) => ({
            productId: l.productId,
            qty: Number(l.qty),
            unitPrice: Number(l.unitPrice),
          })),
      };
      if (!customerId) {
        setFormError(__uiMessage("เลือกลูกค้าจากรายการ"));
        setSubmitting(false);
        return;
      }
      if (!payload.lines.length) {
        setFormError(__uiMessage("กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ"));
        setSubmitting(false);
        return;
      }
      const created = await api.post<OrderRow>('/orders', payload);
      setCustomerId('');
      setLines([{ ...emptyLine }]);
      setCreating(false);
      if (page !== 1) setPage(1);
      else reload();
      navigate(`/orders/${created.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }


  const total = data?.total ?? 0;
  const readOnly = session.claims()?.role === 'business_analyst';
  const filter = useCurrentPageFilter(data?.items ?? [], row => `${row.code ?? ''} ${row.id}`, row => row.status);

  return (
    <Page>
      <PageHeader
        title={__uiText("ออเดอร์แพลตฟอร์ม")}
        subtitle={__uiText("ดูสถานะและยอดคำสั่งซื้อ เปิดรายละเอียดเพื่อติดตามการชำระเงินและการจองสินค้า")}
        actions={<><Button icon="refresh" variant="secondary" onClick={reload}>{__uiText("รีเฟรช")}</Button>{!readOnly && <Button icon="add" variant="primary" onClick={() => setCreating(true)}>{__uiText("สร้างออเดอร์")}</Button>}</>}
      />

      {!readOnly && creating && <Modal title={__uiText("สร้างออเดอร์")} onClose={() => { if (!submitting) setCreating(false); }} width={850}><FormPanel
        title={__uiText("ลูกค้าและรายการสินค้า")}
        description={__uiText("เลือกลูกค้าและสินค้า จากนั้นระบุจำนวนและราคาขาย")}
        icon="add_circle"
        cols={1}
        error={formError}
        submitLabel={__uiText("สร้างออเดอร์")}
        busy={submitting}
        onSubmit={submit}
        onCancel={() => setCreating(false)}
      >
        <ErrorText error={customers.error ?? products.error} />
        <Field label={__uiText("ลูกค้า")} hint={__uiText("ค้นจากชื่อ รายการที่โหลดมา 100 รายการแรก")}>
          <MasterDataSelect
            options={(customers.data?.items ?? []).map((customer) => ({ value: customer.id, label: customer.code ? `${customer.name} · ${customer.code}` : customer.name }))}
            value={customerId}
            onChange={(next) => setCustomerId(String(next))}
            canCreate={roleCanWrite()}
            createFields={[{ name: 'name', label: 'ชื่อลูกค้า', required: true, placeholder: 'ร้านอาหารบ้านสวน' }]}
            onCreate={async (draft) => {
              const made = await customersApi.create({ name: draft.name.trim() });
              return { value: made.id, label: made.name };
            }}
          />
        </Field>
        {lines.map((l, i) => (
          <div key={i} className="col-span-full grid grid-cols-2 items-end gap-3 rounded-lg border border-secondary-container p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_40px]">
            <Field label={__uiText("สินค้า {0}", {"0": i + 1})} className="col-span-2 md:col-span-1">
              <MasterDataSelect
                options={(products.data?.items ?? []).map((product) => ({ value: product.id, label: `${product.sku} · ${product.name}` }))}
                value={l.productId}
                onChange={(next) => updateLine(i, { productId: String(next) })}
                canCreate={roleCanWrite(['merchandising'])}
                createFields={[{ name: 'sku', label: 'รหัสสินค้า', required: true, placeholder: 'BREAD-001' }, { name: 'name', label: 'ชื่อสินค้า', required: true, placeholder: 'ขนมปังโฮลวีต' }]}
                createFrom="name"
                onCreate={async (draft) => {
                  const made = await productsApi.create({ sku: draft.sku.trim(), name: draft.name.trim() });
                  return { value: made.id, label: `${made.sku} · ${made.name}` };
                }}
              />
            </Field>
            <Field label={__uiText("จำนวน {0}", {"0": i + 1})}>
              <Input
                type="number" min="1" step="any" required={!!l.productId}
                value={l.qty}
                onChange={(e) => updateLine(i, { qty: e.target.value })}
                placeholder="1"
              />
            </Field>
            <Field label={__uiText("ราคาต่อหน่วย {0}", {"0": i + 1})}>
              <Input
                type="number" min="0" step="0.01" required={!!l.productId}
                value={l.unitPrice}
                onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                placeholder="0.00"
              />
            </Field>
            <Button icon="close" variant="ghost" aria-label={__uiText("ลบรายการสินค้า {0}", {"0": i + 1})} disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, index) => index !== i))} />
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3"><Button icon="add" onClick={() => setLines(current => [...current, { ...emptyLine }])}>{__uiText("เพิ่มรายการสินค้า")}</Button><span className="text-sm">{__uiText("ยอดรวมรายการ ")}<strong className="tabular-nums">{fmt.baht(lines.reduce((sum, line) => sum + (line.productId ? Math.round((Number(line.qty) || 0) * (Number(line.unitPrice) || 0) * 100) / 100 : 0), 0))}</strong></span></div>
      </FormPanel></Modal>}

      <Panel>
        <PanelHead title={__uiText("ออเดอร์ทั้งหมด")} sub={__uiText("{0} รายการ",{'0':total.toLocaleString()})} />
        <CurrentPageFilters filter={filter} placeholder={__uiText("ค้นหารหัสออเดอร์ในหน้านี้…")} loading={loading} />
        <ErrorText error={error} />
        {loading && !data ? (
          <Loading />
        ) : error && !data ? null : !data?.items.length ? (
          <Empty>{__uiText(readOnly ? "ยังไม่มีออเดอร์" : "ยังไม่มีออเดอร์ เริ่มต้นด้วยปุ่ม “สร้างออเดอร์” ด้านบน")}</Empty>
        ) : (
          <>
            {filter.visible.length ? <Table>
              <THead>
                <TH>{__uiText("รหัสออเดอร์")}</TH>
                <TH>{__uiText("สถานะ")}</TH>
                <TH right>{__uiText("ยอดรวม")}</TH>
                <TH>{__uiText("วันที่สร้าง")}</TH>
                <TH right>{__uiText("รายละเอียด")}</TH>
              </THead>
              <TBody>
                {filter.visible.map((o) => (
                  <TR key={o.id} onClick={() => navigate(`/orders/${o.id}`)}>
                    <TD><RowLink to={`/orders/${o.id}`}>{o.code ?? o.id.slice(0, 8) + '…'}</RowLink></TD>
                    <TD><StatusChip status={o.status} /></TD>
                    <TD kind="money">{fmt.baht(o.total)}</TD>
                    <TD kind="time">{fmt.when(o.createdAt)}</TD>
                    <TD kind="actions">
                      <Icon name="chevron_right" size={18} className="text-outline" />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table> : <Empty icon="search_off">{__uiText("ไม่พบรายการในหน้านี้ ล้างตัวกรองหรือเปิดหน้าถัดไป")}</Empty>}
            <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
          </>
        )}
      </Panel>

    </Page>
  );
}
