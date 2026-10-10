// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from "@cp/ui";
import { FormEvent, useState } from "react";
import {
  Button,
  Empty,
  ErrorText,
  Hint,
  Input,
  Page,
  PageHeader,
  Pager,
  Panel,
  PanelHead,
  SearchInput,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  fmt,
} from "@cp/ui";
import { productPricesApi, PriceRow } from "../../../lib/api";
import { useAsync } from "../../hooks";

// ui-copy-migration: only literal UI copy and notification templates
import {
  uiText as __uiText,
  formatUiMessage as __uiMessage,
  useUiLocale as __useUiLocale,
} from "@cp/ui";
const money = (v: string | number | null) =>
  v == null ? "—" : fmt.num(Number(v));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Product prices owned by commerce (stage 4a): the MER queue of ERP price / MOQ changes (approve / reject) and the live
 * base price, ERP box price and MOQ per SKU. Every change reaches josh as product.price.snapshot.
 */
export function CurrentPrices() {
  __useUiLocale();
  const owned = useAsync(() => productPricesApi.ownership(), []);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [pricePage, setPricePage] = useState(1);
  const [priceSize, setPriceSize] = useState(20);
  const prices = useAsync(
    () => productPricesApi.list(search, pricePage, priceSize),
    [search, pricePage, priceSize],
  );
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{
    sku: string;
    sellingUnitPrice: string;
    orderingPrice: string;
    moq: string;
  } | null>(null);
  const isOwned = owned.data?.prices === true;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setError(null);
    const n = (v: string) => (v.trim() === "" ? undefined : Number(v));
    try {
      await productPricesApi.edit(edit.sku, {
        sellingUnitPrice: n(edit.sellingUnitPrice),
        orderingPrice: n(edit.orderingPrice),
        moq: n(edit.moq),
      });
      setEdit(null);
      prices.reload();
    } catch (err) {
      setError(errText(err));
    }
  }

  return (
    <Page>
      <PageHeader
        title={__uiText("ราคาสินค้า")}
        subtitle={__uiText(
          "ราคาขาย (ต่อหน่วยขาย) ราคาสั่ง (ต่อหน่วยสั่ง) และ MOQ · ERP เปลี่ยนแล้วรอ MER อนุมัติที่นี่ · ทุกการเปลี่ยนส่งให้ร้าน (josh)",
        )}
      />
      {owned.data && !isOwned && (
        <Hint>
          {__uiText(
            "ยังไม่ได้สลับ — ราคายังแก้และอนุมัติที่ josh (COMMERCE_OWNS_PRICES)",
          )}
        </Hint>
      )}
      <ErrorText error={error ?? prices.error ?? null} />
      <form
        className="flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query.trim());
          setPricePage(1);
        }}
      >
        <div className="flex-1 max-w-sm">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={__uiText("SKU")}
          />
        </div>
        <Button type="submit">{__uiText("ค้นหา")}</Button>
      </form>

      <Panel>
        <PanelHead title={__uiText("ราคาปัจจุบัน")} />
        {edit && (
          <form
            className="px-4 py-3 flex flex-wrap items-end gap-3 border-b border-secondary-container"
            onSubmit={save}
          >
            <div className="text-xs font-mono">{edit.sku}</div>
            {(["sellingUnitPrice", "orderingPrice", "moq"] as const).map(
              (k) => (
                <div key={k} className="w-36">
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">
                    {k === "sellingUnitPrice"
                      ? __uiText("ราคาขาย")
                      : k === "orderingPrice"
                        ? __uiText("ราคาสั่ง")
                        : __uiText("MOQ")}
                  </label>
                  <Input
                    type="number"
                    step={k === "moq" ? 1 : 0.01}
                    min={0}
                    value={edit[k]}
                    onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                  />
                </div>
              ),
            )}
            <Button type="submit" variant="primary">
              {__uiText("บันทึก")}
            </Button>
            <Button onClick={() => setEdit(null)}>{__uiText("ยกเลิก")}</Button>
          </form>
        )}
        {prices.data?.items.length ? (
          <>
            <Table>
              <THead>
                <TH>{__uiText("SKU")}</TH>
                <TH kind="money">{__uiText("ราคาขาย")}</TH>
                <TH kind="money">{__uiText("ราคาสั่ง")}</TH>
                <TH kind="num">{__uiText("MOQ")}</TH>
                <TH>{__uiText("ที่มา")}</TH>
                <TH>{__uiText("แก้ล่าสุด")}</TH>
                <TH kind="actions" />
              </THead>
              <TBody>
                {prices.data.items.map((r: PriceRow) => (
                  <TR key={r.sku}>
                    <TD kind="mono">{r.sku}</TD>
                    <TD kind="money">{money(r.selling_unit_price)}</TD>
                    <TD kind="money">{money(r.ordering_price)}</TD>
                    <TD kind="num">{r.moq ?? "—"}</TD>
                    <TD kind="muted">{r.source}</TD>
                    <TD kind="time">
                      {new Date(r.updated_at).toLocaleString(
                        __dateLocale() === "th" ? "th-TH" : "en-GB",
                      )}
                    </TD>
                    <TD kind="actions">
                      <Button
                        size="sm"
                        disabled={!isOwned}
                        onClick={() =>
                          setEdit({
                            sku: r.sku,
                            sellingUnitPrice: r.selling_unit_price ?? "",
                            orderingPrice: r.ordering_price ?? "",
                            moq: r.moq == null ? "" : String(r.moq),
                          })
                        }
                      >
                        {__uiText("แก้")}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager
              page={pricePage}
              pageSize={priceSize}
              total={prices.data.total}
              onPage={setPricePage}
              onPageSize={(n) => {
                setPriceSize(n);
                setPricePage(1);
              }}
            />
          </>
        ) : (
          <Empty>
            {search
              ? __uiText("ไม่พบ SKU")
              : __uiText("ยังไม่มีราคา — import จาก josh ก่อนสลับ")}
          </Empty>
        )}
      </Panel>
    </Page>
  );
}
