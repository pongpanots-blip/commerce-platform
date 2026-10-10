import { useEffect, useRef, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Button,
  Chip,
  Empty,
  Loading,
  PageHeader,
  Panel,
  PanelHead,
  TaskInput,
  TaskSelect,
  useUiLocale,
} from "@cp/ui";
import { z } from "zod";
import { api, salesAssignmentApi, session } from "../../lib/api";
import { CommercePage } from "../CommercePage";
import { commerceText as text } from "../commerce-copy";
import { useAsync } from "../hooks";
import { WorkspaceLink } from "../WorkspaceParts";
import { PlanningError } from "./planning/PlanningError";
import {
  ASSIGNMENT_API as endpoint,
  ASSIGNMENT_HOME as home,
  assignmentPacketSchema,
  assignmentReviewSchema,
  assignmentSelectionSchema,
  assignmentUuid,
  canAssignCustomers,
  verifyAssignmentReceipt,
  type AssignmentPacket,
  type AssignmentReceipt,
  type AssignmentReview,
} from "../../../../commerce-platform/src/modules/integration/customers/assignment-contracts";
import {
  assignmentFormKey,
  clearAssignmentJob,
  readAssignmentJobs,
  storeAssignmentJob,
  type AssignmentJob,
} from "./sales-assignment/assignment-journal";
const companyListSchema = z.strictObject({
  items: z.array(z.object({ id: assignmentUuid, name: z.string() })).max(20),
  hasMore: z.boolean(),
  ownership: z.enum(["commerce", "josh"]),
  sourceFreshness: z.literal("unverified"),
});
const requestUrl = (id: string) => `${home}/requests/${id}`;
const ownerName = (owner: { name: string } | null) =>
  owner?.name || text("ยังไม่มีผู้ดูแลที่บันทึกไว้", "No recorded owner");
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
type Selection = z.infer<typeof assignmentSelectionSchema>;
function selectionUrl(selection: Selection, review = false) {
  return `${home}/assign${review ? "/review" : ""}?${new URLSearchParams({ companies: selection.companyIds.join(","), owner: selection.salesUserId ?? "clear" })}`;
}
function useJobs(owner: string) {
  const [jobs, set] = useState(() => readAssignmentJobs(owner));
  useEffect(() => {
    const refresh = () => set(readAssignmentJobs(owner));
    window.addEventListener("cp-assignment-journal", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("cp-assignment-journal", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [owner]);
  return jobs;
}
function Pending({ owner }: { owner: string }) {
  const jobs = useJobs(owner);
  if (!jobs.length) return null;
  return (
    <Panel>
      <PanelHead
        title={text("ตรวจคำขอที่ยังไม่ยืนยันผล", "Check unresolved requests")}
      />
      <div className="p-4 space-y-3">
        <p>
          {text(
            "เปิดคำขอเดิมก่อนเริ่มการมอบหมายครั้งใหม่",
            "Open the original request before starting another assignment.",
          )}
        </p>
        {jobs.map((j) => (
          <WorkspaceLink
            key={j.packet.requestId}
            to={requestUrl(j.packet.requestId)}
          >
            {text("ตรวจผลการบันทึก", "Check save outcome")} ·{" "}
            {j.packet.changes.length} {text("บริษัท", "companies")} ·{" "}
            {j.packet.requestId}
          </WorkspaceLink>
        ))}
      </div>
    </Panel>
  );
}
function useWriter(owner: string) {
  const lock = useRef(false),
    mounted = useRef(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function write(packet: AssignmentPacket) {
    if (lock.current || !mounted.current) return null;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      try {
        storeAssignmentJob({ owner, packet });
      } catch {
        throw Error(
          text(
            "ยังเก็บคำขอกู้คืนไม่ได้ จึงยังไม่ส่งบันทึก",
            "Recovery storage is unavailable. No save was sent.",
          ),
        );
      }
      let receipt: AssignmentReceipt;
      try {
        receipt = verifyAssignmentReceipt(
          await api.post(`${endpoint}/actions`, packet),
          packet,
        );
      } catch (e) {
        if (
          [400, 404, 409, 422].includes((e as { status?: number }).status ?? 0)
        )
          try {
            storeAssignmentJob({ owner, packet, rejected: true });
          } catch {
            /* Original immutable packet remains recoverable. */
          }
        throw Error(
          text(
            "ยังยืนยันผลบันทึกไม่ได้ ตรวจคำขอเดิมก่อนส่งซ้ำ",
            "Save outcome is unverified. Check the original request before submitting again.",
          ),
        );
      }
      try {
        clearAssignmentJob(owner, packet.requestId);
      } catch {
        /* A retained committed request can be reconciled safely. */
      }
      return mounted.current ? receipt : null;
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
      return null;
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { write, busy, error };
}
export function SalesAssignment({ role }: { role?: string }) {
  useUiLocale();
  const location = useLocation(),
    owner = String(session.claims()?.sub ?? ""),
    currentRole = role ?? String(session.claims()?.role ?? "");
  if (!canAssignCustomers(currentRole) || !owner)
    return (
      <CommercePage>
        <Alert tone="warn">
          {text(
            "เฉพาะแอดมินและผู้จัดการฝ่ายขายเท่านั้นที่มอบหมายผู้ดูแลได้",
            "Only administrators and sales managers can assign customer coverage.",
          )}
        </Alert>
      </CommercePage>
    );
  const relative = location.pathname.slice(home.length);
  if (relative.startsWith("/requests/")) {
    const id = assignmentUuid.safeParse(relative.slice(10));
    return id.success ? (
      <Recovery key={`${owner}:${id.data}`} owner={owner} id={id.data} />
    ) : (
      <CommercePage>
        <Alert tone="warn">
          {text("รหัสคำขอไม่ถูกต้อง", "Invalid request ID")}
        </Alert>
        <WorkspaceLink to={home}>
          {text("กลับไปเลือกบริษัท", "Choose companies")}
        </WorkspaceLink>
      </CommercePage>
    );
  }
  if (relative === "/assign/review")
    return <Review key={`${owner}:${location.search}`} owner={owner} />;
  if (!relative || relative === "/" || relative === "/assign")
    return <Choose key={owner} owner={owner} />;
  return <Navigate to={home} replace />;
}
function Choose({ owner }: { owner: string }) {
  const [params] = useSearchParams(),
    navigate = useNavigate();
  const initial = () => {
    const query = assignmentSelectionSchema.safeParse({
      companyIds: (params.get("companies") ?? "").split(",").filter(Boolean),
      salesUserId: params.get("owner") === "clear" ? null : params.get("owner"),
    });
    if (query.success) return query.data;
    try {
      const stored = assignmentSelectionSchema.safeParse(
        JSON.parse(localStorage.getItem(assignmentFormKey(owner)) ?? "null"),
      );
      return stored.success ? stored.data : null;
    } catch {
      return null;
    }
  };
  const [selection, setSelection] = useState(initial),
    [ids, setIds] = useState<string[]>(selection?.companyIds ?? []),
    [repId, setRepId] = useState(
      selection ? (selection.salesUserId ?? "clear") : "",
    ),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState<string | null>(null);
  const companies = useAsync(
    async () =>
      companyListSchema.parse(
        await api.get(
          `${endpoint}/companies?search=${encodeURIComponent(query)}`,
        ),
      ),
    [query],
  );
  const reps = useAsync(salesAssignmentApi.reps, []);
  function toggle(id: string) {
    setError(null);
    setIds((current) =>
      current.includes(id)
        ? current.filter((i) => i !== id)
        : current.length < 20
          ? [...current, id]
          : current,
    );
  }
  function review() {
    const parsed = assignmentSelectionSchema.safeParse({
      companyIds: ids,
      salesUserId: repId === "clear" ? null : repId,
    });
    if (!parsed.success) {
      setError(
        text(
          "เลือก 1–20 บริษัท และเลือกผู้ดูแลใหม่หรือล้างผู้ดูแล",
          "Choose 1–20 companies and a new owner or clear the owner.",
        ),
      );
      return;
    }
    try {
      localStorage.setItem(
        assignmentFormKey(owner),
        JSON.stringify(parsed.data),
      );
      setSelection(parsed.data);
    } catch {
      /* Review remains navigable; the request journal is mandatory before dispatch. */
    }
    navigate(selectionUrl(parsed.data, true));
  }
  return (
    <CommercePage>
      <PageHeader
        title={text("มอบหมายผู้ดูแลลูกค้า", "Assign customer coverage")}
        subtitle={text(
          "เลือกบริษัท ตรวจผู้ดูแลเดิมและขอบเขต แล้วจึงยืนยันบันทึก",
          "Choose companies, review current owners and scope, then confirm the save.",
        )}
      />
      <Pending owner={owner} />
      <Panel>
        <PanelHead
          title={text(
            "เลือกบริษัทที่ต้องการมอบหมาย",
            "Choose companies to assign",
          )}
        />
        <div className="p-4 space-y-4">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search.trim());
            }}
          >
            <div className="flex-1 min-w-0">
              <TaskInput
                label={text(
                  "ค้นหาชื่อบริษัทหรือรหัส",
                  "Find company by name or code",
                )}
                type="search"
                value={search}
                maxLength={100}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button type="submit">{text("ค้นหา", "Search")}</Button>
          </form>
          {companies.loading ? (
            <Loading variant="table" />
          ) : companies.error ? (
            <>
              <PlanningError error={companies.error} />
              <Button onClick={companies.reload}>
                {text("ลองอ่านบริษัทอีกครั้ง", "Retry companies")}
              </Button>
            </>
          ) : (
            companies.data && (
              <>
                {companies.data.ownership === "josh" && (
                  <Alert tone="warn">
                    {text(
                      "Josh ยังเป็นเจ้าของการมอบหมาย Commerce ยังบันทึกไม่ได้",
                      "Josh still owns assignments. Commerce cannot save them.",
                    )}
                  </Alert>
                )}
                {!companies.data.items.length ? (
                  <Empty>
                    {text(
                      "ไม่พบบริษัท ลองชื่อหรือรหัสอื่น",
                      "No matching companies. Try another name or code.",
                    )}
                  </Empty>
                ) : (
                  <ul className="space-y-2">
                    {companies.data.items.map((c) => (
                      <li key={c.id}>
                        <label className="flex min-h-11 gap-3 items-start rounded-lg border border-secondary-container p-3">
                          <input
                            className="mt-1 size-5 shrink-0"
                            type="checkbox"
                            checked={ids.includes(c.id)}
                            disabled={!ids.includes(c.id) && ids.length >= 20}
                            onChange={() => toggle(c.id)}
                          />
                          <span className="min-w-0 break-words">
                            {c.name}
                            <span className="block text-xs text-on-surface-variant">
                              {c.id}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {companies.data.hasMore && (
                  <p>
                    {text(
                      "แสดง 20 บริษัทแรกที่ตรงคำค้น ระบุคำค้นให้ละเอียดขึ้น",
                      "Showing the first 20 matching companies. Narrow the search to find more.",
                    )}
                  </p>
                )}
              </>
            )
          )}
          <p aria-live="polite">
            {text("เลือกไว้", "Selected")}: {ids.length}/20{" "}
            {text("บริษัท", "companies")}
          </p>
          {!!ids.length && (
            <details>
              <summary>
                {text(
                  "ดูรหัสบริษัทที่เลือก รวมจากคำค้นก่อนหน้า",
                  "View selected company IDs, including earlier searches",
                )}
              </summary>
              {ids.map((id) => (
                <div key={id} className="flex flex-wrap gap-2 items-center p-2">
                  <span className="break-all">
                    {companies.data?.items.find((c) => c.id === id)?.name ?? id}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => toggle(id)}
                    aria-label={`${text("นำออก", "Remove")} ${id}`}
                  >
                    {text("นำออก", "Remove")}
                  </Button>
                </div>
              ))}
            </details>
          )}
          {reps.error ? (
            <>
              <PlanningError error={reps.error} />
              <Button onClick={reps.reload}>
                {text("ลองอ่านรายชื่ออีกครั้ง", "Retry sales reps")}
              </Button>
            </>
          ) : (
            <TaskSelect
              label={text("ผู้ดูแลใหม่", "New owner")}
              error={
                error && !repId
                  ? text(
                      "เลือกผู้ดูแลใหม่หรือล้างผู้ดูแล",
                      "Choose a new owner or clear recorded coverage.",
                    )
                  : undefined
              }
              loading={reps.loading}
              value={repId}
              onChange={(e) => setRepId(e.target.value)}
              required
              help={text(
                "ใช้รายชื่อผู้ดูแลที่มีสิทธิ์และยังใช้งานอยู่ตามกฎเดิม",
                "Uses the existing active, eligible sales roster.",
              )}
            >
              <option value="">
                {text("เลือกผู้ดูแลใหม่", "Choose a new owner")}
              </option>
              <option value="clear">
                {text("ล้างผู้ดูแลที่บันทึกไว้", "Clear recorded owner")}
              </option>
              {(reps.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.id.slice(0, 8)}
                </option>
              ))}
            </TaskSelect>
          )}
          <PlanningError error={error} />
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                companies.loading ||
                !!companies.error ||
                companies.data?.ownership !== "commerce" ||
                reps.loading ||
                !!reps.error
              }
              onClick={review}
            >
              {text("ตรวจการมอบหมาย", "Review assignment")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setIds([]);
                setRepId("");
                setSelection(null);
                try {
                  localStorage.removeItem(assignmentFormKey(owner));
                } catch {
                  /* Selection cleared in this view. */
                }
              }}
            >
              {text("ล้างรายการที่เลือก", "Clear selection")}
            </Button>
          </div>
        </div>
      </Panel>
    </CommercePage>
  );
}
function Scope({ review }: { review: AssignmentReview }) {
  return (
    <Panel>
      <PanelHead
        title={text(
          "บริษัทและการเปลี่ยนผู้ดูแล",
          "Companies and owner changes",
        )}
      />
      <div className="p-4 space-y-4">
        <p>
          {text(
            "ขอบเขต: เปลี่ยนผู้ดูแลบริษัททั้งหมดที่เลือก ไม่ใช่เฉพาะสาขาหรือออเดอร์",
            "Scope: change coverage for each selected company, rather than an individual branch or order.",
          )}
        </p>
        <p>
          {text("ผู้ดูแลใหม่", "New owner")}:{" "}
          <strong>{ownerName(review.newOwner)}</strong>
        </p>
        <ul className="space-y-3">
          {review.items.map((i) => (
            <li
              key={i.companyId}
              className="rounded-lg border border-secondary-container p-3 space-y-2 break-words"
            >
              <h3 className="font-semibold">{i.name}</h3>
              <p className="text-xs break-all">{i.companyId}</p>
              <p>
                {text("ผู้ดูแลเดิม", "Previous owner")}:{" "}
                {i.recorded
                  ? ownerName(i.previousOwner)
                  : text(
                      "ยังไม่มีระเบียน Commerce ผู้ดูแลจากระบบต้นทางยังไม่ยืนยัน",
                      "No Commerce assignment record. Upstream ownership is unverified.",
                    )}
              </p>
              <p>
                {text("ผู้ดูแลใหม่", "New owner")}: {ownerName(review.newOwner)}
              </p>
              <p>
                {text(
                  "บัญชีลูกค้าในสำเนาที่นำเข้า",
                  "Imported customer accounts",
                )}
                : {i.importedCustomerCount}
              </p>
            </li>
          ))}
        </ul>
        <Alert tone="warn">
          {text(
            "จำนวนบัญชีอ้างอิงสำเนาที่นำเข้า ความสดของระบบต้นทางยังไม่ยืนยัน บันทึกจะส่งเหตุการณ์ผ่าน outbox แต่ยังไม่ยืนยันว่า Josh รับแล้ว",
            "Account counts describe imported copies; upstream freshness is unverified. Saving enqueues outbox events; Josh delivery remains unverified.",
          )}
        </Alert>
      </div>
    </Panel>
  );
}
function Review({ owner }: { owner: string }) {
  const [params] = useSearchParams(),
    navigate = useNavigate(),
    writer = useWriter(owner),
    jobs = useJobs(owner),
    [confirmed, setConfirmed] = useState(false),
    [requestId] = useState(() => crypto.randomUUID());
  const input = assignmentSelectionSchema.safeParse({
    companyIds: (params.get("companies") ?? "").split(",").filter(Boolean),
    salesUserId: params.get("owner") === "clear" ? null : params.get("owner"),
  });
  const signature = JSON.stringify(input.success ? input.data : null);
  const review = useAsync(async () => {
    if (!input.success)
      throw Error(
        text(
          "ขอบเขตการมอบหมายไม่ถูกต้อง กลับไปเลือกใหม่",
          "Invalid assignment scope. Choose companies again.",
        ),
      );
    const result = assignmentReviewSchema.parse(
      await api.post(`${endpoint}/review`, input.data),
    );
    if (
      result.items.length !== input.data.companyIds.length ||
      result.items.some((i, n) => i.companyId !== input.data.companyIds[n]) ||
      (result.newOwner?.id ?? null) !== input.data.salesUserId
    )
      throw Error("Review differs from the selected scope");
    return result;
  }, [signature]);
  const packet =
    review.data && input.success
      ? assignmentPacketSchema.parse({
          requestId,
          salesUserId: input.data.salesUserId,
          changes: review.data.items.map((i) => ({
            companyId: i.companyId,
            version: i.version,
          })),
        })
      : null;
  const unchanged =
    review.data?.items.filter(
      (i) =>
        i.recorded &&
        (i.previousOwner?.id ?? null) === (review.data?.newOwner?.id ?? null),
    ) ?? [];
  async function save() {
    if (
      unchanged.length ||
      !packet ||
      !confirmed ||
      review.loading ||
      review.error ||
      jobs.length
    )
      return;
    const r = await writer.write(packet);
    if (r) navigate(requestUrl(r.requestId));
  }
  return (
    <CommercePage>
      <WorkspaceLink to={input.success ? selectionUrl(input.data) : home}>
        {text("แก้รายการ / ยกเลิกการทบทวน", "Edit selection / cancel review")}
      </WorkspaceLink>
      <PageHeader
        title={text(
          "ตรวจการมอบหมายก่อนบันทึก",
          "Review assignment before saving",
        )}
      />
      <Pending owner={owner} />
      {review.loading ? (
        <Loading variant="detail" />
      ) : review.error ? (
        <>
          <PlanningError error={review.error} />
          <Button
            onClick={() => {
              setConfirmed(false);
              review.reload();
            }}
          >
            {text("ตรวจข้อมูลปัจจุบันอีกครั้ง", "Retry current review")}
          </Button>
        </>
      ) : (
        review.data && (
          <>
            <Scope review={review.data} />
            {!!unchanged.length && (
              <Alert tone="warn">
                {text(
                  "บริษัทต่อไปนี้มีผู้ดูแลที่เลือกอยู่แล้ว นำออกหรือเลือกผู้ดูแลอื่นก่อนยืนยัน",
                  "These companies already have the selected owner. Remove them or choose a different owner before confirming.",
                )}
                : {unchanged.map((i) => i.name).join(", ")}
              </Alert>
            )}
            <Panel>
              <div className="p-4 space-y-4">
                <p>
                  {text(
                    "จะบันทึกครบทุกบริษัทในธุรกรรมเดียว หากบริษัทใดเปลี่ยนหรือไม่มีสิทธิ์ จะไม่บันทึกทั้งชุด",
                    "All companies save in one transaction. Any changed or ineligible company prevents the entire batch.",
                  )}{" "}
                  {review.data.items.length} {text("บริษัท", "companies")}
                </p>
                <label className="flex min-h-11 items-start gap-3">
                  <input
                    type="checkbox"
                    className="size-5 mt-1 shrink-0"
                    checked={confirmed}
                    disabled={writer.busy || !!unchanged.length}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span>
                    {text(
                      "ฉันตรวจบริษัท ขอบเขต และผู้ดูแลเดิม/ใหม่ครบแล้ว",
                      "I reviewed every company, its scope and previous/new owner.",
                    )}
                  </span>
                </label>
                <PlanningError error={writer.error} />
                <Button
                  disabled={
                    !confirmed ||
                    writer.busy ||
                    !!jobs.length ||
                    !!unchanged.length
                  }
                  onClick={save}
                >
                  {writer.busy
                    ? text("กำลังบันทึก…", "Saving…")
                    : text(
                        "ยืนยันและบันทึกการมอบหมาย",
                        "Confirm and save assignments",
                      )}
                </Button>
              </div>
            </Panel>
          </>
        )
      )}
    </CommercePage>
  );
}
function Recovery({ owner, id }: { owner: string; id: string }) {
  const navigate = useNavigate(),
    jobs = useJobs(owner),
    job = jobs.find((j) => j.packet.requestId === id),
    writer = useWriter(owner),
    [retry, setRetry] = useState(false),
    [current, setCurrent] = useState<AssignmentReview | null>(null),
    [stale, setStale] = useState(false);
  const outcome = useAsync(async () => {
    try {
      return {
        receipt: verifyAssignmentReceipt(
          await api.get(`${endpoint}/requests/${id}`),
          job?.packet,
        ),
        missing: false,
      };
    } catch (e) {
      if ((e as { status?: number }).status === 404)
        return { receipt: null, missing: true };
      throw e;
    }
  }, [id]);
  const validation = useAsync(async () => {
    if (!outcome.data?.missing || !job) return null;
    const review = assignmentReviewSchema.parse(
      await api.post(`${endpoint}/review`, {
        companyIds: job.packet.changes.map((c) => c.companyId),
        salesUserId: job.packet.salesUserId,
      }),
    );
    return review;
  }, [id, outcome.data?.missing, JSON.stringify(job?.packet)]);
  useEffect(() => {
    setRetry(false);
    setCurrent(validation.data);
    setStale(
      !!validation.data &&
        !!job &&
        (validation.data.items.length !== job.packet.changes.length ||
          validation.data.items.some(
            (i, n) =>
              i.companyId !== job.packet.changes[n].companyId ||
              i.version !== job.packet.changes[n].version ||
              (i.recorded &&
                (i.previousOwner?.id ?? null) === job.packet.salesUserId),
          ) ||
          (validation.data.newOwner?.id ?? null) !== job.packet.salesUserId),
    );
  }, [validation.data, job?.packet]);
  useEffect(() => {
    if (outcome.data?.receipt)
      try {
        clearAssignmentJob(owner, id);
      } catch {
        /* Retained receipt remains recoverable. */
      }
  }, [outcome.data?.receipt, owner, id]);
  async function resend() {
    if (
      !job ||
      !retry ||
      !current ||
      stale ||
      !outcome.data?.missing ||
      validation.loading ||
      validation.error
    )
      return;
    const r = await writer.write(job.packet);
    if (r) {
      setRetry(false);
      outcome.reload();
    }
  }
  return (
    <CommercePage>
      <WorkspaceLink to={home}>
        {text("กลับไปมอบหมายผู้ดูแล", "Customer assignments")}
      </WorkspaceLink>
      <PageHeader
        title={text("ตรวจผลคำขอการมอบหมาย", "Check assignment request")}
        subtitle={id}
      />
      {outcome.loading ? (
        <Loading variant="detail" />
      ) : outcome.error ? (
        <>
          <PlanningError error={outcome.error} />
          <Button onClick={outcome.reload}>
            {text("ลองตรวจคำขอเดิมอีกครั้ง", "Retry original request")}
          </Button>
        </>
      ) : outcome.data?.receipt ? (
        <>
          <Alert tone="ok">
            {text("บันทึกการมอบหมายแล้ว", "Assignments saved")} ·{" "}
            <Chip tone="ok">
              {outcome.data.receipt.appliedCount}{" "}
              {text("บริษัทที่บันทึกจริง", "companies persisted")}
            </Chip>
          </Alert>
          <p>
            {text("เวลาบันทึก", "Saved at")}: {outcome.data.receipt.savedAt}
          </p>
          <Scope
            review={{
              items: outcome.data.receipt.items,
              newOwner: outcome.data.receipt.items[0].newOwner,
              capturedAt: outcome.data.receipt.savedAt,
              ownership: "commerce",
              sourceFreshness: "unverified",
            }}
          />
          <p>
            {text(
              "ใบรับนี้ยืนยันธุรกรรมเดิม ผู้ดูแลปัจจุบันอาจเปลี่ยนหลังเวลาบันทึก",
              "This receipt confirms the original transaction. Current ownership may have changed since it saved.",
            )}
          </p>
        </>
      ) : (
        outcome.data?.missing && (
          <>
            <Alert tone="warn">
              {text(
                "ยังไม่พบใบรับที่บันทึกแล้ว จึงยังไม่ยืนยันว่าการมอบหมายเสร็จ",
                "No committed receipt was found. Assignment completion is unverified.",
              )}
            </Alert>
            {!job ? (
              <Empty>
                {text(
                  "ไม่พบคำขอเดิมในบัญชีนี้ เลือกบริษัทและทบทวนข้อมูลปัจจุบัน",
                  "Original request is unavailable for this account. Choose companies and review current data.",
                )}
              </Empty>
            ) : validation.loading ? (
              <Loading variant="detail" />
            ) : validation.error ? (
              <>
                <PlanningError error={validation.error} />
                <Button onClick={validation.reload}>
                  {text(
                    "ลองตรวจข้อมูลปัจจุบันอีกครั้ง",
                    "Retry current evidence",
                  )}
                </Button>
              </>
            ) : (
              current && (
                <>
                  <Scope review={current} />
                  {stale ? (
                    <Alert tone="warn">
                      {text(
                        "ข้อมูลเปลี่ยนแล้ว ส่งคำขอเดิมซ้ำไม่ได้ กลับไปทบทวนรายการปัจจุบัน",
                        "Evidence changed. The original request cannot be retried. Review current selection again.",
                      )}
                    </Alert>
                  ) : (
                    <>
                      <label className="flex min-h-11 items-start gap-3">
                        <input
                          className="mt-1 size-5"
                          type="checkbox"
                          checked={retry}
                          onChange={(e) => setRetry(e.target.checked)}
                          disabled={writer.busy}
                        />
                        <span>
                          {text(
                            "ฉันตรวจข้อมูลเดิมที่ยังตรงกัน และจะส่งคำขอเดิมซ้ำ",
                            "I reviewed matching current evidence and will retry the original immutable request.",
                          )}
                        </span>
                      </label>
                      <Button disabled={!retry || writer.busy} onClick={resend}>
                        {text(
                          "ส่งคำขอเดิมซ้ำอย่างปลอดภัย",
                          "Retry original request safely",
                        )}
                      </Button>
                    </>
                  )}
                </>
              )
            )}
            {job?.rejected && (
              <Button
                variant="secondary"
                disabled={writer.busy}
                onClick={() => {
                  clearAssignmentJob(owner, id);
                  navigate(
                    selectionUrl({
                      companyIds: job.packet.changes.map((c) => c.companyId),
                      salesUserId: job.packet.salesUserId,
                    }),
                  );
                }}
              >
                {text(
                  "ทบทวนใหม่หลังคำขอเดิมถูกปฏิเสธ",
                  "Review again after the original request was rejected",
                )}
              </Button>
            )}
            <PlanningError error={writer.error} />
            <Button
              variant="secondary"
              disabled={writer.busy}
              onClick={outcome.reload}
            >
              {text("ตรวจใบรับอีกครั้ง", "Check receipt again")}
            </Button>
          </>
        )
      )}
    </CommercePage>
  );
}
