import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Empty,
  Loading,
  PageHeader,
  Pager,
  Panel,
  TaskInput,
  TaskSelect,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useUiLocale,
  useUnsavedChanges,
  fmt,
} from "@cp/ui";
import { z } from "zod";
import { api, productPricesApi, session } from "../../../lib/api";
import { CommercePage } from "../../CommercePage";
import { WorkspaceLink } from "../../WorkspaceParts";
import { commerceText as text } from "../../commerce-copy";
import { useAsync, useMutation } from "../../hooks";
import { PlanningError as ErrorText } from "../planning/PlanningError";
import {
  canApprovePrices,
  priceRequestId,
} from "../../../../../commerce-platform/src/modules/commerce/product-prices/price-approval-contracts";
import {
  MANUAL_PRICE_API as endpoint,
  manualPricePacketSchema,
  manualPriceSkuSchema,
  manualPriceReadSchema,
  manualPriceSelectionSchema,
  verifyManualPriceReceipt,
  verifyManualPriceReview,
  type ManualPriceItem,
  type ManualPriceReview,
  type ManualPriceReceipt,
} from "../../../../../commerce-platform/src/modules/commerce/product-prices/manual-price-contracts";
import {
  clearManualDraft,
  clearManualJob,
  readManualForm,
  readManualJobs,
  readManualSelection,
  storeManualForm,
  storeManualJob,
  storeManualSelection,
  initialManualPriceForm as initial,
  manualPatchFromForm,
  type ManualPriceForm,
  type ManualPriceJob,
} from "./manual-price-journal";
import { PriceRequestLinks, usePriceRequests } from "./PriceRequestLinks";
import { ProductEvidence } from "./ProductEvidence";
import { priceDetailUrl, priceSkuFromToken } from "./price-approval-routing";
const home = "/product-prices/current";
export const manualPriceViewUrl = (sku: string) =>
  priceDetailUrl(sku).replace("/pending/", "/current/");
export const manualPriceEditUrl = (sku: string) =>
  manualPriceViewUrl(sku) + "/edit";
export const manualPriceReviewUrl = (sku: string) =>
  manualPriceViewUrl(sku) + "/review";
export { manualPatchFromForm } from "./manual-price-journal";
const outcome = (id: string) => home + "/requests/" + id;
const keys = ["sellingUnitPrice", "orderingPrice", "moq"] as const;
// Josh prices off ERP PRICE (orderingPrice) only and no longer stores the per-selling-unit rate, so the rate is display-only.
const editKeys = ["orderingPrice", "moq"] as const;
const label = (k: (typeof keys)[number]) =>
  k === "sellingUnitPrice"
    ? text("ราคาต่อหน่วยขาย (เรท ร้านไม่ใช้)", "Price per selling unit (rate, not used by the shop)")
    : k === "orderingPrice"
      ? text("ราคาต่อหน่วยสั่ง (ERP PRICE ร้านใช้เป็นราคาขาย)", "Price per ordering unit (ERP PRICE, the shop selling price)")
      : text("จำนวนขั้นต่ำ", "Minimum order quantity");
const sourceLabel = (s: string) =>
  s === "staff"
    ? text("ทีมงาน", "Staff")
    : s === "import"
      ? text("นำเข้าข้อมูล", "Import")
      : s === "erp"
        ? text("ระบบหลัก (ERP)", "ERP")
        : s;
const show = (v: unknown) =>
  v == null ? text("ยังไม่มีข้อมูล", "Not recorded") : String(v);
function Scope() {
  return (
    <Alert tone="info">
      <p>
        {text(
          "แก้เฉพาะราคาต่อหน่วยและจำนวนขั้นต่ำของสินค้านี้ ค่าที่ไม่ได้ระบุจะคงเดิม ล้างค่าจะบันทึกเป็นไม่มีค่า ข้อเสนอจากระบบหลักและราคาสัญญาลูกค้าไม่เปลี่ยน",
          "Edit only this SKU’s unit prices and minimum quantity. Omitted fields keep their values; Clear stores no value. ERP proposals and customer contract prices remain unchanged.",
        )}
      </p>
      <p>
        {text(
          "แสดงค่าตามระบบเดิม สกุลเงิน ภาษี และขอบเขตหน่วยที่ไม่ได้ยืนยันไม่ถูกสมมติ หลังบันทึก ระบบคิวส่งต่อจะรับเหตุการณ์ แต่ยังไม่ยืนยันการรับของร้าน",
          "Values use the original fields. Unverified currency, tax and unit scope are not assumed. Saving queues the original event; shop delivery remains unverified.",
        )}
      </p>
    </Alert>
  );
}
function Evidence({
  item,
  review,
  historical = false,
}: {
  item: ManualPriceItem;
  review?: ManualPriceReview;
  historical?: boolean;
}) {
  return (
    <Panel>
      <div className="p-4 space-y-4 min-w-0">
        <h2 className="font-semibold break-all">{item.sku}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {keys.map((k) => (
            <div key={k} className="space-y-1 min-w-0">
              <h3 className="font-medium">{label(k)}</h3>
              <p className="break-words">
                {historical
                  ? text("ฉบับที่ตรวจ: ", "Reviewed baseline: ")
                  : text("ปัจจุบัน: ", "Current: ")}
                {show(item.current[k])}
              </p>
              {review && (
                <>
                  <p>
                    {text("การเปลี่ยน: ", "Change: ")}
                    {review.patch[k] === undefined
                      ? text("คงเดิม", "Keep")
                      : review.patch[k] === null
                        ? text("ล้างค่า", "Clear")
                        : show(review.patch[k])}
                  </p>
                  <p className="font-semibold break-words">
                    {text("หลังบันทึก: ", "After save: ")}
                    {show(review.after[k])}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
        <p className="text-sm break-words">
          {text("ที่มา: ", "Source: ")}
          {show(item.currentSource)} · {text("ผู้แก้ล่าสุด: ", "Last editor: ")}
          {show(item.currentUpdatedBy)} · {show(item.currentUpdatedAt)}
        </p>
        {!item.currentRecorded && !historical && (
          <Alert tone="warn">
            {text(
              "สินค้าที่ระบบรู้จักนี้ยังไม่มีราคา บันทึกครั้งนี้จะสร้างแถวราคาด้วยค่าที่เลือกเท่านั้น",
              "This known product has no current price record. Saving creates a price row with only the selected fields.",
            )}
          </Alert>
        )}
      </div>
    </Panel>
  );
}
function useCurrentEvidence(sku: string) {
  return useAsync(async () => {
    const response = manualPriceReadSchema.parse(
      await api.get(endpoint + "/items/" + encodeURIComponent(sku)),
    );
    if (response.item.sku !== sku)
      throw Error("Returned evidence differs from requested SKU");
    return response;
  }, [sku]);
}
function Inspect({ owner, sku }: { owner: string; sku: string }) {
  const source = useCurrentEvidence(sku),
    requests = usePriceRequests(owner),
    pending =
      requests.edits.some((job) => job.packet.sku === sku) ||
      requests.approvals.some((job) =>
        job.packet.changes.some((change) => change.sku === sku),
      );
  return (
    <>
      <PageHeader
        title={text("ตรวจราคาสินค้า", "Inspect product price")}
        subtitle={sku}
      />
      <WorkspaceLink to={home}>
        {text("กลับราคาปัจจุบัน", "Back to current prices")}
      </WorkspaceLink>
      <PriceRequestLinks owner={owner} sku={sku} />
      <ErrorText error={source.error} onRetry={source.reload} />
      {source.loading ? (
        <Loading variant="detail" />
      ) : !source.error && source.data ? (
        <>
          <Chip tone="muted">
            {source.data.item.currentRecorded
              ? text("มีแถวราคาที่บันทึก", "Price record exists")
              : text("ยังไม่มีแถวราคา", "No price record")}
          </Chip>
          <Evidence
            item={source.data.item}
            historical={source.data.ownership !== "commerce"}
          />
          <ProductEvidence sku={sku} />
          <Scope />
          {source.data.ownership !== "commerce" ? (
            <Alert tone="warn">
              {text(
                "ร้านค้ายังดูแลราคาเอง ค่าที่เก็บไว้ในระบบนี้อาจไม่ใช่ราคาปัจจุบันของร้านค้า ยังแก้ที่นี่ไม่ได้",
                "Josh still owns prices. Retained commerce values may differ from the current Josh price. Editing is unavailable here.",
              )}
            </Alert>
          ) : pending ? null : (
            <WorkspaceLink to={manualPriceEditUrl(sku)}>
              {text("แก้ราคาที่ตรวจแล้ว", "Edit inspected price")}
            </WorkspaceLink>
          )}
        </>
      ) : null}
    </>
  );
}
const row = z.object({
  sku: z.string(),
  selling_unit_price: z.string().nullable(),
  ordering_price: z.string().nullable(),
  moq: z.number().int().nullable(),
  source: z.string(),
  updated_by: z.string().nullable(),
  updated_at: z.string(),
});
const pageSchema = z.object({
  items: z.array(row),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
function List({ owner }: { owner: string }) {
  const [params, setParams] = useSearchParams(),
    search = params.get("search") ?? "",
    page =
      Number.isSafeInteger(Number(params.get("page"))) &&
      Number(params.get("page")) > 0
        ? Number(params.get("page"))
        : 1,
    limit = [20, 50, 100].includes(Number(params.get("limit")))
      ? Number(params.get("limit"))
      : 20;
  const [query, setQuery] = useState(search);
  useEffect(() => setQuery(search), [search]);
  const source = useAsync(async () => {
    const [raw, own] = await Promise.all([
      productPricesApi.list(search, page, limit),
      productPricesApi.ownership(),
    ]);
    return { page: pageSchema.parse(raw), owned: own.prices === true };
  }, [search, page, limit]);
  const change = (p: number, l = limit, s = search) =>
    setParams({
      ...(s ? { search: s } : {}),
      page: String(p),
      limit: String(l),
    });
  useEffect(() => {
    if (
      !source.loading &&
      !source.error &&
      source.data &&
      page > Math.max(1, Math.ceil(source.data.page.total / limit))
    )
      setParams(
        {
          ...(search ? { search } : {}),
          page: String(Math.max(1, Math.ceil(source.data.page.total / limit))),
          limit: String(limit),
        },
        { replace: true },
      );
  }, [source.loading, source.error, source.data, page, limit]);
  return (
    <>
      <PageHeader
        title={
          source.data?.owned === false
            ? text(
                "ตรวจราคาที่เก็บไว้ในระบบนี้",
                "Inspect retained commerce prices",
              )
            : text("ตรวจและแก้ราคาปัจจุบัน", "Inspect and edit current prices")
        }
        subtitle={
          source.data?.owned === false
            ? text(
                "ตรวจค่าที่เก็บไว้ในระบบนี้ ราคาปัจจุบันบนร้านค้าอาจต่างจากนี้",
                "Inspect values retained in commerce. The price owner Josh may have different current values.",
              )
            : text(
                "เลือกรายการ ตรวจค่าปัจจุบัน แล้วทบทวนการเปลี่ยนก่อนบันทึก",
                "Choose a record, inspect current values, then review an edit before saving",
              )
        }
      />
      <WorkspaceLink to="/product-prices">
        {text("เปิดราคาที่ระบบหลักเสนอ", "Open ERP price proposals")}
      </WorkspaceLink>
      <PriceRequestLinks owner={owner} />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          change(1, limit, query.trim());
        }}
      >
        <div className="min-w-0 flex-1">
          <TaskInput
            label={text("ค้นหารหัสสินค้า", "Search SKU")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit">{text("ค้นหา", "Search")}</Button>
      </form>
      <ErrorText error={source.error} onRetry={source.reload} />
      {source.loading ? (
        <Loading variant="table" />
      ) : source.error ? null : source.data ? (
        <>
          {!source.data.owned && (
            <Alert tone="warn">
              {text(
                "ร้านค้ายังดูแลราคาเอง ตรวจข้อมูลได้แต่ยังแก้ที่นี่ไม่ได้",
                "Josh still owns prices. Retained commerce values may differ from the current Josh price. Editing is unavailable here.",
              )}
            </Alert>
          )}
          <Chip tone="muted">
            {text("รายการราคาที่บันทึกจริง: ", "Recorded price records: ") +
              source.data.page.total}
          </Chip>
          {source.data.page.items.length ? (
            <Panel>
              <Table>
                <THead>
                  <TH>{text("รหัสสินค้า", "SKU")}</TH>
                  {keys.map((k) => (
                    <TH key={k} right>{label(k)}</TH>
                  ))}
                  <TH>{text("ที่มา", "Source")}</TH>
                  <TH>{text("แก้ล่าสุด", "Last updated")}</TH>
                  <TH>{text("งาน", "Action")}</TH>
                </THead>
                <TBody>
                  {source.data.page.items.map((r) => (
                    <TR key={r.sku}>
                      <TD kind="mono">{r.sku}</TD>
                      <TD kind="money">{r.selling_unit_price == null ? show(null) : fmt.baht(r.selling_unit_price)}</TD>
                      <TD kind="money">{r.ordering_price == null ? show(null) : fmt.baht(r.ordering_price)}</TD>
                      <TD kind="num">{r.moq == null ? show(null) : fmt.num(r.moq)}</TD>
                      <TD>{sourceLabel(r.source)}</TD>
                      <TD kind="time">{fmt.when(r.updated_at)}</TD>
                      <TD>
                        <WorkspaceLink to={manualPriceViewUrl(r.sku)}>
                          {text("ตรวจราคา", "Inspect price")}
                        </WorkspaceLink>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Panel>
          ) : (
            <Empty>
              {search
                ? text(
                    "ไม่พบรหัสสินค้า ลองค้นหาใหม่",
                    "No matching SKU. Try another search.",
                  )
                : text(
                    "ยังไม่มีราคาปัจจุบันที่บันทึก",
                    "No current price records yet.",
                  )}
              {search.trim() && Array.from(search.trim()).length <= 64 && (
                <WorkspaceLink to={manualPriceViewUrl(search.trim())}>
                  {text(
                    "ตรวจสินค้านี้จากรายการสินค้าที่ระบบรู้จัก",
                    "Inspect this exact SKU in known products",
                  )}
                </WorkspaceLink>
              )}
            </Empty>
          )}
          <Pager
            page={page}
            pageSize={limit}
            total={source.data.page.total}
            onPage={(p) => change(p)}
            onPageSize={(n) => change(1, n)}
          />
        </>
      ) : null}
    </>
  );
}
function Edit({ owner, sku }: { owner: string; sku: string }) {
  const navigate = useNavigate(),
    [form, setForm] = useState(() => readManualForm(owner, sku)),
    [error, setError] = useState<string | null>(null),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const source = useCurrentEvidence(sku),
    formElement = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (source.data && !form) setForm(initial(source.data.item));
  }, [source.data, form]);
  const requests = usePriceRequests(owner),
    pending =
      requests.edits.some((j) => j.packet.sku === sku) ||
      requests.approvals.some((j) =>
        j.packet.changes.some((c) => c.sku === sku),
      ),
    stale =
      !!form && !!source.data && form.item.version !== source.data.item.version;
  useUnsavedChanges(!!form && editKeys.some((k) => form.fields[k].mode !== "keep"));
  useEffect(() => {
    if (Object.keys(fieldErrors).length)
      formElement.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
  }, [fieldErrors]);
  const update = (next: ManualPriceForm) => {
    setForm(next);
    setError(null);
    setFieldErrors({});
    try {
      storeManualForm(owner, next);
    } catch {
      setError(
        text(
          "ที่เก็บกู้คืนใช้ไม่ได้ ยังไม่ส่งการเปลี่ยน",
          "Recovery storage unavailable. No change was sent.",
        ),
      );
    }
  };
  function review(e: FormEvent) {
    e.preventDefault();
    if (
      !form ||
      !source.data ||
      source.loading ||
      source.error ||
      pending ||
      stale ||
      source.data.ownership !== "commerce"
    )
      return;
    setError(null);
    setFieldErrors({});
    try {
      const patch = manualPatchFromForm(form),
        selection = manualPriceSelectionSchema.parse({
          sku,
          version: form.item.version,
          patch,
        });
      storeManualForm(owner, form);
      storeManualSelection(owner, selection);
      navigate(manualPriceReviewUrl(sku));
    } catch (e) {
      if (e instanceof z.ZodError) {
        setFieldErrors(
          Object.fromEntries(
            e.issues
              .filter((i) => i.path.length)
              .map((i) => [
                String(i.path[0]),
                text(
                  "ใช้จำนวนเต็มหรือราคาทศนิยมไม่เกินสองตำแหน่งภายในช่วงที่ระบบเดิมจัดเก็บได้",
                  "Use a nonnegative integer quantity or a price with at most two decimals within existing storage bounds",
                ),
              ]),
          ),
        );
      }
      setError(
        e instanceof z.ZodError
          ? text(
              "เลือกอย่างน้อยหนึ่งช่องให้ตั้งค่าหรือล้างค่า แล้วตรวจค่าที่กรอก",
              "Choose at least one field to set or clear, then check the entered values",
            )
          : text(
              "ที่เก็บกู้คืนใช้ไม่ได้ ยังไม่ส่งการเปลี่ยน ลองใหม่ก่อนทบทวน",
              "Recovery storage unavailable. No change was sent. Try again before reviewing.",
            ),
      );
    }
  }
  return (
    <>
      <PageHeader
        title={text("แก้ราคาสินค้า", "Edit product price")}
        subtitle={sku}
      />
      <WorkspaceLink to={manualPriceViewUrl(sku)}>
        {text("กลับไปตรวจราคา", "Back to price inspection")}
      </WorkspaceLink>
      <PriceRequestLinks owner={owner} sku={sku} />
      <ErrorText error={source.error} onRetry={source.reload} />
      <ErrorText error={error} />
      {source.loading ? (
        <Loading variant="detail" />
      ) : source.error ? (
        form ? (
          <>
            <Alert tone="warn">
              {text(
                "แสดงฉบับที่เก็บในเครื่อง ยังยืนยันค่าปัจจุบันไม่ได้",
                "Showing the retained local baseline. Current values are unverified.",
              )}
            </Alert>
            <Evidence item={form.item} historical />
          </>
        ) : null
      ) : form && source.data ? (
        <>
          <Evidence
            item={source.data.item}
            historical={source.data.ownership !== "commerce"}
          />
          {editKeys.some((key) => form.fields[key].mode !== "keep") && (
            <Chip tone="muted">
              {text(
                "ฉบับแก้ในเครื่อง — ยังไม่ส่ง",
                "Local edit — not submitted",
              )}
            </Chip>
          )}
          <Scope />
          {stale && (
            <Alert tone="warn">
              <p>
                {text(
                  "ค่าปัจจุบันเปลี่ยนแล้ว แบบแก้เดิมยังไม่ส่ง ต้องเริ่มจากข้อมูลปัจจุบันอีกครั้ง",
                  "Current values changed. The retained edit cannot be sent. Start again from current evidence.",
                )}
              </p>
              <Button onClick={() => update(initial(source.data!.item))}>
                {text(
                  "เริ่มใหม่จากค่าปัจจุบัน",
                  "Start again from current values",
                )}
              </Button>
            </Alert>
          )}
          {source.data.ownership !== "commerce" && (
            <Alert tone="warn">
              {text(
                "ร้านค้ายังดูแลราคาเอง บันทึกที่นี่ไม่ได้",
                "Josh still owns prices. Retained commerce values may differ from the current Josh price. Saving is unavailable here.",
              )}
            </Alert>
          )}
          <form
            ref={formElement}
            className="space-y-4"
            onSubmit={review}
            noValidate
          >
            <div className="grid gap-4 md:grid-cols-2">
              {editKeys.map((k) => (
                <Panel key={k}>
                  <div className="p-4 space-y-3">
                    <TaskSelect
                      label={label(k) + text(" — การเปลี่ยน", " — change")}
                      name={k + "-mode"}
                      value={form.fields[k].mode}
                      disabled={
                        pending ||
                        stale ||
                        source.data?.ownership !== "commerce"
                      }
                      onChange={(e) =>
                        update({
                          ...form,
                          fields: {
                            ...form.fields,
                            [k]: {
                              ...form.fields[k],
                              mode: e.target.value as "keep" | "set" | "clear",
                            },
                          },
                        })
                      }
                    >
                      <option value="keep">
                        {text("คงค่าเดิม", "Keep current value")}
                      </option>
                      <option value="set">
                        {text("ตั้งค่า", "Set value")}
                      </option>
                      <option value="clear">
                        {text("ล้างค่า", "Clear value")}
                      </option>
                    </TaskSelect>
                    {form.fields[k].mode === "set" ? (
                      <TaskInput
                        label={label(k) + text(" — ค่าใหม่", " — new value")}
                        name={k}
                        type="number"
                        inputMode={k === "moq" ? "numeric" : "decimal"}
                        required
                        step={k === "moq" ? 1 : 0.01}
                        min={0}
                        max={k === "moq" ? 2147483647 : 9999999999.99}
                        value={form.fields[k].value}
                        error={fieldErrors[k]}
                        disabled={
                          pending ||
                          stale ||
                          source.data?.ownership !== "commerce"
                        }
                        onChange={(e) =>
                          update({
                            ...form,
                            fields: {
                              ...form.fields,
                              [k]: { ...form.fields[k], value: e.target.value },
                            },
                          })
                        }
                        help={
                          k === "moq"
                            ? text(
                                "จำนวนเต็มตั้งแต่ 0 ถึง 2147483647 ตามช่องจัดเก็บเดิม",
                                "Whole number from 0 to 2147483647, matching existing storage",
                              )
                            : text(
                                "ไม่เกินสองตำแหน่งทศนิยม สูงสุด 9999999999.99 ตามช่องจัดเก็บเดิม",
                                "At most two decimals, up to 9999999999.99, matching existing storage",
                              )
                        }
                      />
                    ) : (
                      <p>
                        {form.fields[k].mode === "clear"
                          ? text(
                              "บันทึกเป็นไม่มีค่า ไม่ใช่ศูนย์",
                              "Stores no value; zero is a separate value",
                            )
                          : text(
                              "ช่องนี้จะไม่ถูกส่ง ค่าเดิมจะคงอยู่",
                              "This field is omitted; its current value stays",
                            )}
                      </p>
                    )}
                  </div>
                </Panel>
              ))}
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={
                pending || stale || source.data.ownership !== "commerce"
              }
            >
              {text("ตรวจการเปลี่ยนก่อนบันทึก", "Review price edit")}
            </Button>
          </form>
        </>
      ) : null}
    </>
  );
}
function useWriter(owner: string) {
  const mutation = useMutation(),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useUnsavedChanges(mutation.busy);
  const write = (job: ManualPriceJob) =>
    mutation.run(async () => {
      if (job.owner !== owner) throw Error("Account identity changed");
      try {
        storeManualJob(job);
      } catch {
        throw Error(
          text(
            "เก็บคำขอสำหรับกู้คืนไม่ได้ ยังไม่ส่งการเปลี่ยน ตรวจคำขอเดิมก่อนลองอีกครั้ง",
            "Recovery intent could not be saved. No change was sent. Check original requests before trying again.",
          ),
        );
      }
      try {
        const r = verifyManualPriceReceipt(
          await api.post(endpoint + "/actions", job.packet),
          job.packet,
        );
        if (r.updatedBy !== owner)
          throw Error("Outcome belongs to another actor");
        return r;
      } catch (e) {
        if ((e as { status?: number }).status === 409) {
          try {
            storeManualJob({ ...job, conflict: true });
          } catch {
            /* Retain original intent. */
          }
        }
        throw Error(
          text(
            "ยังยืนยันผลแก้ราคาไม่ได้ ตรวจคำขอเดิมก่อนส่งอีกครั้ง",
            "Edit outcome is unverified. Check the original request before retrying.",
          ),
        );
      }
    });
  return { ...mutation, mounted, write };
}
function Review({ owner, sku }: { owner: string; sku: string }) {
  const navigate = useNavigate(),
    [selection] = useState(() => readManualSelection(owner, sku)),
    [confirmed, setConfirmed] = useState(false),
    writer = useWriter(owner);
  const source = useAsync(
    async () =>
      selection
        ? verifyManualPriceReview(
            await api.post(endpoint + "/review", selection),
            selection,
          )
        : null,
    [sku],
  );
  const requests = usePriceRequests(owner),
    pending =
      requests.edits.some((j) => j.packet.sku === sku) ||
      requests.approvals.some((j) =>
        j.packet.changes.some((c) => c.sku === sku),
      ),
    review = source.data;
  useEffect(() => {
    if (source.loading) setConfirmed(false);
  }, [source.loading]);
  async function save() {
    if (
      !review ||
      !selection ||
      !confirmed ||
      pending ||
      source.loading ||
      source.error ||
      writer.busy ||
      review.ownership !== "commerce"
    )
      return;
    const packet = manualPricePacketSchema.parse({
        ...selection,
        requestId: crypto.randomUUID(),
      }),
      result = await writer.write({ owner, packet, review, conflict: false });
    if (
      writer.mounted.current &&
      (result.ok ||
        readManualJobs(owner).some(
          (j) => j.packet.requestId === packet.requestId,
        ))
    )
      navigate(outcome(packet.requestId));
  }
  return (
    <>
      <PageHeader
        title={text("ทบทวนการแก้ราคา", "Review product price edit")}
      />
      <WorkspaceLink to={manualPriceEditUrl(sku)}>
        {text("กลับไปแก้ค่าที่เลือก", "Back to selected edit")}
      </WorkspaceLink>
      <PriceRequestLinks owner={owner} sku={sku} />
      <ErrorText error={source.error} onRetry={source.reload} />
      <ErrorText error={writer.error} />
      {writer.busy && (
        <p role="status">
          {text(
            "กำลังบันทึกคำขอเดิม กรุณารอผลยืนยัน",
            "Saving the original request. Waiting for a confirmed outcome.",
          )}
        </p>
      )}
      {source.loading ? (
        <Loading variant="detail" />
      ) : source.error ? (
        <Alert tone="warn">
          {text(
            "ข้อมูลเดิมยังไม่ผ่านการตรวจปัจจุบัน จึงยังส่งการเปลี่ยนไม่ได้",
            "Retained evidence has not passed the current check. No edit can be sent.",
          )}
        </Alert>
      ) : !review ? (
        <Empty>
          {text(
            "ไม่มีการแก้ที่เลือกในบัญชีนี้ กลับไปเลือกค่าก่อน",
            "No selected edit for this account. Return to choose values.",
          )}
        </Empty>
      ) : (
        <>
          <Evidence item={review.item} review={review} />
          <Scope />
          {review.ownership !== "commerce" && (
            <Alert tone="warn">
              {text(
                "ร้านค้ายังดูแลราคาเอง บันทึกที่นี่ไม่ได้",
                "Josh still owns prices. Saving is unavailable here.",
              )}
            </Alert>
          )}
          <label className="flex min-h-11 items-start gap-3 rounded-lg border border-secondary-container p-3">
            <Checkbox
              aria-label={text(
                "ยืนยันตรวจการแก้ราคาแล้ว",
                "Confirm reviewed price edit",
              )}
              checked={confirmed}
              disabled={writer.busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              {text(
                "ฉันตรวจค่าปัจจุบัน ค่าหลังบันทึก และช่องที่คงไว้หรือล้างแล้ว",
                "I reviewed current and resulting values, including fields kept or cleared.",
              )}
            </span>
          </label>
          <Button
            variant="primary"
            disabled={
              !confirmed ||
              pending ||
              writer.busy ||
              review.ownership !== "commerce"
            }
            onClick={() => void save()}
          >
            {writer.busy
              ? text("กำลังบันทึก", "Saving price edit")
              : text("บันทึกการแก้ที่ตรวจแล้ว", "Save reviewed price edit")}
          </Button>
        </>
      )}
    </>
  );
}
function Receipt({ receipt }: { receipt: ManualPriceReceipt }) {
  const review: ManualPriceReview = {
    item: receipt.before,
    patch: receipt.packet.patch,
    after: receipt.after,
    ownership: "commerce",
    capturedAt: receipt.savedAt,
  };
  return (
    <>
      <Alert tone="ok">
        <strong>
          {text("บันทึกการแก้ราคาแล้ว 1 รายการ", "Saved price edit for 1 SKU")}
        </strong>
        <p>
          {text(
            "ยืนยันจากผลบันทึกจริงของคำขอเดิม",
            "Confirmed by the original request’s persisted outcome",
          )}
        </p>
      </Alert>
      <Chip tone="ok">{text("บันทึกแล้ว", "Saved")}</Chip>
      <Evidence item={receipt.before} review={review} historical />
      <p>
        {text(
          "ผลนี้ยืนยันการแก้ของคำขอเดิม ราคาอาจเปลี่ยนหลังจากนั้น เปิดหน้าตรวจเพื่อดูค่าปัจจุบัน",
          "This receipt confirms the original edit. Prices may have changed since; inspect the product for current values.",
        )}
      </p>
      <WorkspaceLink to={manualPriceViewUrl(receipt.before.sku)}>
        {text(
          "ตรวจราคาปัจจุบันของสินค้านี้",
          "Inspect this product’s current price",
        )}
      </WorkspaceLink>
      <p className="break-words">
        {text("ผู้บันทึก: ", "Saved by: ")}
        {receipt.updatedBy} · {receipt.savedAt} ·{" "}
        {text("ที่มา: ทีมงาน", "Source: staff")}
      </p>
      <Alert tone="info">
        {text(
          "บันทึกราคาและคิวเหตุการณ์แล้ว การรับข้อมูลของร้านยังไม่ยืนยัน",
          "Price and event queue committed. Shop delivery remains unverified.",
        )}
      </Alert>
    </>
  );
}
function Recovery({ owner, id }: { owner: string; id: string }) {
  const job = usePriceRequests(owner).edits.find(
      (j) => j.packet.requestId === id,
    ),
    [confirmed, setConfirmed] = useState(false),
    writer = useWriter(owner);
  const result = useAsync(async () => {
    try {
      const receipt = verifyManualPriceReceipt(
        await api.get(endpoint + "/requests/" + id),
        job?.packet,
      );
      if (receipt.requestId !== id || receipt.updatedBy !== owner)
        throw Error("Returned outcome differs from this account or request");
      return { receipt, absent: false };
    } catch (e) {
      if ((e as { status?: number }).status === 404)
        return { receipt: null, absent: true };
      throw e;
    }
  }, [id, owner]);
  useEffect(() => {
    if (result.loading) setConfirmed(false);
  }, [result.loading]);
  useEffect(() => {
    const r = result.data?.receipt;
    if (r && !result.loading && !result.error) {
      try {
        clearManualDraft(owner, r);
        clearManualJob(owner, id);
      } catch {
        /* The persisted outcome remains authoritative. */
      }
    }
  }, [result.data, result.loading, result.error, owner, id]);
  async function retry() {
    if (
      !job ||
      !result.data?.absent ||
      result.loading ||
      result.error ||
      !confirmed ||
      job.conflict ||
      writer.busy
    )
      return;
    setConfirmed(false);
    const saved = await writer.write(job);
    if (saved.ok && writer.mounted.current) result.reload();
    else if (writer.mounted.current) result.reload();
  }
  return (
    <>
      <PageHeader
        title={text("ผลการแก้ราคา", "Price edit outcome")}
        subtitle={id}
      />
      <WorkspaceLink to={home}>
        {text("กลับราคาปัจจุบัน", "Back to current prices")}
      </WorkspaceLink>
      <ErrorText error={result.error} onRetry={result.reload} />
      <ErrorText error={writer.error} />
      {result.loading ? (
        <Loading variant="detail" />
      ) : result.error ? null : result.data?.receipt ? (
        <Receipt receipt={result.data.receipt} />
      ) : (
        <>
          <Alert tone="warn">
            {text(
              "ยังไม่พบผลบันทึกสำหรับบัญชีนี้ ไม่ถือว่าสำเร็จ",
              "No committed edit found for this account. Completion is unconfirmed.",
            )}
          </Alert>
          {job ? (
            <>
              <p>
                {text(
                  "ฉบับที่ตรวจสำหรับคำขอเดิม ค่าปัจจุบันยังไม่ยืนยัน",
                  "Evidence retained for the original request. Current values are unverified.",
                )}
              </p>
              <Evidence item={job.review.item} review={job.review} historical />
              <Scope />
              {job.conflict ? (
                <Alert tone="warn">
                  <p>
                    {text(
                      "ข้อมูลเปลี่ยนแล้ว ไม่ส่งคำขอเก่าซ้ำ ต้องตรวจค่าปัจจุบันอีกครั้ง",
                      "Evidence changed. Do not resend this stale request. Inspect current values again.",
                    )}
                  </p>
                  <Button
                    onClick={() => {
                      try {
                        clearManualJob(owner, id);
                      } catch {
                        /* Keep original intent if removal fails. */
                      }
                    }}
                  >
                    {text(
                      "ปิดคำขอเก่าที่ไม่บันทึก",
                      "Dismiss uncommitted stale edit",
                    )}
                  </Button>
                </Alert>
              ) : (
                <>
                  <label className="flex min-h-11 items-start gap-3 rounded-lg border border-secondary-container p-3">
                    <Checkbox
                      aria-label={text(
                        "ยืนยันส่งการแก้เดิมซ้ำ",
                        "Confirm exact original edit retry",
                      )}
                      checked={confirmed}
                      disabled={writer.busy}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    <span>
                      {text(
                        "ตรวจแล้วว่ายังไม่มีผล และต้องการส่งเฉพาะการแก้เดิม",
                        "I checked that no outcome is recorded and want to retry only the exact original edit.",
                      )}
                    </span>
                  </label>
                  <Button
                    disabled={!confirmed || writer.busy}
                    onClick={() => void retry()}
                  >
                    {writer.busy
                      ? text("กำลังส่งคำขอเดิม", "Retrying original edit")
                      : text(
                          "ส่งการแก้เดิมหลังตรวจผลแล้ว",
                          "Retry checked original edit",
                        )}
                  </Button>
                </>
              )}
            </>
          ) : (
            <Empty>
              {text(
                "ไม่มีคำขอกู้คืนในเครื่องนี้ กลับรายการเพื่อตรวจใหม่",
                "No local recovery intent. Return to current prices to inspect again.",
              )}
            </Empty>
          )}
          <Button
            onClick={() => {
              setConfirmed(false);
              result.reload();
            }}
          >
            {text(
              "ตรวจผลคำขอเดิมอีกครั้ง",
              "Check original edit outcome again",
            )}
          </Button>
        </>
      )}
    </>
  );
}
export function CurrentPrices({
  owner = session.claims()?.sub ?? "",
  role = session.claims()?.role ?? "",
}: {
  owner?: string;
  role?: string;
}) {
  useUiLocale();
  const location = useLocation(),
    tail = location.pathname.slice(home.length);
  if (!owner || !canApprovePrices(role))
    return (
      <ErrorText
        error={text(
          "บัญชีนี้ไม่มีสิทธิ์แก้ราคา",
          "This account cannot access price edits",
        )}
      />
    );
  let content;
  if (tail === "" || tail === "/") content = <List key={owner} owner={owner} />;
  else {
    const request = tail.match(/^\/requests\/([^/]+)$/),
      id = priceRequestId.safeParse(request?.[1]),
      item = tail.match(/^\/([^/]+)(?:\/(edit|review))?$/),
      decodedSku = item ? priceSkuFromToken(item[1]) : null,
      sku =
        decodedSku && manualPriceSkuSchema.safeParse(decodedSku).success
          ? decodedSku
          : null;
    if (id.success)
      content = <Recovery key={owner + id.data} owner={owner} id={id.data} />;
    else if (sku && item)
      content = !item[2] ? (
        <Inspect key={owner + location.key} owner={owner} sku={sku} />
      ) : item[2] === "edit" ? (
        <Edit key={owner + location.key} owner={owner} sku={sku} />
      ) : (
        <Review key={owner + location.key} owner={owner} sku={sku} />
      );
    else
      content = (
        <>
          <Alert tone="danger">
            {text("ไม่พบหน้าการแก้ราคานี้", "Price edit page not found")}
          </Alert>
          <WorkspaceLink to={home}>
            {text("เปิดราคาปัจจุบัน", "Open current prices")}
          </WorkspaceLink>
        </>
      );
  }
  return (
    <CommercePage>
      <div className="min-w-0 space-y-4 [&_button]:min-h-11 [&_button]:whitespace-normal">
        {content}
      </div>
    </CommercePage>
  );
}
