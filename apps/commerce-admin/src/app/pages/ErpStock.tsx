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

  async function handleSubmit() {
    setSubmitting(true);
    setFormError(null);
    try {
      await api.put('/erp-stub/stock', { sku: form.sku, qty: Number(form.qty) });
      setForm({ sku: '', qty: '' });
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
        title={__uiText("ERP stub stock")}
        subtitle={__uiText("Simulated ERP inventory — set stock levels for the on_hand fulfillment mode.")}
        actions={<Button icon="refresh" variant="secondary" onClick={reload}>{__uiText("Refresh")}</Button>}
      />

      <FormPanel
        title={__uiText("Set stock level")}
        icon="inventory_2"
        cols={2}
        error={formError}
        submitLabel={__uiText("Set stock")}
        busy={submitting}
        onSubmit={handleSubmit}
      >
        <Field label={__uiText("SKU")}>
          <Input
            required
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            placeholder={__uiText("e.g. SKU-A")}
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
      </FormPanel>

      <Panel>
        <PanelHead title={__uiText("Stock levels")} />
        <ErrorText error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty>{__uiText("No stock rows yet.")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("SKU")}</TH>
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
