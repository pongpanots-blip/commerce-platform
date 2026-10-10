import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Loading,
  PageHeader,
  Pager,
  Panel,
  PanelHead,
  TaskInput,
  useUiLocale,
  useUnsavedChanges,
} from "@cp/ui";
import { api, session } from "../../../lib/api";
import { CommercePage } from "../../CommercePage";
import { commerceText as text } from "../../commerce-copy";
import { useAsync, useMutation } from "../../hooks";
import { WorkspaceLink } from "../../WorkspaceParts";
import { PlanningError as ErrorText } from "../planning/PlanningError";
import {
  canApprovePrices,
  PRICE_APPROVAL_API as endpoint,
  PRICE_APPROVAL_HOME as home,
  priceApprovalPageSchema,
  priceApprovalPacketSchema,
  verifyPriceApprovalReview,
  priceRequestId,
  approvedPriceValues,
  verifyPriceApprovalReceipt,
  type PriceApprovalItem,
  type PriceApprovalReceipt,
} from "../../../../../commerce-platform/src/modules/commerce/product-prices/price-approval-contracts";
import {
  clearPriceJob,
  readPriceJobs,
  readPriceReview,
  storePriceJob,
  storePriceReview,
  reviewKey,
  type PriceApprovalJob,
} from "./price-approval-journal";
import { CurrentPrices } from "./CurrentPrices";
import { PriceRequestLinks, usePriceRequests } from "./PriceRequestLinks";
import {
  priceDetailUrl as detail,
  priceSkuFromToken,
} from "./price-approval-routing";
const outcome = (id: string) => `${home}/requests/${id}`;
const show = (v: unknown) =>
  v == null ? text("ยังไม่มีข้อมูล", "Not recorded") : String(v);
const date = (v: string | null) =>
  v ? new Date(v).toLocaleString() : text("ไม่ทราบ", "Unknown");
const decisionLabel = (d: string) =>
  d === "approve"
    ? text("อนุมัติราคาที่ตรวจแล้ว", "Approve reviewed prices")
    : text("ปฏิเสธราคาที่ตรวจแล้ว", "Reject reviewed prices");
function PriceEvidence({
  item,
  decision,
  historical = false,
}: {
  item: PriceApprovalItem;
  decision?: string;
  historical?: boolean;
}) {
  const labels = {
    sellingUnitPrice: text("ราคาต่อหน่วยขาย", "Price per selling unit"),
    orderingPrice: text("ราคาต่อหน่วยสั่ง", "Price per ordering unit"),
    moq: text("จำนวนขั้นต่ำ", "Minimum order quantity"),
  };
  return (
    <Panel>
      <div className="space-y-3 p-4 min-w-0">
        <h2 className="font-semibold break-words">{item.sku}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.entries(labels).map(([key, label]) => {
            const k = key as keyof typeof labels;
            return (
              <div className="space-y-1" key={key}>
                <h3 className="font-semibold">{label}</h3>
                <p>
                  {historical
                    ? text("ฉบับที่ตรวจ", "Reviewed baseline")
                    : text("ปัจจุบัน", "Current")}
                  : {show(item.current[k])}
                </p>
                <p>
                  {text("ERP เสนอ", "ERP proposed")}:{" "}
                  {item.proposed[k] == null
                    ? text("คงค่าเดิม", "Keep current value")
                    : show(item.proposed[k])}
                </p>
                <p>
                  {decision
                    ? text("หลังตัดสินใจ", "After decision")
                    : text("หลังอนุมัติ", "After approval")}
                  :{" "}
                  {show(
                    decision === "reject"
                      ? item.current[k]
                      : approvedPriceValues(item)[k],
                  )}
                </p>
              </div>
            );
          })}
        </div>
        <p>
          {text("ERP เปลี่ยนเมื่อ", "ERP changed at")}: {date(item.changedAt)} ·{" "}
          {text("รับเข้าคิว", "Queue received at")}: {date(item.receivedAt)}
        </p>
        <p>
          {text("ที่มาราคาปัจจุบัน", "Current price source")}:{" "}
          {show(item.currentSource)} · {text("แก้ล่าสุดโดย", "Last changed by")}
          : {show(item.currentUpdatedBy)}
        </p>
        <details>
          <summary>
            {text("ข้อมูลอ้างอิงที่บันทึก", "Recorded evidence reference")}
          </summary>
          <p className="text-xs break-all">
            {text("ฉบับที่ตรวจ", "Reviewed evidence version")}: {item.version}
          </p>
        </details>
        {!item.currentRecorded && !historical && (
          <Alert tone="warn">
            {text(
              "ไม่มีแถวราคาปัจจุบัน การอนุมัติจะสร้างแถวจากค่าที่ ERP ส่งมาเท่านั้น",
              "No current commerce price row. Approval creates one using only the supplied ERP fields.",
            )}
          </Alert>
        )}
      </div>
    </Panel>
  );
}
function Scope({ decision, count }: { decision: string; count: number }) {
  return (
    <Alert tone="warn">
      <p>
        {text(
          `ตัดสินใจเฉพาะ ${count} SKU ที่แสดง`,
          `This decision covers only the ${count} displayed SKU(s).`,
        )}
      </p>
      <p>
        {decision === "approve"
          ? text(
              "ค่า ERP ที่ส่งมาจะเป็นราคาปัจจุบัน ค่าที่ไม่ได้ส่งคงเดิม ระบบเข้าคิว snapshot ไปยังร้าน แต่ยังไม่ยืนยันการส่งถึงปลายทาง",
              "Supplied ERP values become current prices; unspecified fields stay unchanged. A snapshot is queued for the shop; downstream delivery is unverified.",
            )
          : text(
              "ลบข้อเสนอเหล่านี้จากคิว ราคาปัจจุบันคงเดิม ไม่ส่ง snapshot ราคา",
              "Remove these proposals from the queue. Current prices stay unchanged; no price snapshot is sent.",
            )}
      </p>
      <p>
        {text(
          "คิวนี้ไม่มีสัญญาสกุลเงิน VAT หรือหน่วยที่ครบถ้วน จึงแสดงค่าที่บันทึกตรง ๆ ไม่แปลงราคา ราคาลูกค้าและราคาตามสัญญาอยู่นอกขอบเขต",
          "Currency, VAT and unit basis are not supplied by this queue contract. Raw values are displayed without conversion. Customer and contract prices are outside this scope.",
        )}
      </p>
      <p>
        {text(
          "ทั้งชุดบันทึกในธุรกรรมเดียว ถ้าข้อมูลเปลี่ยนหรือบันทึกไม่ครบ จะไม่ถือว่าสำเร็จบางส่วน ต้องตรวจใหม่",
          "The selected set commits in one transaction. Changed evidence or an incomplete write stops the whole decision; partial completion is not assumed.",
        )}
      </p>
    </Alert>
  );
}
function usePriceJobs(owner: string) {
  const [jobs, set] = useState(() => readPriceJobs(owner));
  useEffect(() => {
    const update = () => set(readPriceJobs(owner));
    update();
    window.addEventListener("storage", update);
    window.addEventListener("cp-price-approval-journal", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("cp-price-approval-journal", update);
    };
  }, [owner]);
  return jobs;
}
function PendingRequests({ owner }: { owner: string }) {
  return <PriceRequestLinks owner={owner} />;
}
function Queue({ owner }: { owner: string }) {
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate();
  const search = params.get("search") ?? "",
    page = Math.max(1, Number(params.get("page")) || 1),
    limit = [20, 50, 100].includes(Number(params.get("limit")))
      ? Number(params.get("limit"))
      : 20;
  const [query, setQuery] = useState(search),
    [selected, setSelected] = useState<PriceApprovalItem[]>([]),
    [error, setError] = useState<string | null>(null);
  const source = useAsync(
    async () =>
      priceApprovalPageSchema.parse(
        await api.get(
          `${endpoint}/pending?${new URLSearchParams({ search, page: String(page), limit: String(limit) })}`,
        ),
      ),
    [search, page, limit],
  );
  useEffect(() => {
    setQuery(search);
    setSelected([]);
  }, [search, page, limit]);
  const stale = selected.some(
    (i) =>
      !source.data?.items.some(
        (r) => r.sku === i.sku && r.version === i.version,
      ),
  );
  useEffect(() => {
    const d = source.data;
    if (
      !source.loading &&
      !source.error &&
      d &&
      !d.items.length &&
      d.total > 0 &&
      d.page > 1
    ) {
      setSelected([]);
      setParams(
        {
          search,
          page: String(Math.ceil(d.total / d.limit)),
          limit: String(d.limit),
        },
        { replace: true },
      );
    }
  }, [source.data, source.loading, source.error, search, setParams]);
  const prepare = (decision: "approve" | "reject") => {
    if (
      !source.data ||
      source.loading ||
      source.error ||
      stale ||
      !selected.length
    )
      return;
    try {
      storePriceReview(owner, `${home}/review`, {
        items: selected,
        ownership: source.data.ownership,
        capturedAt: new Date().toISOString(),
      });
      navigate(`${home}/review?decision=${decision}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const go = (p: number, size = limit) => {
    setSelected([]);
    setParams({ search, page: String(p), limit: String(size) });
  };
  return (
    <>
      <PageHeader
        title={text("ทบทวนราคาที่ ERP ส่งมา", "Review incoming ERP prices")}
        subtitle={text(
          "ตรวจค่าปัจจุบันและข้อเสนอ ก่อนตัดสินใจ",
          "Inspect current and proposed values before deciding.",
        )}
      />
      <PendingRequests owner={owner} />
      <WorkspaceLink to={`${home}/current`}>
        {text("ราคาปัจจุบันและแก้ด้วยตนเอง", "Current prices and manual edits")}
      </WorkspaceLink>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSelected([]);
          setParams({ search: query.trim(), page: "1", limit: String(limit) });
        }}
      >
        <div className="min-w-0 flex-1">
          <TaskInput
            label={text("ค้นหา SKU ในคิว", "Search queue by SKU")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit">{text("ค้นหา", "Search")}</Button>
      </form>
      <ErrorText error={error} />
      <ErrorText error={source.error} onRetry={source.reload} />
      {source.loading ? (
        <Loading variant="detail" />
      ) : source.error || !source.data ? null : (
        <>
          {source.data.ownership !== "commerce" && (
            <Alert tone="warn">
              {text(
                "Josh ยังเป็นเจ้าของราคา จึงยังตัดสินใจที่นี่ไม่ได้",
                "Josh still owns prices. Commerce decisions are unavailable.",
              )}
            </Alert>
          )}
          <PanelHead
            title={text(
              `รอพิจารณา ${source.data.total} SKU`,
              `Pending: ${source.data.total} SKU(s)`,
            )}
          />
          {stale && (
            <Alert tone="warn">
              {text(
                "รายการที่เลือกเปลี่ยนแล้ว ตรวจใหม่",
                "Selected evidence changed. Review again.",
              )}
              <Button onClick={() => setSelected([])}>
                {text("ล้างการเลือก", "Clear selection")}
              </Button>
            </Alert>
          )}
          <div className="flex flex-wrap gap-3">
            <p>
              {text(
                `เลือก ${selected.length} SKU ยังไม่ได้ตัดสินใจ`,
                `${selected.length} selected; no decisions saved`,
              )}
            </p>
            {["approve", "reject"].map((d) => (
              <Button
                key={d}
                variant={d === "approve" ? "primary" : "ghost"}
                disabled={
                  !selected.length ||
                  stale ||
                  source.data?.ownership !== "commerce"
                }
                onClick={() => prepare(d as "approve" | "reject")}
              >
                {d === "approve"
                  ? text("ตรวจชุดก่อนอนุมัติ", "Review selected approvals")
                  : text("ตรวจชุดก่อนปฏิเสธ", "Review selected rejections")}
              </Button>
            ))}
          </div>
          {!source.data.items.length ? (
            <Empty>
              {source.data.total > 0
                ? text(
                    "คิวกำลังเปลี่ยน ลองอ่านรายการหน้านี้ใหม่",
                    "The queue changed. Refresh this page.",
                  )
                : search
                  ? text("ไม่พบ SKU ตามคำค้น", "No matching pending SKU")
                  : text("ไม่มีราคาที่รอพิจารณา", "No pending price changes")}
            </Empty>
          ) : (
            source.data.items.map((item) => (
              <Panel key={item.sku}>
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 min-w-0">
                  <label className="flex min-w-0 gap-3 items-center">
                    <Checkbox
                      aria-label={text(
                        `เลือก ${item.sku}`,
                        `Select ${item.sku}`,
                      )}
                      checked={selected.some((i) => i.sku === item.sku)}
                      onChange={() =>
                        setSelected((s) =>
                          s.some((i) => i.sku === item.sku)
                            ? s.filter((i) => i.sku !== item.sku)
                            : [...s, item],
                        )
                      }
                    />
                    <span className="min-w-0 break-words">
                      {item.sku} · {date(item.receivedAt)}
                    </span>
                  </label>
                  <WorkspaceLink to={detail(item.sku)}>
                    {text(
                      "ตรวจค่าปัจจุบันและข้อเสนอ",
                      "Inspect current and proposed values",
                    )}
                  </WorkspaceLink>
                </div>
              </Panel>
            ))
          )}
          <Pager
            page={source.data.page}
            pageSize={source.data.limit}
            total={source.data.total}
            onPage={(p) => go(p)}
            onPageSize={(n) => go(1, n)}
          />
        </>
      )}
    </>
  );
}
function Detail({ sku, owner }: { sku: string; owner: string }) {
  const navigate = useNavigate(),
    source = useAsync(
      async () =>
        verifyPriceApprovalReview(
          await api.get(`${endpoint}/items/${encodeURIComponent(sku)}`),
          [{ sku }],
        ),
      [sku],
    ),
    [error, setError] = useState<string | null>(null);
  const prepare = (decision: "approve" | "reject") => {
    if (
      !source.data ||
      source.loading ||
      source.error ||
      source.data.ownership !== "commerce"
    )
      return;
    try {
      storePriceReview(owner, `${detail(sku)}/review`, source.data);
      navigate(`${detail(sku)}/review?decision=${decision}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <PageHeader
        title={text("ตรวจข้อเสนอราคา", "Inspect price proposal")}
        subtitle={sku}
      />
      <WorkspaceLink to={home}>
        {text("กลับคิวราคา", "Back to price queue")}
      </WorkspaceLink>
      <PendingRequests owner={owner} />
      <ErrorText error={error} />
      <ErrorText error={source.error} onRetry={source.reload} />
      {source.loading ? (
        <Loading variant="detail" />
      ) : source.data && !source.error ? (
        <>
          <PriceEvidence item={source.data.items[0]} />
          <Scope decision="approve" count={1} />
          {source.data.ownership !== "commerce" && (
            <Alert tone="warn">
              {text("Josh ยังเป็นเจ้าของราคา", "Josh still owns prices")}
            </Alert>
          )}
          <div className="flex flex-wrap gap-3">
            {["approve", "reject"].map((d) => (
              <Button
                key={d}
                variant={d === "approve" ? "primary" : "ghost"}
                disabled={source.data?.ownership !== "commerce"}
                onClick={() => prepare(d as "approve" | "reject")}
              >
                {d === "approve"
                  ? text("ตรวจขั้นสุดท้ายก่อนอนุมัติ", "Review before approval")
                  : text(
                      "ตรวจขั้นสุดท้ายก่อนปฏิเสธ",
                      "Review before rejection",
                    )}
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
function usePriceWriter(owner: string) {
  const mutation = useMutation(),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useUnsavedChanges(mutation.busy);
  const write = (job: PriceApprovalJob) =>
    mutation.run(async () => {
      if (job.owner !== owner) throw Error("Account identity changed");
      storePriceJob(job);
      let receipt: PriceApprovalReceipt;
      try {
        receipt = verifyPriceApprovalReceipt(
          await api.post(`${endpoint}/actions`, job.packet),
          job.packet,
        );
      } catch (e) {
        if ((e as { status?: number }).status === 409) {
          try {
            storePriceJob({ ...job, conflict: true });
          } catch {
            /* Original retained. */
          }
        }
        throw Error(
          text(
            "ยังยืนยันผลไม่ได้ ตรวจคำขอเดิมก่อนส่งซ้ำ",
            "Decision outcome is unverified. Check the original request before retrying.",
          ),
        );
      }
      // Retain the discoverable request until its outcome is actually rendered.
      // Navigation while the reply arrives must preserve a recovery link.
      return receipt;
    });
  return { ...mutation, write, mounted };
}
function Review({ owner, sku }: { owner: string; sku?: string }) {
  const location = useLocation(),
    [params] = useSearchParams(),
    navigate = useNavigate(),
    decision = params.get("decision"),
    path = location.pathname;
  const [draft] = useState(() => readPriceReview(owner, path)),
    [confirmed, setConfirmed] = useState(false),
    writer = usePriceWriter(owner);
  const source = useAsync(async () => {
    if (draft)
      return verifyPriceApprovalReview(
        await api.post(`${endpoint}/review`, {
          changes: draft.items.map((i) => ({ sku: i.sku, version: i.version })),
        }),
        draft.items,
      );
    if (sku)
      return verifyPriceApprovalReview(
        await api.get(`${endpoint}/items/${encodeURIComponent(sku)}`),
        [{ sku }],
      );
    return null;
  }, [sku, path]);
  const review = source.data,
    manualPending = usePriceRequests(owner).edits.some((j) =>
      review?.items.some((i) => i.sku === j.packet.sku),
    ),
    approvalJobs = usePriceJobs(owner),
    pending =
      manualPending ||
      approvalJobs.some((j) =>
        j.packet.changes.some((c) =>
          review?.items.some((i) => i.sku === c.sku),
        ),
      );
  const emptyNativePatch =
    decision === "approve" &&
    review?.items.some((i) =>
      Object.values(i.proposed).every((v) => v == null),
    );
  async function save() {
    if (
      !review ||
      source.loading ||
      source.error ||
      !confirmed ||
      pending ||
      emptyNativePatch ||
      review.ownership !== "commerce" ||
      !["approve", "reject"].includes(decision ?? "") ||
      writer.busy
    )
      return;
    const packet = priceApprovalPacketSchema.parse({
        requestId: crypto.randomUUID(),
        decision,
        changes: review.items.map((i) => ({ sku: i.sku, version: i.version })),
      }),
      job = { owner, packet, review, conflict: false };
    const result = await writer.write(job);
    if (!writer.mounted.current) return;
    if (result.ok) {
      try {
        localStorage.removeItem(reviewKey(owner, path));
      } catch {
        /* Persisted outcome remains authoritative. */
      }
    }
    if (
      result.ok ||
      readPriceJobs(owner).some((j) => j.packet.requestId === packet.requestId)
    )
      navigate(outcome(packet.requestId));
  }
  return (
    <>
      <PageHeader
        title={text("ยืนยันการตัดสินใจราคา", "Confirm price decision")}
      />
      <WorkspaceLink to={sku ? detail(sku) : home}>
        {text("กลับไปตรวจข้อมูลปัจจุบัน", "Review current data again")}
      </WorkspaceLink>
      <PendingRequests owner={owner} />
      <ErrorText error={writer.error} />
      <ErrorText error={source.error} onRetry={source.reload} />
      {!["approve", "reject"].includes(decision ?? "") ? (
        <Alert tone="danger">
          {text(
            "เลือกอนุมัติหรือปฏิเสธจากหน้าข้อมูลก่อน",
            "Choose approve or reject from the evidence page first.",
          )}
        </Alert>
      ) : source.loading ? (
        <Loading variant="detail" />
      ) : source.error ? (
        <>
          {draft?.items.map((i) => (
            <PriceEvidence
              key={i.sku}
              item={i}
              decision={decision ?? undefined}
            />
          ))}
          <Alert tone="warn">
            {text(
              "หลักฐานเดิมยังไม่ผ่านการตรวจปัจจุบัน จึงยังไม่ส่งคำขอ",
              "Retained evidence has not passed the current check. No request can be sent.",
            )}
          </Alert>
        </>
      ) : !review ? (
        <Empty>
          {text(
            "ยังไม่มีรายการที่เลือก กลับคิวเพื่อเลือก",
            "No reviewed selection. Return to the queue to choose.",
          )}
        </Empty>
      ) : (
        <>
          <h2 className="font-semibold">{decisionLabel(decision!)}</h2>
          {review.items.map((i) => (
            <PriceEvidence
              key={i.sku}
              item={i}
              decision={decision ?? undefined}
            />
          ))}
          <Scope decision={decision!} count={review.items.length} />
          {emptyNativePatch && (
            <Alert tone="danger">
              {text(
                "ข้อเสนอบาง SKU ไม่มีค่า ERP ให้บันทึก อนุมัติไม่ได้ ตรวจคิวอีกครั้งหรือพิจารณาปฏิเสธ",
                "An ERP proposal contains no price fields to apply. Approval is unavailable. Review the queue or consider rejection.",
              )}
            </Alert>
          )}
          {review.ownership !== "commerce" && (
            <Alert tone="warn">
              {text(
                "Josh ยังเป็นเจ้าของราคา ยังบันทึกที่นี่ไม่ได้",
                "Josh still owns prices. No decision can be saved here.",
              )}
            </Alert>
          )}
          <label className="flex items-start gap-3 min-w-0">
            <Checkbox
              aria-label={text(
                "ยืนยันว่าตรวจราคาและผลกระทบแล้ว",
                "Confirm reviewed values and consequences",
              )}
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={writer.busy}
            />
            <span className="min-w-0 break-words">
              {text(
                "ฉันตรวจค่าและขอบเขตข้างต้นแล้ว และยืนยันการตัดสินใจนี้",
                "I reviewed these values and their scope and confirm this decision.",
              )}
            </span>
          </label>
          <Button
            variant="primary"
            disabled={
              !confirmed ||
              writer.busy ||
              pending ||
              emptyNativePatch ||
              review.ownership !== "commerce"
            }
            onClick={() => void save()}
          >
            {writer.busy
              ? text("กำลังบันทึก", "Saving decision")
              : decisionLabel(decision!)}
          </Button>
        </>
      )}
    </>
  );
}
function Receipt({ receipt }: { receipt: PriceApprovalReceipt }) {
  return (
    <>
      <Alert tone="ok">
        <strong>
          {receipt.packet.decision === "approve"
            ? text(
                `อนุมัติแล้ว ${receipt.appliedCount} SKU`,
                `Approved ${receipt.appliedCount} SKU(s)`,
              )
            : text(
                `ปฏิเสธแล้ว ${receipt.appliedCount} SKU`,
                `Rejected ${receipt.appliedCount} SKU(s)`,
              )}
        </strong>
        <p>{date(receipt.savedAt)}</p>
      </Alert>
      <p>
        {receipt.outboxEnqueued
          ? text(
              "บันทึกและเข้าคิว snapshot แล้ว ยังไม่ยืนยันว่าร้านได้รับ",
              "Saved and snapshot queued. Shop delivery remains unverified.",
            )
          : text(
              "ข้อเสนอถูกลบ ราคาปัจจุบันคงเดิม ไม่ส่ง snapshot",
              "Proposals removed. Current prices unchanged; no snapshot sent.",
            )}
      </p>
      {receipt.items.map((i) => (
        <div key={i.before.sku} className="space-y-2">
          <PriceEvidence
            item={i.before}
            decision={receipt.packet.decision}
            historical
          />
          <Panel>
            <div className="p-4">
              <h3 className="font-semibold">
                {text(
                  "ค่าที่บันทึกหลังตัดสินใจ",
                  "Recorded values after decision",
                )}
              </h3>
              <p>
                {show(i.after.sellingUnitPrice)} · {show(i.after.orderingPrice)}{" "}
                · MOQ: {show(i.after.moq)}
              </p>
            </div>
          </Panel>
        </div>
      ))}
      <WorkspaceLink to={home}>
        {text("เปิดคิวปัจจุบัน", "Open current queue")}
      </WorkspaceLink>
      <WorkspaceLink to={`${home}/current`}>
        {text("อ่านราคาปัจจุบัน", "Read current prices")}
      </WorkspaceLink>
    </>
  );
}
function Recovery({ id, owner }: { id: string; owner: string }) {
  const job = usePriceJobs(owner).find((j) => j.packet.requestId === id),
    [confirmed, setConfirmed] = useState(false),
    writer = usePriceWriter(owner);
  const result = useAsync(async () => {
    try {
      const receipt = verifyPriceApprovalReceipt(
        await api.get(`${endpoint}/requests/${id}`),
        job?.packet,
      );
      return { receipt, absent: false };
    } catch (e) {
      if ((e as { status?: number }).status === 404)
        return { receipt: null, absent: true };
      throw e;
    }
  }, [id, owner]);
  useEffect(() => {
    if (result.data?.receipt && !result.loading && !result.error) {
      try {
        clearPriceJob(owner, id);
      } catch {
        /* Server receipt remains recoverable. */
      }
    }
  }, [result.data, result.loading, result.error, owner, id]);
  const retry = async () => {
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
    const r = await writer.write(job);
    if (r.ok && writer.mounted.current) result.reload();
  };
  return (
    <>
      <PageHeader
        title={text("ผลการตัดสินใจราคา", "Price decision outcome")}
        subtitle={id}
      />
      <WorkspaceLink to={home}>
        {text("กลับคิวราคา", "Back to price queue")}
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
              "ยังไม่พบผลบันทึกของคำขอนี้สำหรับบัญชีนี้ ไม่ถือว่าสำเร็จ",
              "No committed outcome found for this account. Completion is unconfirmed.",
            )}
          </Alert>
          {job ? (
            <>
              {job.review.items.map((i) => (
                <PriceEvidence
                  key={i.sku}
                  item={i}
                  decision={job.packet.decision}
                />
              ))}
              <Scope
                decision={job.packet.decision}
                count={job.packet.changes.length}
              />
              {job.conflict ? (
                <Alert tone="warn">
                  {text(
                    "ข้อมูลเปลี่ยนแล้ว ต้องตรวจคิวปัจจุบัน ไม่ส่งคำขอเก่าซ้ำ",
                    "Evidence changed. Review the current queue; do not resend this stale request.",
                  )}
                  <Button
                    onClick={() => {
                      try {
                        clearPriceJob(owner, id);
                      } catch {
                        /* Keep original on storage failure. */
                      }
                    }}
                  >
                    {text(
                      "ปิดคำขอเก่าที่ไม่บันทึก",
                      "Dismiss uncommitted stale request",
                    )}
                  </Button>
                </Alert>
              ) : (
                <>
                  <label className="flex gap-3 min-w-0">
                    <Checkbox
                      aria-label={text(
                        "ยืนยันส่งคำขอเดิมซ้ำ",
                        "Confirm exact original retry",
                      )}
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      disabled={writer.busy}
                    />
                    <span className="min-w-0 break-words">
                      {text(
                        "ตรวจแล้วว่ายังไม่มีผลบันทึก และต้องการส่งเฉพาะคำขอเดิม",
                        "I checked that no outcome is recorded and want to retry only the exact original request.",
                      )}
                    </span>
                  </label>
                  <Button
                    disabled={!confirmed || writer.busy}
                    onClick={() => void retry()}
                  >
                    {text(
                      "ส่งคำขอเดิมหลังตรวจผลแล้ว",
                      "Retry checked original request",
                    )}
                  </Button>
                </>
              )}
            </>
          ) : (
            <Empty>
              {text(
                "ไม่มีคำขอกู้คืนในเครื่องนี้ เปิดคิวเพื่อตรวจใหม่",
                "No local recovery intent. Open the queue to review current evidence.",
              )}
            </Empty>
          )}
          <Button onClick={result.reload}>
            {text("ตรวจผลคำขอเดิมอีกครั้ง", "Check original outcome again")}
          </Button>
        </>
      )}
    </>
  );
}
export function PriceApprovalWorkspace({
  role = session.claims()?.role ?? "",
  owner = session.claims()?.sub ?? "",
}: {
  role?: string;
  owner?: string;
}) {
  useUiLocale();
  const location = useLocation();
  if (!canApprovePrices(role) || !owner)
    return (
      <ErrorText
        error={text(
          "คุณไม่มีสิทธิ์เปิดคิวราคา",
          "This account cannot access price decisions",
        )}
      />
    );
  const tail = location.pathname.slice(home.length);
  if (tail === "/current" || tail.startsWith("/current/"))
    return <CurrentPrices key={owner} owner={owner} role={role} />;
  if (!tail || tail === "/")
    return (
      <CommercePage>
        <Queue key={owner} owner={owner} />
      </CommercePage>
    );
  if (tail === "/review")
    return (
      <CommercePage>
        <Review key={owner + location.key} owner={owner} />
      </CommercePage>
    );
  const request = tail.match(/^\/requests\/([^/]+)$/);
  const parsedRequest = priceRequestId.safeParse(request?.[1]);
  if (parsedRequest.success)
    return (
      <CommercePage>
        <Recovery
          key={owner + parsedRequest.data}
          id={parsedRequest.data}
          owner={owner}
        />
      </CommercePage>
    );
  const item = tail.match(/^\/pending\/([^/]+)(\/review)?$/);
  if (item) {
    const sku = priceSkuFromToken(item[1]);
    if (sku)
      return (
        <CommercePage>
          {item[2] ? (
            <Review key={owner + location.key} sku={sku} owner={owner} />
          ) : (
            <Detail key={owner + sku} sku={sku} owner={owner} />
          )}
        </CommercePage>
      );
  }
  return (
    <CommercePage>
      <Alert tone="danger">
        {text("ไม่พบหน้าการตัดสินใจนี้", "Price decision page not found")}
      </Alert>
      <WorkspaceLink to={home}>
        {text("เปิดคิวราคา", "Open price queue")}
      </WorkspaceLink>
    </CommercePage>
  );
}
