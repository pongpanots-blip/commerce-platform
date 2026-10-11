import { useState } from 'react';
import { Button, Empty, ErrorText, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, TBody, TD, TH, THead, TR, Table, fmt } from '@cp/ui';
import { api, ErpStubStockRow, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function ErpStock() {
  __useUiLocale();
  const { data, loading, error, reload } = useAsync(
    () => api.get<Paginated<ErpStubStockRow>>('/erp-stub/stock'), []);
  const [form, setForm] = useState({ sku: '', qty: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    setFormError(null);
    try {
      await api.put('/erp-stub/stock', { sku: form.sku, qty: Number(form.qty) });
      setForm({ sku: '', qty: '' });
      setShowForm(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title={__uiText("สต็อกจำลองสำหรับทดสอบ")}
        subtitle={__uiText("กำหนดสต็อกจำลองเพื่อทดสอบการขาย")}
        actions={<>
          <Button icon="refresh" variant="secondary" onClick={reload}>{__uiText("Refresh")}</Button>
          <Button icon="add" variant="primary" onClick={() => setShowForm(true)} disabled={showForm}>{__uiText("ตั้งสต็อกจำลอง")}</Button>
        </>}
      />

      {showForm && <FormPanel
        title={__uiText("Set stock level")}
        icon="inventory_2"
        cols={2}
        error={formError}
        submitLabel={__uiText("Set stock")}
        busy={submitting}
        onSubmit={handleSubmit}
        onCancel={() => { setShowForm(false); setFormError(null); }}
      >
        <Field label={__uiText("รหัสสินค้า")}>
          <Input
            required
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            placeholder={__uiText("รหัสสินค้าที่ใช้ทดสอบ")}
          />
        </Field>
        <Field label={__uiText("Quantity")}>
          <Input
            required
            value={form.qty}
            onChange={(e) => setForm({ ...form, qty: e.target.value })}
            placeholder="0"
          />
        </Field>
      </FormPanel>}

      <Panel>
        <PanelHead title={__uiText("Stock levels")} />
        <ErrorText error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty icon="inventory_2">{__uiText("ยังไม่มีสต็อกจำลอง กดปุ่ม “ตั้งสต็อกจำลอง” เพื่อเพิ่มรายการแรก")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("รหัสสินค้า")}</TH>
              <TH right>{__uiText("Qty")}</TH>
            </THead>
            <TBody>
              {data.items.map((s) => (
                <TR key={s.id}>
                  <TD kind="mono">{s.sku}</TD>
                  <TD kind="num">{fmt.num(s.qty)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
