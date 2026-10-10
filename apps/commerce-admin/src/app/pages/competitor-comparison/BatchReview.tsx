import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Chip,
  Empty,
  PageHeader,
  Panel,
  TaskInput,
  TaskSelect,
} from "@cp/ui";
import { CommercePage } from "../../CommercePage";
import { WorkspaceLink } from "../../WorkspaceParts";
import { commerceText as text } from "../../commerce-copy";
import {
  COMPARISON_HOME as home,
  canChangeComparison,
  type ComparisonWorkspace,
  type ComparisonPacket,
} from "../../../../../commerce-platform/src/modules/integration/competitor-prices/comparison-contracts";
import { comparisonFormKey, readComparisonJobs } from "./comparison-journal";
import { useComparisonWriter, useJobs } from "./comparison-interactions";
import {
  batchBase,
  batchIsStale,
  batchPacket,
  emptyBatch,
  readBatch,
  storeBatch,
  type BatchDraft,
} from "./comparison-batch";
const decisionLabel = (value: string) =>
  ({
    uncertain: text(
      "ยังไม่ยืนยันว่าเป็นสินค้าเดียวกัน",
      "Keep match uncertain",
    ),
    same_product: text(
      "เป็นสินค้าเดียวกัน หลังตรวจหลักฐาน",
      "Same product after evidence review",
    ),
    substitute: text("เป็นสินค้าทดแทน", "Substitute product"),
    remove: text(
      "เลิกใช้คู่นี้และเก็บประวัติเดิม",
      "Remove pair and retain history",
    ),
  })[value] ?? value;
export function BatchReview({
  workspace,
  owner,
  role,
  review,
}: {
  workspace: ComparisonWorkspace;
  owner: string;
  role: string;
  review: boolean;
}) {
  const navigate = useNavigate(),
    base = batchBase(workspace.sku),
    writer = useComparisonWriter(owner),
    jobs = useJobs(owner),
    lock = useRef(false),
    mounted = useRef(true);
  const [draft, setDraft] = useState<BatchDraft>(
    () => readBatch(owner, workspace.sku) ?? emptyBatch(workspace),
  );
  const [error, setError] = useState<string | null>(null),
    [storageError, setStorageError] = useState<string | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const stale = batchIsStale(draft, workspace),
    pending = jobs.filter((j) => j.packet.sku === workspace.sku),
    allowed = canChangeComparison(role);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!allowed) return;
    try {
      storeBatch(owner, draft);
      setStorageError(null);
    } catch {
      setStorageError(
        text(
          "ยังเก็บข้อมูลทบทวนไม่ได้ จึงยังส่งบันทึกไม่ได้",
          "Review storage is unavailable. No save can be sent.",
        ),
      );
    }
  }, [draft, owner, allowed]);
  function prepare(): ComparisonPacket | null {
    try {
      const p = batchPacket(draft, workspace, crypto.randomUUID());
      setError(null);
      return p;
    } catch {
      setError(
        text(
          "เลือก 1–20 คู่ และใส่เหตุผลอย่างน้อย 10 ตัวอักษรต่อคู่ ตรวจหลักฐานล่าสุดก่อนทบทวน",
          "Choose 1–20 pairs and enter a reason of at least 10 characters for each. Review current evidence before continuing.",
        ),
      );
      return null;
    }
  }
  async function confirm() {
    if (
      lock.current ||
      !confirmed ||
      stale ||
      pending.length ||
      storageError ||
      !allowed
    )
      return;
    lock.current = true;
    const packet = prepare();
    if (!packet) {
      lock.current = false;
      return;
    }
    const result = await writer.write({ owner, packet, conflict: false });
    lock.current = false;
    if (result) {
      try {
        localStorage.removeItem(comparisonFormKey(owner, base));
      } catch {
        /* The validated durable receipt remains authoritative. */
      }
    }
    if (
      !result &&
      !readComparisonJobs(owner).some(
        (j) => j.packet.requestId === packet.requestId,
      )
    )
      return;
    if (mounted.current) navigate(`${home}/requests/${packet.requestId}`);
  }
  const update = (
    pairId: string,
    values: Partial<BatchDraft["choices"][number]>,
  ) => {
    setDraft((d) => ({
      ...d,
      choices: d.choices.map((c) =>
        c.pairId === pairId ? { ...c, ...values } : c,
      ),
    }));
    setError(null);
    setConfirmed(false);
  };
  return (
    <CommercePage>
      <WorkspaceLink
        to={`${home}/products/${encodeURIComponent(workspace.sku)}`}
      >
        {text("กลับไปตรวจสินค้า", "Back to product evidence")}
      </WorkspaceLink>
      <PageHeader
        title={
          review
            ? text(
                "ยืนยันการทบทวนคู่ที่เลือก",
                "Confirm selected pair decisions",
              )
            : text("ทบทวนหลายคู่ของสินค้านี้", "Review selected product pairs")
        }
        subtitle={`${workspace.inputs.product.name} · ${workspace.sku}`}
      />
      <Alert tone="muted">
        {text(
          "เลือกได้สูงสุด 20 คู่ เฉพาะคู่สินค้าที่เลือกของ SKU นี้ ไม่ยืนยันข้อเสนออัตโนมัติและไม่ทำเครื่องหมายทบทวน SKU การยืนยันคู่ไม่ยืนยันราคาหรือความพร้อมแคมเปญ",
          "Choose up to 20 recorded pairs. Only selected pairs for this SKU are changed. Suggestions are never accepted automatically and the SKU reviewed marker is unchanged. Match review does not establish price or campaign readiness.",
        )}
      </Alert>
      <p role="status">
        <Chip>
          {text("เลือกแล้ว", "Selected pairs")}: {draft.choices.length} /{" "}
          {workspace.rows.length}
        </Chip>
      </p>
      {workspace.observationsTruncated && (
        <Alert tone="warn">
          {text(
            "ข้อมูลคู่สินค้าถูกจำกัด ไม่ใช่รายการทั้งหมด",
            "Returned pairs are truncated; this is not the complete collection.",
          )}
        </Alert>
      )}
      {!allowed ? (
        <Alert tone="muted">
          {text(
            "บัญชีนี้อ่านอย่างเดียว จึงไม่มีการส่งบันทึก",
            "This account is read-only; no action is dispatched.",
          )}
        </Alert>
      ) : (
        <>
          {stale && (
            <Alert tone="warn">
              {text(
                "หลักฐานเปลี่ยน คำตัดสินเดิมยังเก็บไว้และส่งไม่ได้ ตรวจคู่ล่าสุดก่อนเลือกใหม่",
                "Evidence changed. Retained decisions cannot be submitted. Inspect current pairs before choosing again.",
              )}
              <Button
                onClick={() => {
                  setDraft(emptyBatch(workspace));
                  setConfirmed(false);
                  setError(null);
                  navigate(base);
                }}
              >
                {text(
                  "ทิ้งคำตัดสินเดิมและตรวจคู่ล่าสุด",
                  "Discard retained decisions and review current pairs",
                )}
              </Button>
            </Alert>
          )}
          {pending.length > 0 && (
            <Panel>
              <div className="p-4 space-y-2">
                <Alert tone="warn">
                  {text(
                    "ตรวจผลคำขอเดิมก่อนส่งงานใหม่",
                    "Reconcile the original request before another action.",
                  )}
                </Alert>
                {pending.map((j) => (
                  <WorkspaceLink
                    key={j.packet.requestId}
                    to={`${home}/requests/${j.packet.requestId}`}
                  >
                    {text("ตรวจคำขอเดิม", "Check original request")}
                  </WorkspaceLink>
                ))}
              </div>
            </Panel>
          )}
          {(storageError || error || writer.error) && (
            <Alert tone="danger">{storageError || error || writer.error}</Alert>
          )}
          {review ? (
            <Panel>
              <div className="p-4 space-y-4">
                {!draft.choices.length && (
                  <Empty>
                    {text(
                      "ยังไม่ได้เลือกคู่สินค้า กลับไปเลือกก่อน",
                      "No pairs selected. Choose pairs first.",
                    )}
                  </Empty>
                )}
                {draft.choices.map((c) => {
                  const row = workspace.rows.find((r) => r.id === c.pairId);
                  return (
                    <Panel key={c.pairId}>
                      <div className="p-3 space-y-2">
                        <strong className="break-words">
                          {row?.vendor ?? c.pairId}
                        </strong>
                        <p className="break-words">
                          {row?.url ??
                            text(
                              "คู่เดิมไม่มีในข้อมูลล่าสุด",
                              "Original pair is absent from current evidence",
                            )}
                        </p>
                        <p>
                          {text("ฉบับที่ทบทวน", "Reviewed revision")}:{" "}
                          {c.revision}
                        </p>
                        <p>
                          {text("คำตัดสิน", "Decision")}:{" "}
                          {decisionLabel(c.decision)}
                        </p>
                        <p className="break-words">{c.note}</p>
                        {c.decision === "remove" && (
                          <Alert tone="warn">
                            {text(
                              "คู่นี้จะหายจากผลเทียบ แต่หลักฐานเดิมและผลการลบยังอยู่ในประวัติ",
                              "This pair will leave the comparison. Original evidence and the removal outcome remain in history.",
                            )}
                          </Alert>
                        )}
                      </div>
                    </Panel>
                  );
                })}
                <Alert tone="warn">
                  {text(
                    "ผลแต่ละคู่บันทึกแยกกัน คู่ที่ล้มเหลวจะไม่ถูกนับว่าสำเร็จ ตรวจใบรับผลก่อนทำงานใหม่ หากข้อมูลเปลี่ยนต้องทบทวนใหม่",
                    "Each pair has its own persisted outcome. Failed pairs are never counted as completed. Inspect the receipt before another action; changed evidence requires a new review.",
                  )}
                </Alert>
                <WorkspaceLink to={base}>
                  {text("กลับไปแก้คำตัดสิน", "Edit selected decisions")}
                </WorkspaceLink>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span>
                    {text(
                      "ฉันตรวจคู่ที่เลือกและยืนยันผลตามรายการนี้",
                      "I reviewed the selected pairs and confirm these consequences",
                    )}
                  </span>
                </label>
                <Button
                  disabled={
                    !confirmed ||
                    !draft.choices.length ||
                    stale ||
                    !!pending.length ||
                    !!storageError ||
                    writer.busy
                  }
                  onClick={confirm}
                >
                  {writer.busy
                    ? text("กำลังบันทึก…", "Saving…")
                    : text(
                        "ยืนยันและบันทึกคู่ที่เลือก",
                        "Confirm and save selected pairs",
                      )}
                </Button>
              </div>
            </Panel>
          ) : (
            <>
              {!workspace.rows.length && (
                <Empty>
                  {text(
                    "ยังไม่มีคู่ที่บันทึกไว้ เพิ่มคู่ทีละรายการก่อน",
                    "No recorded pairs yet. Add and inspect a pair first.",
                  )}
                </Empty>
              )}
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!stale && !storageError && !pending.length && prepare())
                    navigate(base + "/review");
                }}
              >
                {workspace.rows.map((row) => {
                  const chosen = draft.choices.find((c) => c.pairId === row.id);
                  return (
                    <Panel key={row.id}>
                      <div className="p-4 space-y-3">
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={!!chosen}
                            disabled={
                              stale || (!chosen && draft.choices.length >= 20)
                            }
                            onChange={(e) => {
                              setDraft((d) => ({
                                ...d,
                                choices: e.target.checked
                                  ? [
                                      ...d.choices,
                                      {
                                        pairId: row.id,
                                        revision: row.revision,
                                        decision: "uncertain",
                                        note: "",
                                      },
                                    ]
                                  : d.choices.filter(
                                      (c) => c.pairId !== row.id,
                                    ),
                              }));
                              setError(null);
                            }}
                          />
                          <span className="min-w-0 break-words">
                            {text("เลือก", "Select")}: {row.vendor} ·{" "}
                            {String(row.observation.productName)}
                          </span>
                        </label>
                        <p className="break-words">{row.url}</p>
                        <p>
                          {text("สถานะที่บันทึก", "Recorded relationship")}:{" "}
                          {decisionLabel(row.relationship)} ·{" "}
                          {text("ฉบับ", "Revision")}: {row.revision}
                        </p>
                        <WorkspaceLink
                          to={`${home}/products/${encodeURIComponent(workspace.sku)}/pairs/${row.id}`}
                        >
                          {text(
                            "ตรวจหลักฐานและประวัติคู่นี้",
                            "Inspect this pair and its history",
                          )}
                        </WorkspaceLink>
                        {chosen && (
                          <div className="grid gap-3 md:grid-cols-2">
                            <TaskSelect
                              label={
                                text("คำตัดสินสำหรับ", "Decision for") +
                                " " +
                                row.vendor +
                                " · " +
                                row.id
                              }
                              value={chosen.decision}
                              onChange={(e) =>
                                update(row.id, {
                                  decision: e.target
                                    .value as BatchDraft["choices"][number]["decision"],
                                })
                              }
                            >
                              {[
                                "uncertain",
                                "same_product",
                                "substitute",
                                "remove",
                              ].map((v) => (
                                <option key={v} value={v}>
                                  {decisionLabel(v)}
                                </option>
                              ))}
                            </TaskSelect>
                            <TaskInput
                              label={
                                text("เหตุผลสำหรับ", "Reason for") +
                                " " +
                                row.vendor +
                                " · " +
                                row.id
                              }
                              value={chosen.note}
                              error={
                                error && chosen.note.trim().length < 10
                                  ? text(
                                      "ใส่เหตุผลอย่างน้อย 10 ตัวอักษร",
                                      "Enter a reason of at least 10 characters",
                                    )
                                  : undefined
                              }
                              maxLength={900}
                              onChange={(e) =>
                                update(row.id, { note: e.target.value })
                              }
                            />
                          </div>
                        )}
                      </div>
                    </Panel>
                  );
                })}
                <Button
                  type="submit"
                  disabled={
                    !draft.choices.length ||
                    stale ||
                    !!storageError ||
                    !!pending.length
                  }
                >
                  {text("ทบทวนคู่ที่เลือก", "Review selected decisions")}
                </Button>
              </form>
            </>
          )}
        </>
      )}
    </CommercePage>
  );
}
