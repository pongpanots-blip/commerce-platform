import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Empty,
  Loading,
  PageHeader,
  Panel,
  TaskInput,
  TaskSelect,
  TaskTextarea,
  useUiLocale,
  useUnsavedChanges,
} from "@cp/ui";
import { z } from "zod";
import { api, session } from "../../../lib/api";
import { CommercePage } from "../../CommercePage";
import { WorkspaceLink } from "../../WorkspaceParts";
import { commerceText as text } from "../../commerce-copy";
import { useAsync, useMutation } from "../../hooks";
import { PlanningError as ErrorText } from "../planning/PlanningError";
import { priceRequestId } from "../../../../../commerce-platform/src/modules/commerce/product-prices/price-approval-contracts";
import {
  PRODUCT_CONTENT_EDITOR_API as endpoint,
  PRODUCT_CONTENT_EDIT_FIELDS as fields,
  productContentPacketSchema,
  productContentReadSchema,
  productContentSelectionSchema,
  productContentUpdateEnvelope,
  verifyProductContentReceipt,
  verifyProductContentReview,
  type ProductContentField,
  type ProductContentItem,
  type ProductContentReceipt,
  type ProductContentReview,
} from "../../../../../commerce-platform/src/modules/commerce/product-content-editor/product-content-editor-contracts";
import {
  CONTENT_JOURNAL_EVENT,
  clearAcknowledgedContentDraft,
  clearContentJob,
  contentFieldsFromForm,
  contentNameField,
  initialContentForm,
  readContentForm,
  readContentJobs,
  readContentSelection,
  storeContentForm,
  storeContentJob,
  storeContentSelection,
  type ContentForm,
  type ContentJob,
} from "./content-editor-journal";
import {
  canEditProductContent,
  contentEditUrl,
  contentHomeUrl,
  contentOutcomeUrl,
  contentReviewUrl,
} from "./content-editor-routing";

const label = (field: ProductContentField) =>
  ({
    product_name_th: text("ชื่อภาษาไทย", "Thai name"),
    product_name_en: text("ชื่อภาษาอังกฤษ", "English name"),
    product_description_th: text("รายละเอียดภาษาไทย", "Thai description"),
    product_description_en: text("รายละเอียดภาษาอังกฤษ", "English description"),
    ingredients: text("ส่วนผสม", "Ingredients"),
    allergens: text("สารก่อภูมิแพ้", "Allergens"),
  })[field];
const value = (stored: string | null | undefined) =>
  stored === undefined
    ? text("ยังไม่บันทึก", "Not recorded")
    : stored === null
      ? text("ล้างค่าแล้ว", "Cleared")
      : stored === ""
        ? text("บันทึกข้อความว่างไว้", "Recorded empty text")
        : stored;
const sourceLabel = (item: ProductContentItem) =>
  ({
    native: text("เนื้อหาที่บันทึกในระบบนี้", "Recorded commerce content"),
    archived_native: text(
      "เนื้อหาที่เก็บไว้ในระบบนี้",
      "Archived commerce content",
    ),
    copied_snapshot: text("สำเนาแค็ตตาล็อก", "Catalog snapshot"),
    unavailable: text("ยังไม่มีเนื้อหาที่บันทึก", "No recorded content row"),
  })[item.evidenceSource];
function Scope() {
  return (
    <Alert tone="info">
      <p>
        {text(
          "แก้ชื่อสองภาษา รายละเอียดสองภาษา ส่วนผสม และสารก่อภูมิแพ้ของสินค้านี้ ช่องที่คงไว้จะไม่ถูกส่ง ชื่อต้องไม่ว่าง ส่วนข้อความอื่นเลือกได้ว่าจะตั้งค่าหรือล้างค่า",
          "Edit this product’s two names, two descriptions, ingredients and allergens. Kept fields are omitted. Names must be nonblank; other text can be set or cleared.",
        )}
      </p>
      <p>
        {text(
          "ทบทวนก่อนบันทึก ผลสำเร็จยืนยันจากคำขอที่บันทึกจริง การส่งต่อไปยังร้านยังไม่ยืนยัน",
          "Review before saving. Success is confirmed by the persisted original request; delivery to the shop remains unverified.",
        )}
      </p>
    </Alert>
  );
}
function Evidence({
  item,
  review,
  historical = false,
  committed = false,
}: {
  item: ProductContentItem;
  review?: ProductContentReview;
  historical?: boolean;
  committed?: boolean;
}) {
  return (
    <Panel>
      <div className="min-w-0 space-y-4 p-4">
        <h2 className="break-words font-semibold">{item.sku}</h2>
        <p className="break-words text-sm">
          {sourceLabel(item)} · {text("ที่มาที่บันทึก", "Recorded source")}:{" "}
          {item.currentSource ?? text("ไม่ระบุ", "Not recorded")} ·{" "}
          {text("เวลาแก้แถว", "Row updated at")}:{" "}
          {item.currentUpdatedAt ?? text("ไม่ระบุ", "Not recorded")}
        </p>
        <p className="text-sm">
          {text(
            "เวลาบันทึกไม่ใช่การรับรองความใหม่ของแหล่งข้อมูล",
            "A recorded timestamp does not verify source freshness.",
          )}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <section className="min-w-0 space-y-2" key={field}>
              <h3 className="font-medium">{label(field)}</h3>
              <p className="whitespace-pre-wrap break-words">
                <span className="font-medium">
                  {historical
                    ? text("ฉบับที่ตรวจ: ", "Reviewed baseline: ")
                    : text("ที่บันทึกอยู่: ", "Recorded value: ")}
                </span>
                {value(item.current[field])}
              </p>
              {review && (
                <>
                  <p className="whitespace-pre-wrap break-words">
                    {text("การเปลี่ยน: ", "Change: ")}
                    {review.fields[field] === undefined
                      ? text("คงเดิม", "Keep")
                      : review.fields[field] === null
                        ? text("ล้างค่า", "Clear")
                        : review.fields[field]}
                  </p>
                  <p className="whitespace-pre-wrap break-words">
                    <span className="font-semibold">
                      {committed
                        ? text("ค่าที่บันทึก: ", "Saved value: ")
                        : text("ถ้าบันทึก: ", "If saved: ")}
                    </span>
                    {value(review.after[field])}
                  </p>
                </>
              )}
            </section>
          ))}
        </div>
      </div>
    </Panel>
  );
}
function useContentJobs(owner: string) {
  const [, update] = useState(0);
  useEffect(() => {
    const refresh = () => update((count) => count + 1);
    window.addEventListener("storage", refresh);
    window.addEventListener(CONTENT_JOURNAL_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(CONTENT_JOURNAL_EVENT, refresh);
    };
  }, [owner]);
  return readContentJobs(owner);
}
function RequestLinks({
  owner,
  productId,
  sku,
}: {
  owner: string;
  productId: string;
  sku?: string;
}) {
  const jobs = useContentJobs(owner).filter(
    (job) =>
      job.packet.productId === productId || (!!sku && job.packet.sku === sku),
  );
  return jobs.length ? (
    <Alert tone="warn">
      <p>
        {text(
          "ตรวจคำขอเดิมก่อนแก้ข้อความอีกครั้ง ผลของคำขอที่เก็บในเครื่องยังไม่ยืนยัน",
          "Check original content requests before editing again. Locally retained requests have unverified outcomes.",
        )}
      </p>
      {jobs.map((job) => (
        <WorkspaceLink
          key={job.packet.requestId}
          to={contentOutcomeUrl(job.packet.productId, job.packet.requestId)}
        >
          <span className="break-words">
            {text("ตรวจผลคำขอเดิม: ", "Check original outcome: ") +
              job.packet.sku}
            {job.conflict && (
              <span className="block">
                {text(
                  "ข้อมูลเปลี่ยน ต้องตรวจผลก่อนเริ่มใหม่",
                  "Evidence changed; check the outcome before starting again",
                )}
              </span>
            )}
          </span>
        </WorkspaceLink>
      ))}
    </Alert>
  ) : null;
}
function nativeOwned(ownership: string, item: ProductContentItem) {
  return (
    ownership === "commerce" &&
    ["native", "unavailable"].includes(item.evidenceSource)
  );
}
function useItem(productId: string) {
  return useAsync(async () => {
    const response = productContentReadSchema.parse(
      await api.get(endpoint + "/items/" + productId),
    );
    if (response.item.productId !== productId)
      throw Error(
        text(
          "ข้อมูลตอบกลับเป็นสินค้าอื่น ลองอ่านใหม่",
          "Returned content belongs to a different product. Try reading again.",
        ),
      );
    if (
      response.ownership === "commerce" &&
      !nativeOwned(response.ownership, response.item)
    )
      throw Error(
        text(
          "ยังยืนยันแหล่งเนื้อหาที่ระบบดูแลไม่ได้",
          "Owned content source could not be verified.",
        ),
      );
    return response;
  }, [productId]);
}
function Inspect({
  owner,
  productId,
  role,
}: {
  owner: string;
  productId: string;
  role: string;
}) {
  const source = useItem(productId),
    jobs = useContentJobs(owner),
    item = source.data?.item;
  const pending = jobs.some(
    (job) => job.packet.productId === productId || job.packet.sku === item?.sku,
  );
  return (
    <>
      <PageHeader
        title={text("ตรวจข้อความสินค้า", "Inspect product content")}
        subtitle={item?.sku ?? productId}
      />
      <WorkspaceLink
        to={
          role.trim().toLowerCase() === "graphic"
            ? "/j/allproducts"
            : "/j/product/" + productId
        }
      >
        {role.trim().toLowerCase() === "graphic"
          ? text("กลับแค็ตตาล็อกสินค้า", "Back to product catalog")
          : text("เปิดข้อมูลสินค้า", "Open product detail")}
      </WorkspaceLink>
      <RequestLinks owner={owner} productId={productId} sku={item?.sku} />
      <ErrorText error={source.error} onRetry={source.reload} />
      {source.loading ? (
        <Loading variant="detail" />
      ) : !source.error && item && source.data ? (
        <>
          <Chip tone="muted">
            {item.currentRecorded
              ? text("มีแถวเนื้อหาที่บันทึก", "Content record exists")
              : text(
                  "ยังไม่มีเนื้อหาที่บันทึกในระบบนี้",
                  "No commerce content record",
                )}
          </Chip>
          <Evidence
            item={item}
            historical={source.data.ownership !== "commerce"}
          />
          <Scope />
          {source.data.ownership !== "commerce" ? (
            <Alert tone="warn">
              {text(
                "ร้านค้ายังดูแลเนื้อหานี้เอง สำเนาที่แสดงอาจไม่ตรงกับค่าปัจจุบันบนร้านค้า ยังบันทึกการแก้ที่นี่ไม่ได้",
                "Josh still owns this content. Displayed copies do not verify the shop’s current content. Saving through the commerce content task is unavailable.",
              )}
              {role.trim().toLowerCase() !== "graphic" && (
                <WorkspaceLink to={"/j/product/edit/" + productId}>
                  {text(
                    "เปิดหน้าแก้สินค้าบนร้านค้า",
                    "Edit this Josh-owned product",
                  )}
                </WorkspaceLink>
              )}
            </Alert>
          ) : (
            <>
              {!item.currentRecorded && (
                <Alert tone="info">
                  {text(
                    "ระบบรู้จักสินค้านี้ แต่ยังไม่มีเนื้อหาที่บันทึกในระบบนี้ บันทึกครั้งนี้จะสร้างเนื้อหาด้วยเฉพาะช่องที่เลือก โดยไม่เติมจากสำเนา",
                    "This product is known but has no commerce content row. Saving creates a row with only selected fields, without copied defaults.",
                  )}
                </Alert>
              )}
              {!pending && (
                <WorkspaceLink to={contentEditUrl(productId)}>
                  {text("แก้ข้อความที่ตรวจแล้ว", "Edit inspected content")}
                </WorkspaceLink>
              )}
            </>
          )}
        </>
      ) : null}
    </>
  );
}
function Edit({ owner, productId }: { owner: string; productId: string }) {
  const navigate = useNavigate(),
    source = useItem(productId),
    formElement = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState(() => readContentForm(owner, productId)),
    [error, setError] = useState<string | null>(null),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const jobs = useContentJobs(owner),
    data = source.data,
    pending = jobs.some(
      (job) =>
        job.packet.productId === productId || job.packet.sku === form?.item.sku,
    );
  const stale = !!form && !!data && form.item.version !== data.item.version,
    editable =
      !!data &&
      nativeOwned(data.ownership, data.item) &&
      !source.loading &&
      !source.error;
  useEffect(() => {
    if (data && !form && nativeOwned(data.ownership, data.item))
      setForm(initialContentForm(data.item));
  }, [data, form]);
  useEffect(() => {
    if (Object.keys(fieldErrors).length)
      formElement.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
  }, [fieldErrors]);
  useUnsavedChanges(
    !!form && fields.some((field) => form.fields[field].mode !== "keep"),
  );
  function update(next: ContentForm) {
    setForm(next);
    setError(null);
    setFieldErrors({});
    try {
      storeContentForm(owner, next);
    } catch {
      setError(
        text(
          "ที่เก็บกู้คืนใช้ไม่ได้ ยังไม่ส่งการแก้ข้อความ",
          "Recovery storage unavailable. No content change was sent.",
        ),
      );
    }
  }
  function prepare(event: FormEvent) {
    event.preventDefault();
    if (!form || !data || !editable || pending || stale) return;
    setError(null);
    setFieldErrors({});
    try {
      const selection = productContentSelectionSchema.parse({
        productId,
        sku: form.item.sku,
        version: form.item.version,
        fields: contentFieldsFromForm(form),
      });
      storeContentForm(owner, form);
      storeContentSelection(owner, selection);
      navigate(contentReviewUrl(productId));
    } catch (caught) {
      if (caught instanceof z.ZodError) {
        setFieldErrors(
          Object.fromEntries(
            caught.issues
              .filter((issue) => issue.path.length)
              .map((issue) => [
                String(issue.path[0]),
                text(
                  "ชื่อต้องไม่ว่างและไม่เกิน 255 ตัวอักษร ข้อความไม่เกิน 20000 ตัวอักษร หากต้องการล้างข้อความให้เลือก ล้างค่า",
                  "Names must be nonblank and at most 255 characters. Other text allows at most 20000 characters; choose Clear to remove it.",
                ),
              ]),
          ),
        );
        setError(
          text(
            "เลือกอย่างน้อยหนึ่งช่องให้ตั้งค่าหรือล้างค่า แล้วตรวจข้อความ",
            "Choose at least one field to set or clear, then check the text.",
          ),
        );
      } else
        setError(
          text(
            "ที่เก็บกู้คืนใช้ไม่ได้ ยังไม่ส่งการแก้ข้อความ ลองใหม่ก่อนทบทวน",
            "Recovery storage unavailable. No content change was sent. Try again before reviewing.",
          ),
        );
    }
  }
  return (
    <>
      <PageHeader
        title={text("แก้ข้อความสินค้า", "Edit product content")}
        subtitle={data?.item.sku ?? productId}
      />
      <WorkspaceLink to={contentHomeUrl(productId)}>
        {text("กลับไปตรวจข้อความ", "Back to content inspection")}
      </WorkspaceLink>
      <RequestLinks owner={owner} productId={productId} sku={data?.item.sku} />
      <ErrorText error={source.error} onRetry={source.reload} />
      <ErrorText error={error} />
      {source.loading ? (
        <Loading variant="form" />
      ) : source.error ? (
        form && (
          <>
            <Alert tone="warn">
              {text(
                "แสดงฉบับที่เก็บในเครื่อง ยังยืนยันแหล่งปัจจุบันไม่ได้ จึงยังส่งไม่ได้",
                "Showing the retained local baseline. Current source is unverified, so no edit can be sent.",
              )}
            </Alert>
            <Evidence item={form.item} historical />
          </>
        )
      ) : data && !nativeOwned(data.ownership, data.item) ? (
        <Alert tone="warn">
          {text(
            "เนื้อหานี้ยังไม่ได้ดูแลในระบบนี้ จึงยังแก้ที่นี่ไม่ได้",
            "Commerce does not own this content. Editing through this task is unavailable.",
          )}
        </Alert>
      ) : form && data ? (
        <>
          <Evidence item={data.item} />
          <Scope />
          {fields.some((field) => form.fields[field].mode !== "keep") && (
            <Chip tone="muted">
              {text("ฉบับแก้ในเครื่อง ยังไม่ส่ง", "Local edit — not submitted")}
            </Chip>
          )}
          {stale && (
            <Alert tone="warn">
              <p>
                {text(
                  "เนื้อหาปัจจุบันเปลี่ยนแล้ว ฉบับเดิมยังไม่ส่ง ต้องเริ่มใหม่จากข้อมูลปัจจุบัน",
                  "Current content changed. The retained edit cannot be sent. Start again from current evidence.",
                )}
              </p>
              <Button onClick={() => update(initialContentForm(data.item))}>
                {text(
                  "เริ่มใหม่จากเนื้อหาปัจจุบัน",
                  "Start again from current content",
                )}
              </Button>
            </Alert>
          )}
          <form
            ref={formElement}
            onSubmit={prepare}
            noValidate
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((field) => {
                const disabled = !editable || pending || stale,
                  selected = form.fields[field];
                const inputProps = {
                  name: field,
                  label: label(field) + text(" — ข้อความใหม่", " — new text"),
                  value: selected.value,
                  error: fieldErrors[field],
                  disabled,
                  required: true,
                  maxLength: contentNameField(field) ? 255 : 20000,
                  onChange: (
                    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
                  ) =>
                    update({
                      ...form,
                      fields: {
                        ...form.fields,
                        [field]: { ...selected, value: event.target.value },
                      },
                    }),
                  help: contentNameField(field)
                    ? text(
                        "ชื่อต้องไม่ว่าง ไม่เกิน 255 ตัวอักษร",
                        "Nonblank name, at most 255 characters",
                      )
                    : text(
                        "ไม่เกิน 20000 ตัวอักษร เลือก ล้างค่า เพื่อบันทึกว่าไม่มีข้อความ",
                        "At most 20000 characters. Choose Clear to store no text",
                      ),
                };
                return (
                  <Panel key={field}>
                    <div className="min-w-0 space-y-3 p-4">
                      <TaskSelect
                        label={
                          label(field) + text(" — การเปลี่ยน", " — change")
                        }
                        name={field + "-mode"}
                        value={selected.mode}
                        disabled={disabled}
                        onChange={(event) =>
                          update({
                            ...form,
                            fields: {
                              ...form.fields,
                              [field]: {
                                ...selected,
                                mode: event.target.value as
                                  | "keep"
                                  | "set"
                                  | "clear",
                              },
                            },
                          })
                        }
                      >
                        <option value="keep">
                          {text("คงเดิม", "Keep current value")}
                        </option>
                        <option value="set">
                          {text("ตั้งข้อความ", "Set text")}
                        </option>
                        {!contentNameField(field) && (
                          <option value="clear">
                            {text("ล้างค่า", "Clear text")}
                          </option>
                        )}
                      </TaskSelect>
                      {selected.mode === "set" ? (
                        contentNameField(field) ? (
                          <TaskInput {...inputProps} />
                        ) : (
                          <TaskTextarea {...inputProps} rows={4} />
                        )
                      ) : (
                        <p>
                          {selected.mode === "clear"
                            ? text(
                                "บันทึกเป็นไม่มีข้อความ แยกจากช่องที่ยังไม่เคยบันทึก",
                                "Stores a cleared value, distinct from a field never recorded.",
                              )
                            : text(
                                "ช่องนี้ไม่ถูกส่ง ค่าที่บันทึกหรือการไม่มีค่าจะคงเดิม",
                                "This field is omitted; its recorded value or absence remains unchanged.",
                              )}
                        </p>
                      )}
                    </div>
                  </Panel>
                );
              })}
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={!editable || pending || stale}
            >
              {text("ทบทวนข้อความก่อนบันทึก", "Review content edit")}
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
  const write = (job: ContentJob) =>
    mutation.run(async () => {
      if (job.owner !== owner)
        throw Error(
          text(
            "บัญชีเปลี่ยนแล้ว ยังไม่ส่งการแก้",
            "Account changed. No content change was sent.",
          ),
        );
      try {
        storeContentJob(job);
      } catch {
        throw Error(
          text(
            "เก็บคำขอกู้คืนไม่ได้ ยังไม่ส่งการแก้ ตรวจคำขอเดิมก่อนลองใหม่",
            "Recovery intent could not be saved. No content change was sent. Check original requests before trying again.",
          ),
        );
      }
      try {
        const receipt = verifyProductContentReceipt(
          await api.post(
            "/josh/products/" + job.packet.productId + "/update",
            productContentUpdateEnvelope(job.packet),
          ),
          job.packet,
        );
        if (receipt.updatedBy !== owner)
          throw Error("Content outcome belongs to another actor");
        return receipt;
      } catch (error) {
        if ((error as { status?: number }).status === 409) {
          try {
            storeContentJob({ ...job, conflict: true });
          } catch {
            /* Preserve the original intent. */
          }
        }
        throw Error(
          text(
            "ยังยืนยันผลบันทึกไม่ได้ ตรวจคำขอเดิมก่อนส่งซ้ำ",
            "Content outcome is unverified. Check the original request before retrying.",
          ),
        );
      }
    });
  return { ...mutation, mounted, write };
}
function Review({ owner, productId }: { owner: string; productId: string }) {
  const navigate = useNavigate(),
    [selection] = useState(() => readContentSelection(owner, productId)),
    [confirmed, setConfirmed] = useState(false),
    writer = useWriter(owner);
  const source = useAsync(async () => {
    if (!selection) return null;
    const review = verifyProductContentReview(
      await api.post(endpoint + "/review", selection),
      selection,
    );
    if (
      review.ownership === "commerce" &&
      !nativeOwned(review.ownership, review.item)
    )
      throw Error("Owned content source could not be verified");
    return review;
  }, [productId]);
  useEffect(() => {
    if (source.loading) setConfirmed(false);
  }, [source.loading]);
  const review = source.data,
    jobs = useContentJobs(owner),
    pending = jobs.some(
      (job) =>
        job.packet.productId === productId ||
        job.packet.sku === review?.item.sku,
    );
  async function save() {
    if (
      !selection ||
      !review ||
      !confirmed ||
      writer.busy ||
      pending ||
      source.loading ||
      source.error ||
      !nativeOwned(review.ownership, review.item)
    )
      return;
    const packet = productContentPacketSchema.parse({
      ...selection,
      requestId: crypto.randomUUID(),
    });
    const result = await writer.write({
      owner,
      packet,
      review,
      conflict: false,
    });
    if (
      writer.mounted.current &&
      (result.ok ||
        readContentJobs(owner).some(
          (job) => job.packet.requestId === packet.requestId,
        ))
    )
      navigate(contentOutcomeUrl(productId, packet.requestId));
  }
  return (
    <>
      <PageHeader
        title={text("ทบทวนข้อความสินค้า", "Review product content")}
        subtitle={selection?.sku ?? productId}
      />
      <WorkspaceLink to={contentEditUrl(productId)}>
        {text("กลับไปแก้ข้อความที่เลือก", "Back to selected content edit")}
      </WorkspaceLink>
      <RequestLinks owner={owner} productId={productId} sku={selection?.sku} />
      <ErrorText error={source.error} onRetry={source.reload} />
      <ErrorText error={writer.error} />
      {writer.busy && (
        <p role="status">
          {text(
            "กำลังบันทึกคำขอเดิม รอผลยืนยัน",
            "Saving the original request. Waiting for a confirmed outcome.",
          )}
        </p>
      )}
      {source.loading ? (
        <Loading variant="detail" />
      ) : source.error ? (
        <Alert tone="warn">
          {text(
            "ฉบับเดิมยังไม่ผ่านการตรวจปัจจุบัน จึงยังส่งไม่ได้ กลับไปอ่านเนื้อหาปัจจุบันหรือลองตรวจใหม่",
            "Retained content has not passed the current check. No edit can be sent. Inspect current content or retry the check.",
          )}
        </Alert>
      ) : !review ? (
        <Empty>
          {text(
            "ยังไม่มีการแก้ที่เลือกในบัญชีนี้ กลับไปเลือกข้อความก่อน",
            "No selected content edit for this account. Return to choose text.",
          )}
        </Empty>
      ) : (
        <>
          <Evidence item={review.item} review={review} />
          <Scope />
          {!nativeOwned(review.ownership, review.item) && (
            <Alert tone="warn">
              {text(
                "ระบบนี้ยังไม่ดูแลเนื้อหานี้ บันทึกที่นี่ไม่ได้",
                "Commerce does not own this content. Saving is unavailable here.",
              )}
            </Alert>
          )}
          <label className="flex min-h-11 items-start gap-3 rounded-lg border border-secondary-container p-3">
            <Checkbox
              aria-label={text(
                "ยืนยันตรวจข้อความแล้ว",
                "Confirm reviewed content edit",
              )}
              checked={confirmed}
              disabled={writer.busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              {text(
                "ฉันตรวจข้อความที่บันทึก ค่าหลังเปลี่ยน และช่องที่คงไว้หรือล้างแล้ว",
                "I reviewed the recorded and resulting text, including fields kept or cleared.",
              )}
            </span>
          </label>
          <Button
            variant="primary"
            disabled={
              !confirmed ||
              writer.busy ||
              pending ||
              !nativeOwned(review.ownership, review.item)
            }
            onClick={() => void save()}
          >
            {writer.busy
              ? text("กำลังบันทึกข้อความ", "Saving content edit")
              : text("บันทึกข้อความที่ตรวจแล้ว", "Save reviewed content edit")}
          </Button>
        </>
      )}
    </>
  );
}
function Receipt({ receipt }: { receipt: ProductContentReceipt }) {
  const review: ProductContentReview = {
    item: receipt.before,
    fields: receipt.packet.fields,
    after: receipt.after,
    ownership: "commerce",
    capturedAt: receipt.savedAt,
  };
  return (
    <>
      <Alert tone="ok">
        <strong>
          {text(
            "บันทึกข้อความสินค้าแล้ว 1 สินค้า",
            "Saved content edit for 1 product",
          )}
        </strong>
        <p>
          {text(
            "ยืนยันจากผลบันทึกจริงของคำขอเดิม",
            "Confirmed by the original request’s persisted outcome",
          )}
        </p>
      </Alert>
      <Chip tone="ok">{text("บันทึกแล้ว", "Saved")}</Chip>
      <Evidence item={receipt.before} review={review} historical committed />
      <p className="break-words">
        {text("ผู้บันทึก", "Saved by")}: {receipt.updatedBy} · {receipt.savedAt}
      </p>
      <Alert tone="info">
        {text(
          "เนื้อหาและคิวเหตุการณ์บันทึกแล้ว การรับของร้านยังไม่ยืนยัน เนื้อหาอาจเปลี่ยนหลังคำขอนี้",
          "Content and event queue committed. Shop delivery remains unverified. Content may have changed after this request.",
        )}
      </Alert>
      <WorkspaceLink to={contentHomeUrl(receipt.packet.productId)}>
        {text(
          "ตรวจเนื้อหาปัจจุบันของสินค้านี้",
          "Inspect this product’s current content",
        )}
      </WorkspaceLink>
    </>
  );
}
function Outcome({
  owner,
  productId,
  id,
}: {
  owner: string;
  productId: string;
  id: string;
}) {
  const jobs = useContentJobs(owner),
    job = jobs.find(
      (candidate) =>
        candidate.packet.requestId === id &&
        candidate.packet.productId === productId,
    ),
    [confirmed, setConfirmed] = useState(false),
    writer = useWriter(owner);
  const result = useAsync(async () => {
    try {
      const receipt = verifyProductContentReceipt(
        await api.get(endpoint + "/requests/" + id),
        job?.packet,
      );
      if (
        receipt.requestId !== id ||
        receipt.packet.productId !== productId ||
        receipt.updatedBy !== owner
      )
        throw Error(
          "Returned content outcome differs from this account, product or request",
        );
      return { receipt, absent: false };
    } catch (error) {
      if ((error as { status?: number }).status === 404)
        return { receipt: null, absent: true };
      throw error;
    }
  }, [owner, productId, id]);
  useEffect(() => {
    if (result.loading) setConfirmed(false);
  }, [result.loading]);
  useEffect(() => {
    const receipt = result.data?.receipt;
    if (receipt && !result.loading && !result.error) {
      try {
        clearAcknowledgedContentDraft(owner, receipt);
        clearContentJob(owner, id);
      } catch {
        /* The persisted receipt stays authoritative. */
      }
    }
  }, [result.data, result.loading, result.error, owner, id]);
  async function retry() {
    if (
      !job ||
      !confirmed ||
      !result.data?.absent ||
      result.loading ||
      result.error ||
      writer.busy ||
      job.conflict
    )
      return;
    setConfirmed(false);
    await writer.write(job);
    if (writer.mounted.current) result.reload();
  }
  return (
    <>
      <PageHeader
        title={text("ผลการแก้ข้อความสินค้า", "Product content outcome")}
        subtitle={id}
      />
      <WorkspaceLink to={contentHomeUrl(productId)}>
        {text("กลับไปตรวจข้อความสินค้า", "Back to content inspection")}
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
              "ยังไม่พบผลบันทึกของคำขอเดิมในบัญชีนี้ ไม่ถือว่าสำเร็จ",
              "No committed content edit found for this account. Completion is unconfirmed.",
            )}
          </Alert>
          {job ? (
            <>
              <p>
                {text(
                  "ฉบับที่ตรวจของคำขอเดิม แหล่งปัจจุบันยังไม่ยืนยัน",
                  "Evidence retained for the original request. Current source remains unverified.",
                )}
              </p>
              <Evidence item={job.review.item} review={job.review} historical />
              <Scope />
              {job.conflict ? (
                <Alert tone="warn">
                  <p>
                    {text(
                      "ข้อมูลเปลี่ยนแล้ว ไม่ส่งคำขอเก่าซ้ำ ตรวจเนื้อหาปัจจุบันก่อนเริ่มใหม่",
                      "Evidence changed. Do not resend this stale request. Inspect current content before starting again.",
                    )}
                  </p>
                  <Button
                    onClick={() => {
                      try {
                        clearContentJob(owner, id);
                      } catch {
                        /* Preserve original intent if removal fails. */
                      }
                    }}
                  >
                    {text(
                      "ปิดคำขอเก่าที่ไม่บันทึก",
                      "Dismiss uncommitted stale content edit",
                    )}
                  </Button>
                </Alert>
              ) : (
                <>
                  <label className="flex min-h-11 items-start gap-3 rounded-lg border border-secondary-container p-3">
                    <Checkbox
                      aria-label={text(
                        "ยืนยันส่งข้อความเดิมซ้ำ",
                        "Confirm exact original content retry",
                      )}
                      checked={confirmed}
                      disabled={writer.busy}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>
                      {text(
                        "ตรวจแล้วว่ายังไม่มีผลบันทึก และต้องการส่งเฉพาะข้อความเดิม",
                        "I checked that no outcome is recorded and want to retry only the exact original content edit.",
                      )}
                    </span>
                  </label>
                  <Button
                    disabled={!confirmed || writer.busy}
                    onClick={() => void retry()}
                  >
                    {writer.busy
                      ? text(
                          "กำลังส่งคำขอเดิม",
                          "Retrying original content edit",
                        )
                      : text(
                          "ส่งข้อความเดิมหลังตรวจผลแล้ว",
                          "Retry checked original content edit",
                        )}
                  </Button>
                </>
              )}
            </>
          ) : (
            <Empty>
              {text(
                "ไม่มีคำขอกู้คืนในเครื่องนี้ กลับไปตรวจเนื้อหาก่อนเริ่มใหม่",
                "No local recovery intent. Return to inspect content before starting again.",
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
              "Check original content outcome again",
            )}
          </Button>
        </>
      )}
    </>
  );
}
export default function ProductContentWorkspace({
  role = session.claims()?.role ?? "",
  owner = session.claims()?.sub ?? "",
  productId: suppliedId,
}: {
  role?: string;
  owner?: string;
  productId?: string;
}) {
  useUiLocale();
  const params = useParams(),
    location = useLocation(),
    identity = priceRequestId.safeParse(suppliedId ?? params.id);
  if (!owner || !canEditProductContent(role))
    return (
      <ErrorText
        error={text(
          "บัญชีนี้ไม่มีสิทธิ์แก้ข้อความสินค้า",
          "This account cannot access product content edits",
        )}
      />
    );
  if (!identity.success)
    return (
      <ErrorText
        error={text("รหัสสินค้าไม่ถูกต้อง", "Invalid product identity")}
      />
    );
  const productId = identity.data,
    tail = location.pathname.slice(contentHomeUrl(productId).length),
    key = owner + ":" + productId + ":" + location.key;
  let content;
  if (!tail || tail === "/")
    content = (
      <Inspect key={key} owner={owner} productId={productId} role={role} />
    );
  else if (tail === "/edit")
    content = <Edit key={key} owner={owner} productId={productId} />;
  else if (tail === "/review")
    content = <Review key={key} owner={owner} productId={productId} />;
  else {
    const match = tail.match(/^\/requests\/([^/]+)$/),
      id = priceRequestId.safeParse(match?.[1]);
    content = id.success ? (
      <Outcome
        key={owner + ":" + productId + ":" + id.data}
        owner={owner}
        productId={productId}
        id={id.data}
      />
    ) : (
      <>
        <Alert tone="danger">
          {text("ไม่พบหน้าการแก้ข้อความนี้", "Content edit page not found")}
        </Alert>
        <WorkspaceLink to={contentHomeUrl(productId)}>
          {text("เปิดหน้าตรวจข้อความสินค้า", "Open content inspection")}
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
