// ui-caption-migration: literal captions only
// ui-metadata-migration: static labels and UI notices only
import { FormEvent, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import {
  Alert,
  Button,
  Chip,
  DetailSection,
  Empty,
  ErrorText,
  Field,
  FormPanel,
  Hint,
  Input,
  KeyValueGrid,
  Loading,
  Page,
  PageHeader,
  Panel,
  PanelHead,
  Select,
  Span,
  Textarea,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  fmt,
} from "@cp/ui";
import {
  joshActionsApi,
  joshAdmin,
  joshProductApi,
  JoshProductDetail as JoshProductDetailType,
  productImagesApi,
  productPricesApi,
  session,
} from "../../lib/api";
import { useAsync } from "../hooks";
import { WorkspaceLink } from "../WorkspaceParts";
import { commerceText as text } from "../commerce-copy";
import {
  canEditProductContent,
  contentHomeUrl,
} from "./product-content-editor/content-editor-routing";
import {
  legacyOwnedValue,
  readLegacyOwnedSources,
  type LegacyOwnedSources,
} from "./product-content-editor/legacy-owned-sources";

// ui-copy-migration: only literal UI copy and notification templates
import {
  uiText as __uiText,
  formatUiMessage as __uiMessage,
  useUiLocale as __useUiLocale,
} from "@cp/ui";
const STATUS: Record<string, string> = {
  active: "เปิดขาย",
  draft: "ฉบับร่าง (ยังไม่เปิดขาย)",
  inactive: "ปิดขาย",
};
const statusText = (s: string) => (STATUS[s] ? __uiText(STATUS[s]) : s);
const show = (v: unknown) =>
  v == null || v === ""
    ? "—"
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);

/** Stage 4f: josh's weekday rows → "MONDAY,FRIDAY" (empty = every day); restock date → YYYY-MM-DD. */
const days = (v: unknown) =>
  Array.isArray(v)
    ? v
        .map((d) =>
          typeof d === "object" && d ? (d as { day?: string }).day : d,
        )
        .join(",")
    : v;
const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : v);

/** `ordering`: only editable once commerce owns ordering (josh's own form has no such field). */
const EDIT_FIELDS: {
  key: string;
  label: string;
  get: (p: JoshProductDetailType) => unknown;
  kind?: "number" | "text" | "long";
  norm?: (v: unknown) => unknown;
  ordering?: boolean;
}[] = [
  {
    key: "brand_name",
    get label() {
      return __uiText("แบรนด์");
    },
    get: (p) => p.brand_name,
  },
  {
    key: "selling_unit",
    get label() {
      return __uiText("หน่วยขาย");
    },
    get: (p) => p.selling_unit,
  },
  {
    key: "pack_size",
    get label() {
      return __uiText("ขนาดแพ็ก");
    },
    get: (p) => p.pack_size,
  },
  {
    key: "storage_temperature",
    get label() {
      return __uiText("อุณหภูมิเก็บ");
    },
    get: (p) => p.storage_temperature,
  },
  {
    key: "selling_unit_price",
    get label() {
      return __uiText("ราคาขาย (รวม VAT)");
    },
    get: (p) => p.selling_unit_price,
    kind: "number",
  },
  {
    key: "original_price",
    get label() {
      return __uiText("ราคาตั้ง");
    },
    get: (p) => p.original_price,
    kind: "number",
  },
  {
    key: "low_stock_threshold",
    get label() {
      return __uiText("เตือนใกล้หมดที่");
    },
    get: (p) => p.low_stock_threshold,
    kind: "number",
  },
  {
    key: "reorder_quantity",
    get label() {
      return __uiText("จำนวนสั่งเติม");
    },
    get: (p) => p.reorder_quantity,
    kind: "number",
  },
  {
    key: "buying_price",
    get label() {
      return __uiText("ต้นทุน");
    },
    get: (p) => p.buying_price,
    kind: "number",
  },
  {
    key: "product_short_code",
    get label() {
      return __uiText("รหัสย่อ");
    },
    get: (p) => p.product_short_code,
  },
  {
    key: "maximum_shelf_life",
    get label() {
      return __uiText("อายุสินค้าสูงสุด");
    },
    get: (p) => p.maximum_shelf_life,
  },
  {
    key: "is_organic",
    get label() {
      return __uiText("ออร์แกนิก");
    },
    get: (p) => p.is_organic,
  },
  {
    key: "expiration_info",
    get label() {
      return __uiText("ข้อมูลวันหมดอายุ");
    },
    get: (p) => p.expiration_info,
    kind: "long",
  },
  {
    key: "usage_direction",
    get label() {
      return __uiText("วิธีใช้");
    },
    get: (p) => p.usage_direction,
    kind: "long",
  },
  {
    key: "best_paired_food",
    get label() {
      return __uiText("เข้ากับอาหาร");
    },
    get: (p) => p.best_paired_food,
    kind: "long",
  },
  {
    key: "unit_ratio",
    get label() {
      return __uiText("อัตราส่วนหน่วย");
    },
    get: (p) => p.unit_ratio,
  },
  {
    key: "sub_packing_unit",
    get label() {
      return __uiText("หน่วยแพ็กย่อย");
    },
    get: (p) => p.sub_packing_unit,
  },
  {
    key: "product_unit",
    get label() {
      return __uiText("หน่วยสินค้า");
    },
    get: (p) => p.product_unit,
  },
  {
    key: "expected_restock_at",
    get label() {
      return __uiText("คาดว่าของเข้า (YYYY-MM-DD)");
    },
    get: (p) => p.expected_restock_at,
    norm: day,
  },
  {
    key: "delivery_dates",
    get label() {
      return __uiText("วันที่ส่งได้ (MONDAY,FRIDAY … ว่าง = ทุกวัน)");
    },
    get: (p) => p.delivery_dates,
    norm: days,
    ordering: true,
  },
];

/**
 * `content`: commerce's own copy of the content keys once it owns product content (stage 4b) — shown over josh's copy,
 * which follows a moment later.
 */
function ProductEditor({
  p,
  sources,
  ordering,
  categories,
  onSaved,
  onClose,
}: {
  p: JoshProductDetailType;
  sources: LegacyOwnedSources;
  ordering: boolean;
  categories: {
    id: string;
    category_name_th: string | null;
    category_path: string | null;
  }[];
  onSaved: (msg: string) => void;
  onClose: () => void;
}) {
  __useUiLocale();
  const shown = EDIT_FIELDS.filter((f) => !f.ordering || ordering);
  const valueOf = (f: (typeof EDIT_FIELDS)[number]) => {
    const v = legacyOwnedValue(f.key, sources, () => f.get(p));
    return f.norm ? f.norm(v) : v;
  };
  const initial = (): Record<string, string> => ({
    ...Object.fromEntries(
      shown.map((f) => [f.key, valueOf(f) == null ? "" : String(valueOf(f))]),
    ),
    product_status: String(
      legacyOwnedValue("product_status", sources, () => p.product_status) ?? "",
    ),
    category_id: p.category_id ?? "",
  });
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const start = initial();
  const changed = Object.keys(v).filter((k) => v[k] !== start[k]);
  const fieldLabel = (k: string) =>
    k === "product_status"
      ? __uiText("สถานะ")
      : k === "category_id"
        ? __uiText("หมวด")
        : (EDIT_FIELDS.find((f) => f.key === k)?.label ?? k);
  const changedLabels = changed.map(fieldLabel).join(", ");

  async function save() {
    const fields: Record<string, unknown> = {};
    for (const k of changed) {
      const kind = EDIT_FIELDS.find((f) => f.key === k)?.kind;
      if (kind === "number") {
        const n = Number(v[k]);
        if (v[k].trim() === "" || !Number.isFinite(n) || n < 0) {
          setErr(__uiText("{0}: ต้องเป็นตัวเลขไม่ติดลบ", { "0": fieldLabel(k) }));
          return;
        }
        fields[k] = n;
      } else fields[k] = k === "category_id" && v[k] === "" ? null : v[k];
    }
    if (
      !window.confirm(
        __uiText(
          "บันทึก {0} ช่องของ {1}?\n\n{2}\n\n(ร้านค้าออนไลน์บันทึกในนามของคุณ และเก็บอีเมลของคุณไว้ในประวัติการแก้ไข · ลูกค้าเห็นทันที)",
          {
            "0": changed.length,
            "1": p.product_inventory_sku,
            "2": changedLabels,
          },
        ),
      )
    )
      return;
    setBusy(true);
    setErr("");
    try {
      await joshActionsApi.updateProduct(p.product_inventory_id, fields);
      onClose();
      onSaved(__uiText("บันทึก {0} แล้ว ({1})", { "0": p.product_inventory_sku, "1": changedLabels }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPanel
      title={__uiText("แก้สินค้า {0}", { "0": p.product_inventory_sku })}
      icon="edit"
      cols={2}
      error={err}
      busy={busy}
      onSubmit={save}
      onCancel={onClose}
      submitLabel={__uiText("บันทึก{0}", {
        "0": changed.length ? ` (${changed.length})` : "",
      })}
      description={
        sources.fields
          ? text(
              "แก้ช่องสินค้าอื่นตามสิทธิ์เดิม ช่องที่ระบบนี้ดูแลแต่ยังไม่ได้บันทึกจะไม่ใช้ค่าจากร้านค้าออนไลน์มาเติม · ชื่อ รายละเอียด ส่วนผสม และสารก่อภูมิแพ้แก้ที่งานแก้ข้อความสินค้า · ราคาเฉพาะลูกค้าและราคาสัญญาแก้ที่หน้าราคาเฉพาะลูกค้าและราคาสัญญา",
              "Edit other product fields with your existing permissions. Fields this system keeps but has not saved yet are not filled from the online shop. Names, descriptions, ingredients and allergens are edited in the product content task; customer and contract prices on the customer and contract prices page.",
            )
          : __uiText(
              "ช่องว่างไม่ลบค่าเดิม · ราคาเฉพาะลูกค้าและราคาสัญญาแก้ที่หน้าราคาเฉพาะลูกค้าและราคาสัญญา",
            )
      }
    >
      <Field label={__uiText("สถานะ")}>
        <Select
          value={v.product_status}
          onChange={(e) => setV({ ...v, product_status: e.target.value })}
        >
          {Object.keys(STATUS).map((k) => (
            <option key={k} value={k}>
              {statusText(k)}
            </option>
          ))}
          {!(v.product_status in STATUS) && (
            <option value={v.product_status}>{v.product_status || "—"}</option>
          )}
        </Select>
      </Field>
      <Field label={__uiText("หมวด")}>
        <Select
          value={v.category_id}
          onChange={(e) => setV({ ...v, category_id: e.target.value })}
        >
          <option value="">{__uiText("— ไม่มีหมวด —")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.category_path ?? c.category_name_th}
            </option>
          ))}
        </Select>
      </Field>
      {shown.map((f) => (
        <div key={f.key}>
          {f.kind === "long" ? (
            <Span>
              <Field label={f.label}>
                <Textarea mono={false}
                  rows={3}
                  value={v[f.key]}
                  onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                />
              </Field>
            </Span>
          ) : (
            <Field label={f.label}>
              <Input
                inputMode={f.kind === "number" ? "decimal" : undefined}
                value={v[f.key]}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              />
            </Field>
          )}
        </div>
      ))}
    </FormPanel>
  );
}

/** Product detail page (from expanded row). */
export function JoshProductDetail() {
  __useUiLocale();
  const { id = "" } = useParams();
  const location = useLocation();
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const detail = useAsync(() => joshProductApi.detail(id), [id]);
  const categories = useAsync(() => joshProductApi.categories(), []);
  const p = detail.data;
  // Native source failure is distinct from a missing row; neither seeds copied editing values.
  const content = useAsync(
    () =>
      p
        ? readLegacyOwnedSources(p.product_inventory_sku)
        : Promise.resolve(null),
    [p?.product_inventory_sku, p?.updated_at],
  );

  const backTo = `${location.state?.from ?? "/reports/products"}${location.state?.search ?? ""}`;

  async function decide(action: "approve" | "reject") {
    if (!p) return;
    const verb = action === "approve" ? "อนุมัติ" : "ไม่อนุมัติ";
    if (
      !window.confirm(
        __uiText(
          "{0}ข้อมูลจากระบบขาย (ERP) ของสินค้า {1}?\n\n{2} (ร้านค้าออนไลน์บันทึกในนามของคุณ และเก็บอีเมลของคุณไว้ในประวัติการแก้ไข)",
          {
            "0": __uiText(verb),
            "1": p.product_inventory_sku,
            "2": __uiText(
              action === "approve"
                ? "สินค้าฉบับร่างจะเปิดขาย และใช้ค่าที่ระบบขายส่งมาทันที"
                : "ไม่ใช้ค่าที่ระบบขายส่งมา สินค้าคงค่าเดิม",
            ),
          },
        ),
      )
    )
      return;
    setBusy(true);
    setMsg("");
    try {
      const r =
        action === "approve"
          ? await joshActionsApi.approveProducts([p.product_inventory_id])
          : await joshActionsApi.rejectProducts([p.product_inventory_id]);
      setMsg(
        __uiMessage("{0}แล้ว: {1}", { "0": verb, "1": JSON.stringify(r) }),
      );
      detail.reload();
      categories.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        back={{ to: backTo, label: "รายงานสินค้า" }}
        title={<span className="font-mono">{p ? p.product_inventory_sku : id}</span>}
        badge={
          p && (
            <Chip tone={p.product_status === "active" ? "ok" : "muted"} dot>
              {statusText(p.product_status)}
            </Chip>
          )
        }
        subtitle={
          p
            ? [p.name_th || p.name_en, p.brand_name, p.pack_size]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        actions={
          p && (
            <div className="flex min-w-0 flex-wrap gap-3">
              {canEditProductContent(session.claims()?.role ?? "") && (
                <WorkspaceLink to={contentHomeUrl(p.product_inventory_id)}>
                  {text("แก้ข้อความสินค้า", "Edit product content")}
                </WorkspaceLink>
              )}
              {!editing && (
                <Button
                  icon="edit"
                  disabled={
                    detail.loading ||
                    !!detail.error ||
                    content.loading ||
                    !!content.error ||
                    !content.data
                  }
                  onClick={() => setEditing(true)}
                >
                  {text("แก้ข้อมูลสินค้าอื่น", "Edit other product fields")}
                </Button>
              )}
            </div>
          )
        }
      />

      <ErrorText error={detail.error} onRetry={detail.reload} />
      <ErrorText error={content.error} onRetry={content.reload} />
      {msg && (
        <Alert tone="info" onClose={() => setMsg("")}>
          {__uiText(msg)}
        </Alert>
      )}

      {detail.loading && !p ? (
        <Loading />
      ) : !p ? (
        <Panel>
          <Empty>{__uiText("ไม่พบสินค้า")}</Empty>
        </Panel>
      ) : (
        <>
          <ProductImages
            p={p}
            onSaved={(m) => {
              setMsg(m);
              detail.reload();
            }}
          />

          <Panel className="p-4">
            <DetailSection title={__uiText("ราคาและข้อมูลสินค้า")} icon="sell">
              <KeyValueGrid
                items={[
                  { label: __uiText("ราคาขาย"), value: fmt.baht(p.selling_unit_price) },
                  { label: __uiText("ราคาสั่ง"), value: fmt.baht(p.ordering_price) },
                  { label: __uiText("ราคาตั้ง"), value: fmt.baht(p.original_price) },
                  { label: __uiText("สั่งขั้นต่ำ"), value: show(p.moq) },
                  { label: __uiText("รหัสซัพพลายเออร์"), value: show(p.sup_code), mono: true },
                  { label: __uiText("อุณหภูมิเก็บ"), value: show(p.storage_temperature) },
                  { label: __uiText("ประเทศต้นทาง"), value: show(p.country_code_source), mono: true },
                  { label: __uiText("ประเภท VAT"), value: show(p.vat_type), mono: true },
                ]}
              />
            </DetailSection>
          </Panel>

          {content.loading && <Loading variant="detail" />}
          {!!content.data?.missing.length && (
            <Alert tone="warn">
              {text(
                "ข้อมูลบางส่วนที่ระบบนี้ดูแลยังไม่ได้บันทึก ช่องที่ขาดจะไม่ใช้ค่าจากร้านค้าออนไลน์มาเติมในแบบแก้",
                "Some records this system keeps are not saved yet. Missing editing values are not filled from the online shop's copy.",
              )}
            </Alert>
          )}
          {editing &&
            !detail.loading &&
            !detail.error &&
            !content.loading &&
            !content.error &&
            content.data && (
              <ProductEditor
                key={p.updated_at}
                p={p}
                sources={content.data}
                ordering={content.data.ordering}
                categories={categories.data ?? []}
                onClose={() => setEditing(false)}
                onSaved={(m) => {
                  setMsg(m);
                  detail.reload();
                  content.reload();
                }}
              />
            )}

          {p.pendingChanges && p.pendingChanges.length > 0 && (
            <Panel>
              <PanelHead
                icon="pending_actions"
                title={__uiText("ข้อมูลจากระบบขาย (ERP) รออนุมัติ")}
                sub={__uiText("ส่งมาเมื่อ {0}", { "0": fmt.when(p.erp_pending_at) })}
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => decide("reject")}
                    >
                      {__uiText("ไม่อนุมัติ")}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      onClick={() => decide("approve")}
                    >
                      {__uiText("อนุมัติ")}
                    </Button>
                  </>
                }
              />
              <div className="p-4">
                <Table>
                  <THead>
                    <TH>{__uiText("ช่องข้อมูล")}</TH>
                    <TH>{__uiText("ค่าปัจจุบัน")}</TH>
                    <TH>{__uiText("ค่าที่ระบบขายส่งมา")}</TH>
                  </THead>
                  <TBody>
                    {p.pendingChanges.map((c) => (
                      <TR key={c.field}>
                        <TD kind="code">{c.field}</TD>
                        <TD>{show(c.current)}</TD>
                        <TD>
                          {c.changed ? (
                            <strong>{show(c.pending)}</strong>
                          ) : (
                            show(c.pending)
                          )}
                          {c.changed && (
                            <Chip tone="warn" dot className="ml-2">
                              {__uiText("เปลี่ยน")}
                            </Chip>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Panel>
          )}
        </>
      )}
    </Page>
  );
}

/**
 * Product images. Before stage 4e (COMMERCE_OWNS_CATALOG): josh's own PATCH /product/:id with only images — files to add
 * and `removed_media_ids`; josh keeps at most 3, stores them, makes thumbnails. Once commerce owns galleries
 * (COMMERCE_OWNS_PRODUCT_IMAGES): commerce's gallery (same bucket), sent to josh as product.images.snapshot.
 */
function ProductImages({
  p,
  onSaved,
}: {
  p: JoshProductDetailType;
  onSaved: (msg: string) => void;
}) {
  __useUiLocale();
  const gallery = useAsync(async () => {
    if (!(await productPricesApi.ownership()).productImages) return null;
    return productImagesApi.get(p.product_inventory_sku).then(
      (r) => r.images,
      () =>
        p.media.filter((m) => m.media_type === "image").map((m) => m.source),
    );
  }, [p.product_inventory_sku, p.updated_at]);
  const owned = gallery.data != null;
  const images = owned
    ? gallery.data!.map((url) => ({
        id: url,
        source: url,
        media_type: "image",
        sort_order: 0,
      }))
    : p.media.filter((m) => m.media_type === "image");
  const [removed, setRemoved] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const keep = images.filter((m) => !removed.includes(m.id)).length;
  const dirty = files.length > 0 || removed.length > 0;
  async function save() {
    if (keep + files.length > 3) return setErr(__uiText("รูปได้สูงสุด 3 รูป"));
    if (
      !window.confirm(
        __uiText("{0}{1}{2} ของ {3}? ลูกค้าเห็นทันที", {
          "0": files.length ? __uiText("เพิ่ม {0} รูป", { "0": files.length }) : "",
          "1": files.length && removed.length ? " · " : "",
          "2": removed.length ? __uiText("ลบ {0} รูป", { "0": removed.length }) : "",
          "3": p.product_inventory_sku,
        }),
      )
    )
      return;
    setBusy(true);
    setErr("");
    try {
      if (owned) {
        // Remove first so the 3-image limit counts what stays.
        if (removed.length)
          await productImagesApi.set(
            p.product_inventory_sku,
            images.filter((m) => !removed.includes(m.id)).map((m) => m.source),
          );
        if (files.length)
          await productImagesApi.upload(p.product_inventory_sku, files);
        gallery.reload();
      } else {
        const fields = { removed_media_ids: JSON.stringify(removed) };
        await (files.length
          ? joshAdmin.upload(
              "PATCH",
              `/product/${p.product_inventory_id}`,
              fields,
              files.map((file) => ({ field: "images", file })),
            )
          : joshAdmin.call(
              "PATCH",
              `/product/${p.product_inventory_id}`,
              fields,
            ));
      }
      setRemoved([]);
      setFiles([]);
      onSaved(__uiText("บันทึกรูปของ {0} แล้ว", { "0": p.product_inventory_sku }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHead
        icon="photo_library"
        title={__uiText("รูปสินค้า")}
        sub={__uiText("{0}/3 รูป", { "0": keep })}
        actions={
          dirty && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFiles([]);
                  setRemoved([]);
                  setErr("");
                }}
              >
                {__uiText("ยกเลิก")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon="cloud_upload"
                disabled={busy}
                onClick={save}
              >
                {busy ? __uiText("กำลังอัปโหลด…") : __uiText("บันทึกรูป")}
              </Button>
            </>
          )
        }
      />
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          {images.map((m) => {
            const gone = removed.includes(m.id);
            return (
              <figure
                key={m.id}
                className={`m-0 space-y-1 ${gone ? "opacity-35" : ""}`}
              >
                <img
                  src={m.source}
                  alt=""
                  width={120}
                  height={120}
                  className="object-cover rounded border border-secondary-container bg-surface-container-low w-[120px] h-[120px]"
                  onError={(e) => {
                    e.currentTarget.style.visibility = "hidden";
                  }}
                />
                <figcaption>
                  <Button
                    variant={gone ? "ghost" : "danger-ghost"}
                    size="sm"
                    icon={gone ? "undo" : "delete"}
                    onClick={() =>
                      setRemoved(
                        gone
                          ? removed.filter((x) => x !== m.id)
                          : [...removed, m.id],
                      )
                    }
                  >
                    {gone ? __uiText("ไม่ลบ") : __uiText("ลบ")}
                  </Button>
                </figcaption>
              </figure>
            );
          })}
          {!images.length && <Hint>{__uiText("ยังไม่มีรูป")}</Hint>}
        </div>
        <Field
          label={__uiText("เพิ่มรูป")}
          hint={
            files.length
              ? files.map((f) => f.name).join(", ")
              : __uiText("jpg / png / webp / gif — รวมแล้วไม่เกิน 3 รูป")
          }
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="text-xs file:mr-3 file:rounded-lg file:border file:border-secondary-container file:bg-surface-container-lowest file:px-3 file:py-1.5 file:text-xs"
          />
        </Field>
        {err && <Alert tone="danger">{err}</Alert>}
      </div>
    </Panel>
  );
}
