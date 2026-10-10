import { useEffect, useRef, useState } from "react";
import {
  Link,
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
import {
  canSavePlan,
  planHome,
  planApi,
  planPageSchema,
  planInputsSchema,
  planPreviewSchema,
  planPreviewUrl,
  planReceiptSchema,
  planSubjectsSchema,
  planRoles,
  planUuid as uuid,
  type PlanKind,
  type PlanPreview,
  type PlanReceipt,
} from "../../../../../commerce-platform/src/modules/integration/commercial-work/commercial-work";
import { api, session } from "../../../lib/api";
import { normalizeRole } from "../../../lib/role-home";
import { CommercePage } from "../../CommercePage";
import { commerceText as text } from "../../commerce-copy";
import { useAsync, useMutation } from "../../hooks";
import { WorkspaceLink } from "../../WorkspaceParts";
import { friendlyError } from "../planning/promotion-contracts";
import { PlanningError as ErrorText } from "../planning/PlanningError";
import { PlanEvidence, PlanSources } from "./PlanEvidence";
import { dateText } from "../pack-price/pack-copy";
import {
  blankPlanForm,
  buildPlanScenario,
  clearPlanForm,
  clearPlanJob,
  formFromPlan,
  planPacket,
  readPlanForm,
  readPlanJobs,
  storePlanForm,
  storePlanJob,
  verifyPlanJob,
  type PlanForm,
  type PlanSaveJob,
} from "./plan-form";
function createWorkspace(kind: PlanKind) {
  const home = planHome(kind),
    endpoint = planApi(kind);
  const detailUrl = (id: string) => `${home}/drafts/${id}`;
  const requestUrl = (id: string) => `${home}/requests/${id}`;
  const steps = ["source", "proposal", "review"] as const;
  type Step = (typeof steps)[number];
  const stepLabel = (s: Step) =>
    text(
      ...(
        {
          source: ["เลือกแหล่งข้อมูล", "Choose a source"],
          proposal: ["ระบุงานและเหตุผล", "Describe the task and reason"],
          review: ["ทบทวนและเก็บร่าง", "Review and retain draft"],
        } as Record<Step, [string, string]>
      )[s],
    );
  async function readable<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      throw new Error(friendlyError(e));
    }
  }
  function parseReceipt(raw: unknown, id?: string) {
    const value = planReceiptSchema.parse(raw);
    if (id && id !== value.id) throw Error("Draft identity mismatch");
    return value;
  }
  function useJobs(owner: string) {
    const [jobs, setJobs] = useState(() => readPlanJobs(owner, kind));
    useEffect(() => {
      const refresh = () => setJobs(readPlanJobs(owner, kind));
      refresh();
      window.addEventListener("storage", refresh);
      window.addEventListener("cp-commercial-journal", refresh);
      return () => {
        window.removeEventListener("storage", refresh);
        window.removeEventListener("cp-commercial-journal", refresh);
      };
    }, [owner]);
    return jobs;
  }
  function usePlanWriter(owner: string) {
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
    async function write(job: PlanSaveJob): Promise<PlanReceipt | null> {
      if (lock.current || !mounted.current) return null;
      lock.current = true;
      setBusy(true);
      setError(null);
      try {
        try {
          storePlanJob(job);
        } catch {
          throw Error(
            text(
              "ยังเก็บคำขอกู้คืนไม่ได้ จึงยังไม่ส่งบันทึก ตรวจพื้นที่เบราว์เซอร์แล้วลองใหม่",
              "Recovery storage is unavailable. No save was sent. Check browser storage and retry.",
            ),
          );
        }
        let receipt: PlanReceipt;
        try {
          receipt = verifyPlanJob(
            parseReceipt(
              job.draftId
                ? await api.patch(
                    `${endpoint}/drafts/${job.draftId}`,
                    planPacket(job),
                  )
                : await api.post(`${endpoint}/drafts`, planPacket(job)),
              job.draftId ?? undefined,
            ),
            job,
          );
        } catch (e) {
          if (
            [400, 403, 404, 409].includes(
              (e as { status?: number }).status ?? 0,
            )
          ) {
            try {
              storePlanJob({ ...job, conflict: true });
            } catch {
              /* Retain the original immutable request. */
            }
          }
          throw Error(
            text(
              "ยังยืนยันผลบันทึกไม่ได้ ตรวจคำขอเดิมก่อนส่งซ้ำ",
              "The save result is unverified. Reconcile this request before submitting again.",
            ),
          );
        }
        try {
          clearPlanForm(owner, kind, job.draftId ?? undefined);
          clearPlanJob(owner, kind, job.requestId);
        } catch {
          /* An already committed receipt still establishes success. */
        }
        return mounted.current ? receipt : null;
      } catch (e) {
        if (mounted.current)
          setError(e instanceof Error ? e.message : friendlyError(e));
        return null;
      } finally {
        lock.current = false;
        if (mounted.current) setBusy(false);
      }
    }
    return { write, busy, error };
  }
  function Workspace({ role = session.claims()?.role }: { role?: string }) {
    useUiLocale();
    const { pathname } = useLocation(),
      normalized = normalizeRole(role),
      owner = String(session.claims()?.sub ?? "");
    if (!planRoles(kind).some((r) => r === normalized))
      return (
        <CommercePage>
          <PageHeader
            title={text("วางแผนงานเพื่อทบทวน", "Plan work for review")}
          />
          <Alert tone="danger">
            {text(
              "บัญชีนี้ไม่มีสิทธิ์อ่านแหล่งข้อมูลที่ต้องใช้",
              "This account cannot read the required source context.",
            )}
          </Alert>
        </CommercePage>
      );
    if (!owner)
      return (
        <CommercePage>
          <Alert tone="danger">
            {text(
              "ยังยืนยันบัญชีไม่ได้ โปรดเข้าสู่ระบบใหม่",
              "The account could not be verified. Sign in again.",
            )}
          </Alert>
        </CommercePage>
      );
    const path = pathname.replace(/\/$/, "");
    if (path === home) return <DraftIndex owner={owner} role={normalized} />;
    if (path === `${home}/new`)
      return <Navigate to={`${home}/new/source`} replace />;
    const create = path
      .slice(home.length)
      .match(/^\/new\/(source|proposal|review)$/);
    if (create)
      return (
        <DraftEditor
          key={`${owner}:${normalized}:new`}
          owner={owner}
          role={normalized}
          step={create[1] as Step}
        />
      );
    const match = path
        .slice(home.length)
        .match(
          /^\/(drafts|requests)\/([^/]+)(?:\/edit(?:\/(source|proposal|review))?)?$/,
        ),
      id = uuid.safeParse(match?.[2]);
    if (
      !match ||
      !id.success ||
      (match[1] === "requests" && path.includes("/edit"))
    )
      return (
        <CommercePage>
          <Alert tone="danger">
            {text("ลิงก์ร่างไม่ถูกต้อง", "Invalid planning draft link.")}
          </Alert>
          <WorkspaceLink to={home}>
            {text("กลับไปร่างงานเพื่อทบทวน", "Open work drafts")}
          </WorkspaceLink>
        </CommercePage>
      );
    if (match[1] === "requests")
      return (
        <RequestRecovery
          key={`${owner}:${id.data}`}
          owner={owner}
          role={normalized}
          requestId={id.data}
        />
      );
    if (path.endsWith("/edit"))
      return <Navigate to={`${detailUrl(id.data)}/edit/source`} replace />;
    return match[3] ? (
      <DraftEditor
        key={`${owner}:${normalized}:${id.data}`}
        owner={owner}
        role={normalized}
        draftId={id.data}
        step={match[3] as Step}
      />
    ) : (
      <DraftDetail
        key={`${owner}:${id.data}`}
        draftId={id.data}
        role={normalized}
      />
    );
  }
  function PendingRequests({ owner }: { owner: string }) {
    const jobs = useJobs(owner);
    return jobs.length ? (
      <Panel>
        <PanelHead
          title={text("คำขอที่ต้องตรวจผล", "Requests with unverified results")}
        />
        <div className="p-4 space-y-3">
          <p>
            {text(
              "ยังไม่นับเป็นร่างที่บันทึกแล้ว",
              "These requests are not counted as saved drafts.",
            )}
          </p>
          {jobs.map((job) => (
            <WorkspaceLink key={job.requestId} to={requestUrl(job.requestId)}>
              {job.scenario.name} · {text("ตรวจผลบันทึก", "Check save result")}
            </WorkspaceLink>
          ))}
        </div>
      </Panel>
    ) : null;
  }
  function DraftIndex({ owner, role }: { owner: string; role: string }) {
    const [query] = useSearchParams(),
      after = query.get("after"),
      valid = !after || uuid.safeParse(after).success;
    const list = useAsync(
      () =>
        valid
          ? readable(async () =>
              planPageSchema.parse(
                await api.get(
                  `${endpoint}/drafts${after ? `?after=${after}` : ""}`,
                ),
              ),
            )
          : Promise.resolve(null),
      [after, valid],
    );
    return (
      <CommercePage>
        <PageHeader
          title={
            kind === "sales_work"
              ? text("ร่างงานติดตามและสั่งซ้ำ", "Follow-up and reorder drafts")
              : text("ร่างทบทวนความพร้อมแคมเปญ", "Campaign readiness drafts")
          }
          subtitle={text(
            "เลือกหลักฐาน ระบุเหตุผล และทบทวนงานก่อนเก็บร่างส่วนตัว",
            "Choose evidence, describe the task and review a private plan.",
          )}
          actions={
            <WorkspaceLink to={`${home}/new/source`}>
              {text("เริ่มวางแผนงานเพื่อทบทวน", "Start a private work plan")}
            </WorkspaceLink>
          }
        />
        <Alert tone="muted">
          {text(
            "อ่านแหล่งข้อมูลตามสิทธิ์และขอบเขตผู้รับผิดชอบเดิม",
            "Source access follows the existing role and assignment boundaries.",
          )}
        </Alert>
        {!canSavePlan(kind, role) && (
          <Alert tone="muted">
            {text(
              "บัญชีนี้อ่านและทดลองได้ตามสิทธิ์เดิม บันทึกร่างตามสิทธิ์เขียนเดิม",
              "This account can preview under existing read permissions; saving follows existing write permissions.",
            )}
          </Alert>
        )}
        <PendingRequests owner={owner} />
        <ErrorText error={list.error} onRetry={list.reload} />
        {!valid ? (
          <Alert tone="danger">
            {text("ลิงก์หน้ารายการไม่ถูกต้อง", "Invalid list cursor.")}
            <WorkspaceLink to={home}>
              {text("กลับหน้าแรก", "Open the first page")}
            </WorkspaceLink>
          </Alert>
        ) : list.loading ? (
          <Loading variant="table" />
        ) : (
          list.data &&
          !list.error && (
            <>
              <p role="status">
                {text("ร่างที่อ่านพบในหน้านี้", "Drafts returned on this page")}
                : {list.data.items.length}
              </p>
              {!list.data.items.length ? (
                <Empty>
                  {text(
                    "ยังไม่มีร่างในหน้านี้ เริ่มวางแผนหรือกลับหน้ารายการแรก",
                    "No drafts on this page. Start planning or return to the first page.",
                  )}
                </Empty>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {list.data.items.map((draft) => (
                    <Panel key={draft.id}>
                      <div className="p-4 space-y-3">
                        <Chip tone="ok">
                          {text("บันทึกร่างแล้ว", "Draft saved")}
                        </Chip>
                        <WorkspaceLink to={detailUrl(draft.id)}>
                          {draft.scenario.name}
                        </WorkspaceLink>
                        <p>
                          {draft.inputs.subject.name} ·{" "}
                          {draft.scenario.task === "follow_up"
                            ? text("งานติดตาม", "Follow-up")
                            : draft.scenario.task === "reorder"
                              ? text("ข้อเสนอสั่งซ้ำ", "Reorder proposal")
                              : text("ทบทวนแคมเปญ", "Campaign brief")}{" "}
                          · {text("ฉบับ", "Revision")} {draft.revision}
                        </p>
                      </div>
                    </Panel>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                {after && (
                  <WorkspaceLink to={home}>
                    {text("กลับหน้าแรก", "First page")}
                  </WorkspaceLink>
                )}
                {list.data.next && (
                  <WorkspaceLink to={`${home}?after=${list.data.next}`}>
                    {text("รายการถัดไป", "Next page")}
                  </WorkspaceLink>
                )}
                <Button onClick={list.reload}>
                  {text("อ่านใหม่", "Refresh")}
                </Button>
              </div>
            </>
          )
        )}
      </CommercePage>
    );
  }
  function DraftDetail({ draftId, role }: { draftId: string; role: string }) {
    const [params] = useSearchParams(),
      requested = params.get("saved"),
      valid = uuid.safeParse(requested);
    const detail = useAsync(
      () =>
        readable(async () =>
          parseReceipt(await api.get(`${endpoint}/drafts/${draftId}`), draftId),
        ),
      [draftId],
    );
    const proof = useAsync(
      () =>
        valid.success
          ? readable(async () =>
              parseReceipt(
                await api.get(`${endpoint}/requests/${valid.data}`),
                draftId,
              ),
            )
          : Promise.resolve(null),
      [draftId, requested],
    );
    return (
      <CommercePage>
        <WorkspaceLink to={home}>
          {text("กลับไปร่างงานเพื่อทบทวน", "Back to work drafts")}
        </WorkspaceLink>
        <PageHeader
          title={
            detail.data?.scenario.name ??
            text("ร่างงานเพื่อทบทวน", "Private work draft")
          }
          actions={
            canSavePlan(kind, role) && (
              <WorkspaceLink to={`${detailUrl(draftId)}/edit/source`}>
                {text("แก้ไขร่าง", "Edit draft")}
              </WorkspaceLink>
            )
          }
        />
        {proof.data && !proof.error && (
          <Alert tone="ok">
            <span role="status">
              {text(
                "ยืนยันคำขอบันทึกนี้แล้ว",
                "This save request is verified.",
              )}{" "}
              · {text("ฉบับ", "Revision")} {proof.data.revision}
            </span>
          </Alert>
        )}
        {requested && (!valid.success || proof.error) && (
          <Alert tone="warn">
            {text(
              "ยังยืนยันคำขอนี้ไม่ได้ สถานะร่างด้านล่างมาจากผลอ่านล่าสุด",
              "This request is unverified. The draft below comes from the latest read.",
            )}
          </Alert>
        )}
        <ErrorText error={detail.error} onRetry={detail.reload} />
        {detail.loading ? (
          <Loading variant="detail" />
        ) : (
          detail.data &&
          !detail.error && (
            <>
              <div className="flex gap-3 flex-wrap">
                <Chip tone="ok">{text("บันทึกร่างแล้ว", "Draft saved")}</Chip>
                <Chip tone="muted">
                  {text("ฉบับ", "Revision")} {detail.data.revision}
                </Chip>
                <Button onClick={detail.reload}>
                  {text("อ่านร่างใหม่", "Refresh draft")}
                </Button>
              </div>
              <p className="text-sm">
                {text(
                  "หลักฐานเก็บพร้อมร่างเมื่อ",
                  "Evidence retained with this draft at",
                )}
                : {dateText(detail.data.inputs.capturedAt)}
              </p>
              <PlanEvidence value={detail.data} />
            </>
          )
        )}
      </CommercePage>
    );
  }
  function RequestRecovery({
    owner,
    requestId,
    role,
  }: {
    owner: string;
    requestId: string;
    role: string;
  }) {
    const jobs = useJobs(owner),
      job = jobs.find((j) => j.requestId === requestId),
      writer = usePlanWriter(owner),
      navigate = useNavigate();
    const lookup = useAsync(async () => {
      try {
        const receipt = parseReceipt(
          await api.get(`${endpoint}/requests/${requestId}`),
        );
        if (job) verifyPlanJob(receipt, job);
        return { receipt, absent: false };
      } catch (e) {
        if (
          (e as { status?: number; details?: { code?: string } }).status ===
            404 &&
          (e as { details?: { code?: string } }).details?.code ===
            "PLAN_REQUEST_ABSENT"
        )
          return { receipt: null, absent: true };
        throw Error(friendlyError(e));
      }
    }, [requestId]);
    const resolved = lookup.data?.receipt;
    useEffect(() => {
      if (!resolved) return;
      try {
        if (job) clearPlanForm(owner, kind, job.draftId ?? undefined);
        clearPlanJob(owner, kind, requestId);
      } catch {
        /* Verified persisted receipt remains visible. */
      }
    }, [resolved, owner, requestId]);
    async function retry() {
      if (
        !job ||
        !lookup.data?.absent ||
        job.conflict ||
        !canSavePlan(kind, role)
      )
        return;
      const result = await writer.write(job);
      if (result)
        navigate(`${detailUrl(result.id)}?saved=${requestId}`, {
          replace: true,
        });
      else lookup.reload();
    }
    return (
      <CommercePage>
        <WorkspaceLink to={home}>
          {text("กลับไปร่าง", "Back to drafts")}
        </WorkspaceLink>
        <PageHeader
          title={text("ตรวจผลคำขอบันทึก", "Check save request")}
          subtitle={job?.scenario.name}
        />
        <ErrorText error={lookup.error} onRetry={lookup.reload} />
        {lookup.loading ? (
          <Loading variant="detail" />
        ) : lookup.error ? null : resolved ? (
          <>
            <Alert tone="ok">
              <span role="status">
                {text(
                  "พบหลักฐานบันทึกร่างแล้ว",
                  "Saved draft receipt verified.",
                )}
              </span>
            </Alert>
            <WorkspaceLink to={`${detailUrl(resolved.id)}?saved=${requestId}`}>
              {text("เปิดร่างที่บันทึกแล้ว", "Open saved draft")}
            </WorkspaceLink>
            <PlanEvidence value={resolved} />
          </>
        ) : (
          <>
            <Alert tone="warn">
              {text(
                "ยังไม่พบหลักฐานคำขอที่บันทึกแล้ว จึงยังไม่แสดงว่าบันทึกสำเร็จ",
                "No committed receipt was found. This request is not marked successful.",
              )}
            </Alert>
            {job ? (
              job.conflict ? (
                <>
                  <Alert tone="warn">
                    {text(
                      "ฉบับร่างหรือหลักฐานเปลี่ยน เปิดข้อมูลล่าสุดเพื่อทบทวนก่อนเริ่มคำขอใหม่",
                      "The draft revision or evidence changed. Review current data before starting a new request.",
                    )}
                  </Alert>
                  <WorkspaceLink
                    to={
                      job.draftId
                        ? `${detailUrl(job.draftId)}/edit/source`
                        : `${home}/new/source`
                    }
                  >
                    {text("เปิดข้อมูลล่าสุด", "Review current data")}
                  </WorkspaceLink>
                  <Button
                    onClick={() => {
                      try {
                        clearPlanJob(owner, kind, requestId);
                        navigate(home);
                      } catch {
                        lookup.reload();
                      }
                    }}
                  >
                    {text(
                      "ยกเลิกคำขอที่ไม่สำเร็จ",
                      "Dismiss unsuccessful request",
                    )}
                  </Button>
                </>
              ) : (
                canSavePlan(kind, role) && (
                  <Button disabled={writer.busy} onClick={retry}>
                    {text("ลองส่งคำขอเดิมอีกครั้ง", "Retry the same request")}
                  </Button>
                )
              )
            ) : (
              <Empty>
                {text(
                  "ไม่มีคำขอเดิมในเบราว์เซอร์นี้ เปิดร่างหรืออ่านผลอีกครั้ง",
                  "The original request is unavailable in this browser. Inspect drafts or check again.",
                )}
              </Empty>
            )}
            <Button disabled={writer.busy} onClick={lookup.reload}>
              {text("ตรวจผลอีกครั้ง", "Check again")}
            </Button>
          </>
        )}
        <ErrorText error={writer.error} />
      </CommercePage>
    );
  }
  function DraftEditor({
    owner,
    role,
    draftId,
    step,
  }: {
    owner: string;
    role: string;
    draftId?: string;
    step: Step;
  }) {
    const original = useAsync(
      () =>
        draftId
          ? readable(async () =>
              parseReceipt(
                await api.get(`${endpoint}/drafts/${draftId}`),
                draftId,
              ),
            )
          : Promise.resolve(null),
      [draftId],
    );
    if (draftId && !canSavePlan(kind, role))
      return (
        <CommercePage>
          <Alert tone="muted">
            {text(
              "บัญชีนี้ยังแก้ร่างไม่ได้ตามสิทธิ์อ่านเดิม",
              "This account retains read-only access and cannot edit drafts.",
            )}
          </Alert>
          <WorkspaceLink to={detailUrl(draftId)}>
            {text("อ่านร่างนี้", "Read this draft")}
          </WorkspaceLink>
        </CommercePage>
      );
    if (draftId && original.loading)
      return (
        <CommercePage>
          <Loading variant="detail" />
        </CommercePage>
      );
    if (draftId && (original.error || !original.data))
      return (
        <CommercePage>
          <ErrorText error={original.error} onRetry={original.reload} />
        </CommercePage>
      );
    return (
      <EditorForm
        key={`${draftId ?? "new"}:${original.data?.revision ?? 0}`}
        owner={owner}
        role={role}
        original={original.data}
        step={step}
      />
    );
  }
  function EditorForm({
    owner,
    role,
    original,
    step,
  }: {
    owner: string;
    role: string;
    original: PlanReceipt | null;
    step: Step;
  }) {
    const id = original?.id,
      revision = original?.revision ?? null,
      backup = useRef(readPlanForm(owner, kind, id));
    const [form, setForm] = useState<PlanForm>(() =>
      backup.current?.revision === revision
        ? backup.current.form
        : original
          ? formFromPlan(original.scenario)
          : blankPlanForm(kind),
    );
    const [choice, setChoice] = useState(
        backup.current && backup.current.revision !== revision
          ? "pending"
          : "latest",
      ),
      [backupError, setBackupError] = useState<string | null>(null),
      [errors, setErrors] = useState<Record<string, string>>({}),
      [changed, setChanged] = useState(false),
      [preview, setPreview] = useState<PlanPreview | null>(null),
      [search, setSearch] = useState("");
    const subjects = useAsync(
      () =>
        readable(async () =>
          planSubjectsSchema.parse(
            await api.get(
              `${endpoint}/subjects?q=${encodeURIComponent(search)}`,
            ),
          ),
        ),
      [search],
    );
    const source = useAsync(
      () =>
        form.subjectId
          ? readable(async () => {
              const v = planInputsSchema.parse(
                await api.get(
                  `${endpoint}/inputs/${encodeURIComponent(form.subjectId)}${form.orderId ? `?orderId=${encodeURIComponent(form.orderId)}` : ""}`,
                ),
              );
              if (
                v.kind !== kind ||
                v.subject.id !== form.subjectId ||
                v.selectedOrderId !== (form.orderId || null)
              )
                throw Error("Source identity mismatch");
              return v;
            })
          : Promise.resolve(null),
      [form.subjectId, form.orderId],
    );
    const work = useMutation(),
      writer = usePlanWriter(owner),
      jobs = useJobs(owner),
      pending = jobs.find((j) => j.draftId === (id ?? null)),
      lock = useRef(false),
      mounted = useRef(true),
      currentStep = useRef(step),
      intent = useRef(0),
      navigate = useNavigate();
    const base = id ? `${detailUrl(id)}/edit` : `${home}/new`,
      inputs =
        source.data?.subject.id === form.subjectId &&
        source.data.selectedOrderId === (form.orderId || null)
          ? source.data
          : null;
    const disabled = writer.busy || !!pending || choice === "pending",
      reviewDisabled =
        disabled || source.loading || !!source.error || !inputs || work.busy;
    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);
    useEffect(() => {
      currentStep.current = step;
    }, [step]);
    useEffect(() => {
      if (choice === "pending") return;
      try {
        storePlanForm(owner, id, revision, form);
        setBackupError(null);
      } catch {
        setBackupError(
          text(
            "ยังเก็บค่าที่กรอกไม่ได้ โปรดเก็บหน้านี้ไว้จนกว่าจะบันทึก",
            "Form recovery is unavailable. Keep this page open until saved.",
          ),
        );
      }
    }, [owner, id, revision, form, choice]);
    useEffect(() => {
      if (!inputs) return;
      intent.current++;
      if (
        form.sourceFingerprint &&
        form.sourceFingerprint !== inputs.sourceFingerprint
      )
        setChanged(true);
      setForm((f) =>
        f.subjectId !== inputs.subject.id ||
        f.orderId !== (inputs.selectedOrderId ?? "")
          ? f
          : { ...f, sourceFingerprint: inputs.sourceFingerprint },
      );
      setPreview(null);
    }, [inputs]);
    function change(key: keyof PlanForm, value: string | PlanForm["lines"]) {
      intent.current++;
      setForm((f) => ({
        ...f,
        [key]: value,
        ...(key === "subjectId"
          ? { orderId: "", sourceFingerprint: "", lines: [] }
          : key === "orderId" || key === "task"
            ? {
                lines: [],
                sourceFingerprint: key === "orderId" ? "" : f.sourceFingerprint,
              }
            : {}),
      }));
      setPreview(null);
      setErrors({});
    }
    async function review() {
      const parsed = buildPlanScenario(form);
      setErrors(parsed.errors);
      if (!parsed.scenario || reviewDisabled) {
        if (!parsed.scenario) {
          navigate(`${base}/${!form.subjectId ? "source" : "proposal"}`);
          setTimeout(
            () =>
              document
                .querySelector<HTMLElement>('[aria-invalid="true"]')
                ?.focus(),
            0,
          );
        }
        return;
      }
      let url: string;
      try {
        url = planPreviewUrl(parsed.scenario);
      } catch {
        setErrors({
          request: text(
            "ข้อความเกินขอบเขต โปรดย่อเหตุผลหรือเลือกรายการให้น้อยลง",
            "The review request is too large. Shorten the reason or review fewer lines.",
          ),
        });
        return;
      }
      const version = intent.current,
        started = currentStep.current;
      const result = await work.run(() =>
        readable(async () => {
          const v = planPreviewSchema.parse(await api.get(url));
          if (JSON.stringify(v.scenario) !== JSON.stringify(parsed.scenario))
            throw Error("Preview identity mismatch");
          return v;
        }),
      );
      if (result.ok && mounted.current && intent.current === version) {
        setPreview(result.value);
        setChanged(false);
        if (currentStep.current === started) navigate(`${base}/review`);
      }
    }
    async function save() {
      if (
        !preview ||
        !canSavePlan(kind, role) ||
        reviewDisabled ||
        lock.current
      )
        return;
      lock.current = true;
      const job: PlanSaveJob = {
        schemaVersion: 1,
        owner,
        requestId: crypto.randomUUID(),
        draftId: id ?? null,
        revision,
        scenario: preview.scenario,
        createdAt: new Date().toISOString(),
        conflict: false,
      };
      try {
        const result = await writer.write(job);
        if (mounted.current) {
          if (result)
            navigate(`${detailUrl(result.id)}?saved=${job.requestId}`);
          else if (
            readPlanJobs(owner, kind).some((j) => j.requestId === job.requestId)
          )
            navigate(requestUrl(job.requestId));
        }
      } finally {
        lock.current = false;
      }
    }
    const field = (key: "name" | "note" | "dueDate", label: string) => (
      <TaskInput
        label={label}
        type={key === "dueDate" ? "date" : "text"}
        value={form[key]}
        error={errors[key]}
        disabled={disabled}
        onChange={(e) => change(key, e.target.value)}
      />
    );
    function chooseBackup(copy: boolean) {
      const next = copy
        ? backup.current!.form
        : original
          ? formFromPlan(original.scenario)
          : blankPlanForm(kind);
      intent.current++;
      setForm({
        ...next,
        sourceFingerprint:
          inputs?.subject.id === next.subjectId &&
          inputs.selectedOrderId === (next.orderId || null)
            ? inputs.sourceFingerprint
            : next.sourceFingerprint,
      });
      setChoice(copy ? "copy" : "latest");
      setChanged(copy);
      setPreview(null);
    }
    return (
      <CommercePage>
        <WorkspaceLink to={id ? detailUrl(id) : home}>
          {text("กลับไปร่างงาน", "Back to work drafts")}
        </WorkspaceLink>
        <PageHeader
          title={
            kind === "sales_work"
              ? text(
                  "ทบทวนงานติดตามและสั่งซ้ำ",
                  "Review follow-up and reorder work",
                )
              : text("ทบทวนความพร้อมก่อนวางแคมเปญ", "Review campaign readiness")
          }
          subtitle={text(
            "เลือกหลักฐาน ระบุเหตุผล และเก็บร่างส่วนตัวเพื่อให้คนทบทวน",
            "Choose evidence, describe your reason and retain a private human-reviewed draft.",
          )}
        />
        <nav
          aria-label={text("ขั้นตอนทบทวนงาน", "Work planning steps")}
          className="grid gap-2 sm:grid-cols-3"
        >
          {steps.map((s, i) => (
            <Link
              key={s}
              to={`${base}/${s}`}
              aria-current={step === s ? "step" : undefined}
              className="rounded-lg border border-secondary-container p-3 min-h-11 focus-visible:outline-2 focus-visible:outline-primary"
            >
              {i + 1}. {stepLabel(s)}
            </Link>
          ))}
        </nav>
        {!canSavePlan(kind, role) && (
          <Alert tone="muted">
            {text(
              "Sales อ่านและทบทวนได้ตามสิทธิ์เดิม บันทึกร่างได้เฉพาะ Admin และหัวหน้าฝ่ายขาย",
              "Sales retains read-only access. Admin and sales managers can retain private drafts.",
            )}
          </Alert>
        )}
        {choice === "pending" && (
          <Alert tone="warn">
            {text(
              "ฉบับที่บันทึกเปลี่ยน เลือกก่อนนำค่าที่กรอกค้างมาใช้",
              "The saved revision changed. Choose how to handle the previous form.",
            )}
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => chooseBackup(false)}>
                {text("ใช้ร่างที่บันทึกล่าสุด", "Use latest saved draft")}
              </Button>
              <Button onClick={() => chooseBackup(true)}>
                {text(
                  "คัดลอกค่าที่กรอกเพื่อทบทวน",
                  "Copy my previous values for review",
                )}
              </Button>
            </div>
          </Alert>
        )}
        <ErrorText error={backupError} />
        {pending && (
          <Alert tone="warn">
            {text(
              "มีคำขอที่ยังไม่ยืนยัน ต้องตรวจคำขอเดิมก่อน",
              "An original request requires reconciliation.",
            )}
            <WorkspaceLink to={requestUrl(pending.requestId)}>
              {text("ตรวจคำขอเดิม", "Check original request")}
            </WorkspaceLink>
          </Alert>
        )}
        {changed && (
          <Alert tone="warn">
            {text(
              "หลักฐานต้นทางเปลี่ยน โปรดทบทวนใหม่ก่อนบันทึก",
              "Source evidence changed. Review again before saving.",
            )}
          </Alert>
        )}
        {step === "source" && (
          <Panel>
            <PanelHead title={stepLabel(step)} />
            <div className="p-4 space-y-4">
              <TaskInput
                label={text(
                  kind === "sales_work"
                    ? "ค้นหาบริษัทในขอบเขตที่อ่านได้"
                    : "ค้นหา SKU ในแค็ตตาล็อก",
                  kind === "sales_work"
                    ? "Search authorized companies"
                    : "Search catalog SKUs",
                )}
                value={search}
                disabled={disabled}
                onChange={(e) => setSearch(e.target.value)}
              />
              <ErrorText error={subjects.error} onRetry={subjects.reload} />
              {subjects.loading ? (
                <Loading variant="table" />
              ) : (
                subjects.data &&
                !subjects.error && (
                  <>
                    <TaskSelect
                      label={text(
                        kind === "sales_work" ? "เลือกบริษัท" : "เลือก SKU",
                        kind === "sales_work"
                          ? "Choose a company"
                          : "Choose a SKU",
                      )}
                      value={form.subjectId}
                      error={errors.subjectId}
                      disabled={disabled}
                      onChange={(e) => change("subjectId", e.target.value)}
                    >
                      <option value="">
                        {text("เลือกแหล่งข้อมูล", "Choose a source")}
                      </option>
                      {form.subjectId &&
                        !subjects.data.items.some(
                          (x) => x.id === form.subjectId,
                        ) && (
                          <option value={form.subjectId}>
                            {inputs?.subject.name ?? form.subjectId}
                          </option>
                        )}
                      {subjects.data.items.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {s.id}
                        </option>
                      ))}
                    </TaskSelect>
                    {!subjects.data.items.length && (
                      <Empty>
                        {text(
                          "ไม่พบข้อมูลในหน้าที่ค้นหา ลองคำค้นอื่นหรืออ่านใหม่",
                          "No sources on this search page. Change the search or retry.",
                        )}
                      </Empty>
                    )}
                    <p>
                      {text("ผลในหน้านี้", "Results on this page")}:{" "}
                      {subjects.data.items.length}
                      {subjects.data.hasMore
                        ? text(
                            " · มีเพิ่มเติม ระบุคำค้นให้แคบลง",
                            " · More results exist; narrow the search",
                          )
                        : ""}
                    </p>
                  </>
                )
              )}
              {kind === "sales_work" && (
                <TaskSelect
                  label={text("งานที่ต้องการทบทวน", "Work to review")}
                  value={form.task}
                  disabled={disabled}
                  onChange={(e) => change("task", e.target.value)}
                >
                  <option value="follow_up">
                    {text("ร่างงานติดตาม", "Follow-up draft")}
                  </option>
                  <option value="reorder">
                    {text("ร่างข้อเสนอสั่งซ้ำ", "Reorder proposal draft")}
                  </option>
                </TaskSelect>
              )}
              {kind === "sales_work" && inputs && (
                <TaskSelect
                  label={text(
                    "ออเดอร์เดิมในหน้าที่อ่านได้ (สำหรับร่างสั่งซ้ำ)",
                    "Historical order on this page (for reorder drafts)",
                  )}
                  value={form.orderId}
                  disabled={disabled}
                  onChange={(e) => change("orderId", e.target.value)}
                >
                  <option value="">
                    {text("ยังไม่เลือกออเดอร์", "No order selected")}
                  </option>
                  {form.orderId &&
                    !inputs.orders.some((o) => o.id === form.orderId) && (
                      <option value={form.orderId}>{form.orderId}</option>
                    )}
                  {inputs.orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.number ?? o.id} · {o.status} ·{" "}
                      {o.paid === true
                        ? text("ชำระแล้วตามกฎต้นทาง", "Paid under source rule")
                        : text("ยังไม่ยืนยันชำระ", "Payment unverified")}
                    </option>
                  ))}
                </TaskSelect>
              )}
              <WorkspaceLink to={`${base}/proposal`}>
                {text(
                  "ต่อไป: ระบุงานและเหตุผล",
                  "Next: describe the task and reason",
                )}
              </WorkspaceLink>
            </div>
          </Panel>
        )}
        <ErrorText error={source.error} onRetry={source.reload} />
        {source.loading && form.subjectId && <Loading variant="detail" />}
        {inputs && !source.error && !source.loading && (
          <>
            <PlanSources inputs={inputs} />
            <Button
              disabled={disabled || work.busy}
              onClick={() => {
                intent.current++;
                setPreview(null);
                source.reload();
              }}
            >
              {text("อ่านหลักฐานใหม่", "Refresh source evidence")}
            </Button>
          </>
        )}
        {step === "proposal" && (
          <>
            <Panel>
              <PanelHead title={stepLabel(step)} />
              <div className="p-4 space-y-4">
                {field("name", text("ชื่อร่างงาน", "Work draft name"))}
                {field(
                  "note",
                  text(
                    "เหตุผลจากหลักฐานและงานที่ฉันเสนอ",
                    "Evidence-based reason and my proposed work",
                  ),
                )}
                {field(
                  "dueDate",
                  text(
                    "วันที่ฉันเลือกให้ทบทวน (UTC, เลือกกรอก)",
                    "My chosen review date (UTC, optional)",
                  ),
                )}
                {form.task === "reorder" && inputs && !source.error && (
                  <>
                    <Alert tone="warn">
                      {text(
                        "ปริมาณเดิมเป็นข้อมูลย้อนหลัง หน่วยเดิมและราคาปัจจุบันยังไม่ยืนยัน ระบุปริมาณที่เสนอด้วยตนเอง",
                        "Historical quantities are context. Units and current prices remain unverified. Enter your proposed quantities explicitly.",
                      )}
                    </Alert>
                    {inputs.historicalLines.map((l) => {
                      const selected = form.lines.find((x) => x.sku === l.sku);
                      return (
                        <div
                          key={l.sku}
                          className="rounded-lg border border-secondary-container p-3 space-y-3"
                        >
                          <label className="flex gap-3 min-h-11 items-center">
                            <input
                              type="checkbox"
                              checked={!!selected}
                              disabled={disabled}
                              onChange={(e) =>
                                change(
                                  "lines",
                                  e.target.checked
                                    ? [
                                        ...form.lines,
                                        { sku: l.sku, proposedQuantity: "" },
                                      ]
                                    : form.lines.filter((x) => x.sku !== l.sku),
                                )
                              }
                            />
                            <span>
                              {l.name} · {l.sku} ·{" "}
                              {text("ปริมาณเดิม", "Historical quantity")}:{" "}
                              {l.recordedQuantity}
                            </span>
                          </label>
                          {selected && (
                            <TaskInput
                              label={`${text("ปริมาณที่ฉันเสนอ", "My proposed quantity")} · ${l.sku}`}
                              value={selected.proposedQuantity}
                              inputMode="decimal"
                              disabled={disabled}
                              error={
                                errors[
                                  `lines.${form.lines.indexOf(selected)}.proposedQuantity`
                                ]
                              }
                              onChange={(e) =>
                                change(
                                  "lines",
                                  form.lines.map((x) =>
                                    x.sku === l.sku
                                      ? {
                                          ...x,
                                          proposedQuantity: e.target.value,
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </Panel>
            <Button disabled={reviewDisabled} onClick={review}>
              {text("ทบทวนงานและหลักฐาน", "Review work and evidence")}
            </Button>
          </>
        )}
        {step === "review" &&
          (preview ? (
            <>
              <PlanEvidence value={preview} />
              <div className="flex flex-wrap gap-3">
                {canSavePlan(kind, role) && (
                  <Button disabled={reviewDisabled} onClick={save}>
                    {writer.busy
                      ? text("กำลังตรวจผลบันทึก…", "Verifying save…")
                      : text(
                          "บันทึกร่างงานเพื่อทบทวน",
                          "Save work draft for review",
                        )}
                  </Button>
                )}
                <WorkspaceLink to={`${base}/source`}>
                  {text("แก้แหล่งข้อมูล", "Edit source")}
                </WorkspaceLink>
                <WorkspaceLink to={`${base}/proposal`}>
                  {text("แก้งานที่เสนอ", "Edit proposed work")}
                </WorkspaceLink>
                <Button disabled={reviewDisabled} onClick={review}>
                  {text("อ่านและทบทวนใหม่", "Read and review again")}
                </Button>
              </div>
            </>
          ) : (
            <Empty>
              {text(
                "ยังไม่มีผลทบทวนสำหรับค่าปัจจุบัน",
                "No verified review for current values.",
              )}
              <Button disabled={reviewDisabled} onClick={review}>
                {text("ทบทวนค่าปัจจุบัน", "Review current values")}
              </Button>
            </Empty>
          ))}
        {Object.keys(errors).length > 0 && (
          <Alert tone="danger">
            {errors.request ??
              text(
                "แก้ช่องที่ระบุแล้วทบทวนใหม่",
                "Correct the marked fields and review again.",
              )}
          </Alert>
        )}
        <ErrorText error={work.error} />
        <ErrorText error={writer.error} />
        {work.busy && <Loading variant="detail" />}
      </CommercePage>
    );
  }
  return Workspace;
}
export const SalesWorkWorkspace = createWorkspace("sales_work");
export const MarketingReadinessWorkspace = createWorkspace(
  "marketing_readiness",
);
