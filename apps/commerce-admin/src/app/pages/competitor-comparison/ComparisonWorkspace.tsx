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
  ButtonLink,
  Chip,
  Empty,
  FilterBar,
  fmt,
  Loading,
  PageHeader,
  Panel,
  PanelHead,
  StatTile,
  Table,
  TableEmpty,
  TableViewport,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TaskInput,
  TaskSelect,
  useUiLocale,
} from "@cp/ui";
import { z } from "zod";
import { api, authedFetch, session } from "../../../lib/api";
import { CommercePage } from "../../CommercePage";
import { commerceText as text } from "../../commerce-copy";
import { useAsync } from "../../hooks";
import { WorkspaceLink } from "../../WorkspaceParts";
import { PlanningError as ErrorText } from "../planning/PlanningError";
import {
  canChangeComparison,
  canReadComparison,
  canPerformComparison,
  canApplyComparisonPacket,
  COMPARISON_API as endpoint,
  COMPARISON_HOME as home,
  comparisonCommandSchema,
  comparisonPacketSchema,
  comparisonUuid,
  comparisonWorkspaceSchema,
  parseComparisonHandoff,
  verifyComparisonReceipt,
  type ComparisonCommand,
  type ComparisonPacket,
  type ComparisonReceipt,
  type ComparisonWorkspace as Workspace,
} from "../../../../../commerce-platform/src/modules/integration/competitor-prices/comparison-contracts";
import {
  clearComparisonJob,
  comparisonFormKey,
  readComparisonJobs,
} from "./comparison-journal";
import { comparisonDate, comparisonReason } from "./comparison-copy";

import { useJobs, useComparisonWriter } from "./comparison-interactions";
import { BatchReview } from "./BatchReview";

const productUrl = (sku: string) =>
  `${home}/products/${encodeURIComponent(sku)}`;
const requestUrl = (id: string) => `${home}/requests/${id}`;
const label = (action: string) =>
  text(
    ...((
      {
        create: ["เพิ่มคู่สินค้า", "Add product pair"],
        capture: ["บันทึกราคาที่พบ", "Record observed price"],
        verify: ["ตรวจการจับคู่", "Review product match"],
        pack: ["แก้ขนาดแพ็ก", "Change pack dimensions"],
        remove: ["เลิกใช้คู่สินค้านี้", "Remove product pair"],
        review: ["ทำเครื่องหมายทบทวนสินค้า", "Mark product reviewed"],
        reassign: [
          "เปลี่ยนลิงก์และแหล่งสินค้า",
          "Change product link and source",
        ],
        settings: [
          "แก้ชื่อและสิทธิ์รวบรวม",
          "Edit identity and collection permission",
        ],
        refresh: ["รวบรวมราคาจากหน้าสินค้า", "Collect price from product page"],
      } as Record<string, [string, string]>
    )[action] ?? ["ทบทวนข้อมูล", "Review evidence"]),
  );
const choiceText = (value: string) =>
  text(
    ...((
      {
        uncertain: ["ยังไม่แน่ใจ", "Uncertain match"],
        same_product: [
          "เป็นสินค้าเดียวกัน หลังตรวจหลักฐาน",
          "Same product after evidence review",
        ],
        substitute: ["เป็นสินค้าทดแทน", "Substitute product"],
        unverified: ["ยังไม่ยืนยัน VAT", "VAT unverified"],
        inclusive: ["รวม VAT", "VAT included"],
        exclusive: ["ไม่รวม VAT", "VAT excluded"],
        public: ["ราคาสาธารณะ", "Public price"],
        member: ["ราคาสมาชิก", "Member price"],
      } as Record<string, [string, string]>
    )[value] ?? [value, value]),
  );
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : text("อ่านข้อมูลไม่สำเร็จ ลองอีกครั้ง", "Read failed. Retry.");
async function readable<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (e) {
    throw Error(message(e));
  }
}
function Pending({ owner, sku }: { owner: string; sku?: string }) {
  const jobs = useJobs(owner).filter((j) => !sku || j.packet.sku === sku);
  return jobs.length ? (
    <Panel>
      <PanelHead
        title={text("คำขอที่ต้องตรวจผล", "Requests needing reconciliation")}
      />
      <div className="p-4 space-y-2">
        {jobs.map((j) => (
          <WorkspaceLink
            key={j.packet.requestId}
            to={requestUrl(j.packet.requestId)}
          >
            {j.packet.sku} · {text("ตรวจคำขอเดิม", "Check original request")}
          </WorkspaceLink>
        ))}
        <p>
          {text(
            "คำขอในเบราว์เซอร์ยังไม่ใช่หลักฐานบันทึกสำเร็จ",
            "Browser requests are not proof of successful persistence.",
          )}
        </p>
      </div>
    </Panel>
  ) : null;
}
export default function ComparisonWorkspace({
  role = session.claims()?.role ?? "",
}: {
  role?: string;
}) {
  useUiLocale();
  const { pathname, search } = useLocation(),
    [params] = useSearchParams();
  if (!canReadComparison(role))
    return (
      <CommercePage>
        <Alert tone="danger">
          {text(
            "บัญชีนี้ยังอ่านหลักฐานคู่แข่งไม่ได้",
            "This account cannot read competitor evidence.",
          )}
        </Alert>
      </CommercePage>
    );
  const owner = String(session.claims()?.sub ?? "");
  if (!owner)
    return (
      <CommercePage>
        <Alert tone="danger">
          {text("ยืนยันบัญชีอีกครั้ง", "Verify your account again.")}
        </Alert>
      </CommercePage>
    );
  const path = pathname.replace(/\/$/, "");
  if (path === home && params.get("catalogItem"))
    return (
      <Navigate to={`${home}/collected/${params.get("catalogItem")}`} replace />
    );
  if (path === home && params.get("step") === "results")
    return <Navigate to={home} replace />;
  if (path === home && params.get("sku"))
    return <Navigate to={productUrl(params.get("sku")!)} replace />;
  if (path === home && ["sources", "add"].includes(params.get("step") ?? ""))
    return <Navigate to={`${home}/sources`} replace />;
  if (path === `${home}/sources`) return <LegacySources role={role} />;
  // The old report URL now opens the comparison table on the home.
  if (path === `${home}/overview`)
    return <Navigate to={home + search} replace />;
  if (path === `${home}/matching`) return <MatchingQueue />;
  if (path === home) return <ProductIndex owner={owner} role={role} />;
  const collected = path.match(
    /^\/j\/marketing\/competitor-prices\/collected\/([^/]+)$/,
  );
  if (collected)
    return comparisonUuid.safeParse(collected[1]).success ? (
      <CollectedProduct id={collected[1]} role={role} />
    ) : (
      <Unavailable />
    );
  const request = path.match(
    /^\/j\/marketing\/competitor-prices\/requests\/([^/]+)$/,
  );
  if (request) {
    const id = comparisonUuid.safeParse(request[1]);
    return id.success ? (
      <Recovery key={id.data} requestId={id.data} owner={owner} role={role} />
    ) : (
      <Unavailable />
    );
  }
  const match = path.match(
    /^\/j\/marketing\/competitor-prices\/products\/([^/]+)(.*)$/,
  );
  if (!match) return <Unavailable />;
  let sku: string;
  try {
    sku = decodeURIComponent(match[1]);
  } catch {
    return <Unavailable />;
  }
  if (!sku || sku.length > 100 || /[\x00-\x1f]/.test(sku))
    return <Unavailable />;
  return (
    <ProductTask
      key={`${owner}:${sku}:${match[2]}`}
      sku={sku}
      tail={match[2]}
      owner={owner}
      role={role}
    />
  );
}
function Unavailable() {
  return (
    <CommercePage>
      <PageHeader title={text("ไม่พบหน้างานนี้", "Task page unavailable")} />
      <WorkspaceLink to={home}>
        {text("กลับไปเทียบราคา", "Back to competitor comparison")}
      </WorkspaceLink>
    </CommercePage>
  );
}
function LegacySources({ role }: { role: string }) {
  return (
    <CommercePage>
      <PageHeader
        title={text(
          "แหล่งราคาและสินค้าที่รวบรวม",
          "Price sources and collected products",
        )}
      />
      <WorkspaceLink to={home}>
        {text("กลับไปเลือกสินค้า", "Back to product selection")}
      </WorkspaceLink>
      {canChangeComparison(role) ? (
        <>
          <WorkspaceLink to="/j/marketing/scraping-sources">
            {text("จัดการแหล่งราคา", "Manage price sources")}
          </WorkspaceLink>
          <WorkspaceLink to="/j/marketing/scraped-catalog">
            {text("ตรวจสินค้าที่รวบรวม", "Inspect collected products")}
          </WorkspaceLink>
        </>
      ) : (
        <Alert tone="muted">
          {text(
            "อ่านฐานราคาในหน้าเทียบสินค้า การตั้งค่าแหล่งข้อมูลใช้สิทธิ์การตลาด",
            "Read price bases in the comparison. Source configuration requires Marketing access.",
          )}
        </Alert>
      )}
    </CommercePage>
  );
}
function ProductTask({
  sku,
  tail,
  owner,
  role,
}: {
  sku: string;
  tail: string;
  owner: string;
  role: string;
}) {
  const source = useAsync(async () => {
    const value = comparisonWorkspaceSchema.parse(
      await api.get(`${endpoint}/products/${encodeURIComponent(sku)}`),
    );
    if (value.sku !== sku) throw Error("Product identity mismatch");
    return value;
  }, [sku]);
  if (source.loading)
    return (
      <CommercePage>
        <WorkspaceLink to={home}>
          {text("เลือกสินค้า", "Choose product")}
        </WorkspaceLink>
        <Loading variant="detail" />
      </CommercePage>
    );
  if (source.error || !source.data)
    return (
      <CommercePage>
        <WorkspaceLink to={home}>
          {text("เลือกสินค้า", "Choose product")}
        </WorkspaceLink>
        <ErrorText error={source.error} onRetry={source.reload} />
      </CommercePage>
    );
  const workspace = source.data,
    base = productUrl(sku);
  if (tail === "/batch" || tail === "/batch/review")
    return (
      <BatchReview
        workspace={workspace}
        owner={owner}
        role={role}
        review={tail.endsWith("/review")}
      />
    );
  if (tail === "/planning")
    return <PlanningHandoff workspace={workspace} role={role} />;
  if (tail === "/match")
    return <Candidates workspace={workspace} role={role} owner={owner} />;
  if (
    (tail === "/match/new" || tail === "/match/new/review") &&
    !canPerformComparison(role, "create")
  )
    return <UnavailableAction workspace={workspace} />;
  if (tail === "/match/new" || tail === "/match/new/review")
    return (
      <ActionEditor
        workspace={workspace}
        action="create"
        owner={owner}
        role={role}
        review={tail.endsWith("/review")}
        base={`${base}/match/new`}
      />
    );
  if (
    (tail === "/review-marker" || tail === "/review-marker/review") &&
    !canPerformComparison(role, "review")
  )
    return <UnavailableAction workspace={workspace} />;
  if (tail === "/review-marker" || tail === "/review-marker/review")
    return (
      <ActionEditor
        workspace={workspace}
        action="review"
        owner={owner}
        role={role}
        review={tail.endsWith("/review")}
        base={`${base}/review-marker`}
      />
    );
  if (!tail)
    return (
      <ComparisonMatrix
        workspace={workspace}
        owner={owner}
        role={role}
        refresh={source.reload}
      />
    );
  const match = tail.match(
      /^\/pairs\/([^/]+)(?:\/(capture|verify|pack|remove|settings|refresh|reassign)(\/review)?)?$/,
    ),
    id = comparisonUuid.safeParse(match?.[1]);
  const row = id.success ? workspace.rows.find((r) => r.id === id.data) : null;
  if (!match || !row) return <Unavailable />;
  if (match[2] && !canPerformComparison(role, match[2]))
    return <UnavailableAction workspace={workspace} />;
  return match[2] ? (
    <ActionEditor
      workspace={workspace}
      row={row}
      action={match[2]}
      owner={owner}
      role={role}
      review={!!match[3]}
      base={`${base}/pairs/${row.id}/${match[2]}`}
    />
  ) : (
    <PairDetail workspace={workspace} row={row} role={role} />
  );
}
function MerComparisonAccess() {
  return (
    <Alert tone="muted">
      {text(
        "บันทึกราคาอ้างอิงและตรวจการจับคู่ได้ การตั้งค่าแหล่งข้อมูลและราคาขายใช้สิทธิ์เดิม",
        "You can record reference prices and verify product matches. Source management and selling-price permissions are unchanged.",
      )}
    </Alert>
  );
}
function UnavailableAction({ workspace }: { workspace: Workspace }) {
  return (
    <CommercePage>
      <ProductHeader workspace={workspace} />
      <Alert tone="muted">
        {text(
          "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ จึงไม่มีการส่งบันทึก",
          "This account cannot perform this action; no action is dispatched.",
        )}
      </Alert>
      <WorkspaceLink to={productUrl(workspace.sku)}>
        {text("อ่านผลเทียบ", "Read comparison")}
      </WorkspaceLink>
    </CommercePage>
  );
}
function ProductHeader({ workspace }: { workspace: Workspace }) {
  return (
    <>
      <WorkspaceLink to={home}>
        {text("เลือกสินค้าหรือหมวดอื่น", "Choose another product or category")}
      </WorkspaceLink>
      <PageHeader
        title={workspace.inputs.product.name}
        subtitle={workspace.sku}
      />
      <Alert tone="muted">
        {text(
          "เทียบราคาบนฐานสินค้าที่บันทึก ไม่ใช่ราคาส่งถึงปลายทางหรือราคาที่แนะนำ ต้นทุนและกำไรยังไม่พร้อม",
          "Comparison uses recorded product bases, without delivered-price normalization or a recommended selling price. Cost and profit remain unavailable.",
        )}
      </Alert>
    </>
  );
}
function ComparisonMatrix({
  workspace,
  owner,
  role,
  refresh,
}: {
  workspace: Workspace;
  owner: string;
  role: string;
  refresh: () => void;
}) {
  const base = productUrl(workspace.sku),
    publicRows = workspace.rows.filter(
      (r) => r.observation.priceBasis === "public",
    ),
    memberRows = workspace.rows.filter(
      (r) => r.observation.priceBasis === "member",
    );
  return (
    <CommercePage>
      <ProductHeader workspace={workspace} />
      <Pending owner={owner} sku={workspace.sku} />
      <p role="status">
        {workspace.review
          ? `${text("ทำเครื่องหมายทบทวนแล้ว", "Marked reviewed")}: ${comparisonDate(workspace.review.at)} · ${workspace.review.by}`
          : text("ยังไม่ทำเครื่องหมายทบทวน", "Not marked reviewed")}
      </p>
      <div className="flex flex-wrap gap-3">
        <WorkspaceLink to={`${base}/match`}>
          {canPerformComparison(role, "create")
            ? text("ตรวจและเพิ่มคู่สินค้า", "Review and add product pairs")
            : text("อ่านข้อเสนอการจับคู่", "Inspect match suggestions")}
        </WorkspaceLink>
        <WorkspaceLink to={`${base}/planning`}>
          {text("ทบทวนหลักฐานก่อนวางแผน", "Review evidence before planning")}
        </WorkspaceLink>
        {canPerformComparison(role, "verify") && (
          <WorkspaceLink to={`${base}/batch`}>
            {text("ทบทวนหลายคู่ของสินค้านี้", "Review selected product pairs")}
          </WorkspaceLink>
        )}
        {canPerformComparison(role, "review") && (
          <WorkspaceLink to={`${base}/review-marker`}>
            {label("review")}
          </WorkspaceLink>
        )}
        <Button onClick={refresh}>
          {text("อ่านหลักฐานใหม่", "Refresh evidence")}
        </Button>
      </div>
      <p role="status">
        {text("คู่สินค้าที่อ่านได้", "Returned product pairs")}:{" "}
        {workspace.rows.length} ·{" "}
        {text("ฐานที่เทียบได้ขณะอ่าน", "Comparable at this read")}:{" "}
        {workspace.rows.filter((r) => r.eligible).length}
      </p>
      <p>
        {text("ข้อมูลอ่านเมื่อ", "Read captured at")}:{" "}
        {comparisonDate(workspace.capturedAt)} ·{" "}
        {text("อายุสำเนาต้นทางยังไม่ยืนยัน", "Upstream freshness unverified")}
      </p>
      {workspace.observationsTruncated && (
        <Alert tone="warn">
          {text(
            "แสดงไม่ครบทุกคู่สินค้า อย่าใช้เป็นยอดรวมตลาด",
            "Pair coverage is truncated; do not treat this as a market total.",
          )}
        </Alert>
      )}
      {!workspace.rows.length ? (
        <Empty>
          {canPerformComparison(role, "create")
            ? text(
                "ยังไม่มีคู่สินค้า เริ่มจากเพิ่มลิงก์สินค้าหรือเลือกสินค้าที่รวบรวมไว้",
                "No product pairs yet. Add a product link or select a collected item.",
              )
            : text(
                "ยังไม่มีคู่สินค้าที่บันทึกไว้ ให้การตลาดเพิ่มคู่ก่อนตรวจหลักฐาน",
                "No recorded product pairs yet. Marketing can add a pair before its evidence is reviewed.",
              )}
        </Empty>
      ) : (
        <>
          {[
            ["public", publicRows],
            ["member", memberRows],
          ].map(([basis, rows]) =>
            (rows as Workspace["rows"]).length ? (
              <Panel key={basis as string}>
                <PanelHead
                  title={
                    basis === "public"
                      ? text("ราคาสาธารณะ", "Public prices")
                      : text(
                          "ราคาสมาชิก แยกฐานราคา",
                          "Member prices — separate basis",
                        )
                  }
                />
                <div className="p-3">
                  <TableViewport>
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          {[
                            "ร้านและสินค้า",
                            "ราคาที่พบ / แพ็กเดิม",
                            "ฐานหน่วย",
                            "สถานะและเหตุผล",
                            "ตรวจข้อมูล",
                          ].map((th, i) => (
                            <th key={th} scope="col" className={`p-3 ${i === 1 || i === 2 ? "text-right" : "text-left"}`}>
                              {text(
                                th,
                                [
                                  "Vendor and product",
                                  "Observed price / original pack",
                                  "Unit basis",
                                  "Status and reasons",
                                  "Inspect",
                                ][i],
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(rows as Workspace["rows"]).map((r) => (
                          <tr key={r.id} className="border-t align-top">
                            <td className="p-3">
                              <strong>{r.vendor}</strong>
                              <p>{new URL(r.url).hostname}</p>
                              <p>{String(r.observation.productName)}</p>
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              <p>
                                {String(r.observation.priceIncVat ?? "—")}{" "}
                                {String(r.observation.currency ?? "—")}
                              </p>
                              <PackSummary pack={r.observation.originalPack} />
                              <p className="text-xs">
                                {comparisonDate(r.observation.observedAt)}
                              </p>
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {r.pricePerBaseIncVat
                                ? `${r.pricePerBaseIncVat} THB / ${r.unit}`
                                : "—"}
                              {r.differencePerBaseIncVat && (
                                <p>
                                  {text(
                                    "ราคาเรา ลบ ราคาคู่แข่ง",
                                    "Our price minus competitor price",
                                  )}
                                  : {r.differencePerBaseIncVat} THB / {r.unit}
                                </p>
                              )}
                            </td>
                            <td className="p-3">
                              <Chip tone={r.eligible ? "ok" : "warn"}>
                                {r.eligible
                                  ? text("ฐานเทียบได้", "Comparable basis")
                                  : text(
                                      "ยังใช้เทียบไม่ได้",
                                      "Excluded from comparison",
                                    )}
                              </Chip>
                              {r.reasons.map((reason) => (
                                <p key={reason}>{comparisonReason(reason)}</p>
                              ))}
                            </td>
                            <td className="p-3">
                              <WorkspaceLink to={`${base}/pairs/${r.id}`}>
                                {text("ตรวจคู่สินค้า", "Inspect pair")}
                              </WorkspaceLink>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableViewport>
                </div>
              </Panel>
            ) : null,
          )}
        </>
      )}
      {!canPerformComparison(role, "capture") && (
        <Alert tone="muted">
          {text(
            "อ่านอย่างเดียว ไม่มีการบันทึกราคาหรือยืนยันคู่สินค้า",
            "Read-only; no price capture or match verification.",
          )}
        </Alert>
      )}
      {role === "merchandising" && <MerComparisonAccess />}
    </CommercePage>
  );
}
function PackSummary({ pack }: { pack: unknown }) {
  const p = pack as {
    unit?: string;
    min?: string;
    max?: string;
    count?: number;
  } | null;
  return (
    <p>
      {p?.min ?? "—"}
      {p?.max && p.max !== p.min ? `–${p.max}` : ""} {p?.unit ?? "—"} ×{" "}
      {p?.count ?? 1}
    </p>
  );
}
function Candidates({
  workspace,
  role,
  owner,
}: {
  workspace: Workspace;
  role: string;
  owner: string;
}) {
  const source = useAsync(
    () =>
      readable(() =>
        api.get<{
          sku: string;
          sites: {
            sourceId: string;
            sourceName: string;
            candidates: {
              id: string;
              name: string;
              url: string;
              similarityPercent: number;
            }[];
          }[];
        }>(
          `${endpoint}/products/${encodeURIComponent(workspace.sku)}/candidates`,
        ),
      ),
    [workspace.sku],
  );
  const base = productUrl(workspace.sku);
  return (
    <CommercePage>
      <ProductHeader workspace={workspace} />
      <WorkspaceLink to={base}>
        {text("กลับไปเทียบราคา", "Back to comparison")}
      </WorkspaceLink>
      <Pending owner={owner} sku={workspace.sku} />
      <PageHeader
        title={text("ตรวจการจับคู่สินค้า", "Review product matching")}
        actions={
          canPerformComparison(role, "create") && (
            <WorkspaceLink to={`${base}/match/new`}>
              {text(
                "เพิ่มจากลิงก์และราคาที่พบเอง",
                "Add a manual product link",
              )}
            </WorkspaceLink>
          )
        }
      />
      <Alert tone="warn">
        {text(
          "ชื่อคล้ายเป็นเพียงข้อเสนอ ยังไม่ยืนยันว่าเป็นสินค้าเดียวกัน การเพิ่มคู่ไม่ยืนยันราคา",
          "Name similarity is a suggestion. It does not verify product identity or the observed price.",
        )}
      </Alert>
      <ErrorText error={source.error} onRetry={source.reload} />
      {source.loading ? (
        <Loading variant="table" />
      ) : source.data && !source.error ? (
        source.data.sites.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {source.data.sites.map((s) => (
              <Panel key={s.sourceId}>
                <PanelHead title={s.sourceName} />
                <div className="p-4 space-y-4">
                  {s.candidates.map((c) => (
                    <div key={c.id}>
                      <p>{c.name}</p>
                      <p>
                        {new URL(c.url).hostname} ·{" "}
                        {text("ชื่อคล้าย", "Name similarity")}:{" "}
                        {c.similarityPercent}%
                      </p>
                      {canPerformComparison(role, "create") && (
                        <WorkspaceLink to={`${base}/match/new?item=${c.id}`}>
                          {text(
                            "ตรวจข้อมูลก่อนเพิ่มคู่",
                            "Review before adding pair",
                          )}
                        </WorkspaceLink>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </div>
        ) : (
          <Empty>
            {canPerformComparison(role, "create")
              ? text(
                  "ไม่พบข้อเสนอในสินค้าที่รวบรวมไว้ เพิ่มลิงก์เองหรือทบทวนคู่ที่มีแล้ว",
                  "No candidates among collected items. Add a manual link or inspect existing pairs.",
                )
              : text(
                  "ไม่พบข้อเสนอในสินค้าที่รวบรวมไว้ กลับไปตรวจคู่สินค้าที่บันทึกแล้ว",
                  "No candidates among collected items. Return to the recorded pairs to inspect their evidence.",
                )}
          </Empty>
        )
      ) : null}
    </CommercePage>
  );
}
function PairDetail({
  workspace,
  row,
  role,
}: {
  workspace: Workspace;
  row: Workspace["rows"][number];
  role: string;
}) {
  const history = useAsync(
    () =>
      readable(() =>
        api.get<{
          pairId: string;
          items: {
            id: string;
            at: string;
            actorId: string;
            before: Record<string, unknown> | null;
            after: Record<string, unknown> | null;
          }[];
          hasMore: boolean;
        }>(`${endpoint}/pairs/${row.id}/history`),
      ),
    [row.id],
  );
  const base = `${productUrl(workspace.sku)}/pairs/${row.id}`;
  return (
    <CommercePage>
      <ProductHeader workspace={workspace} />
      <WorkspaceLink to={productUrl(workspace.sku)}>
        {text("กลับไปเทียบราคา", "Back to comparison")}
      </WorkspaceLink>
      <PageHeader
        title={String(row.observation.productName)}
        subtitle={`${row.vendor} · ${new URL(row.url).hostname}`}
      />
      <Panel>
        <div className="p-4 space-y-2">
          <a href={row.url} target="_blank" rel="noreferrer">
            {text("เปิดแหล่งราคา", "Open price source")}
          </a>
          <p>{String(row.rawEvidence?.context ?? row.context)}</p>
          <PackSummary pack={row.observation.originalPack} />
          <p>
            {String(row.observation.priceIncVat ?? "—")}{" "}
            {String(row.observation.currency ?? "—")} ·{" "}
            {choiceText(
              String(row.rawEvidence?.taxBasis ?? row.observation.taxBasis),
            )}{" "}
            · {choiceText(String(row.observation.priceBasis))}
          </p>
          <p>{comparisonDate(row.observation.observedAt)}</p>
          <p>
            {text("ฉบับข้อมูล", "Record revision")}: {row.revision}
          </p>
          {row.reasons.map((r) => (
            <Alert key={r} tone="warn">
              {comparisonReason(r)}
            </Alert>
          ))}
          <div className="flex flex-wrap gap-3">
            {[
              "capture",
              "verify",
              "pack",
              "settings",
              "reassign",
              "refresh",
              "remove",
            ]
              .filter((action) => canPerformComparison(role, action))
              .map((action) => (
                <WorkspaceLink key={action} to={`${base}/${action}`}>
                  {label(action)}
                </WorkspaceLink>
              ))}
          </div>
        </div>
      </Panel>
      <Panel>
        <PanelHead
          title={text(
            "ประวัติการบันทึกและหลักฐานเดิม",
            "Recorded actions and original evidence",
          )}
        />
        <div className="p-4 space-y-3">
          <ErrorText error={history.error} onRetry={history.reload} />
          {history.loading ? (
            <Loading variant="table" />
          ) : history.data && !history.error ? (
            history.data.pairId !== row.id ? (
              <Alert tone="danger">
                {text(
                  "ข้อมูลประวัติไม่ตรงคู่สินค้า",
                  "History identity mismatch.",
                )}
              </Alert>
            ) : (
              <>
                {!history.data.items.length ? (
                  <Empty>
                    {text(
                      "ยังไม่มีประวัติจากขั้นตอนใหม่นี้ ข้อมูลเก่ามีเพียงสถานะล่าสุด ไม่อ้างว่ามีประวัติครบ",
                      "No actions from this flow yet. Legacy data only has its latest state; complete history is unavailable.",
                    )}
                  </Empty>
                ) : (
                  history.data.items.map((item) => (
                    <Panel key={item.id}>
                      <div className="p-3">
                        <p>{comparisonDate(item.at)}</p>
                        <p>
                          {text("ผู้บันทึก", "Recorded by")}: {item.actorId}
                        </p>
                        {item.before && (
                          <>
                            <strong>
                              {text(
                                "ราคาที่บันทึกก่อนหน้า",
                                "Previously recorded price",
                              )}
                            </strong>
                            <HistoricalObservation snapshot={item.before} />
                          </>
                        )}
                        <strong>
                          {text("ผลที่บันทึก", "Persisted result")}
                        </strong>
                        <HistoricalObservation snapshot={item.after} />
                      </div>
                    </Panel>
                  ))
                )}
                {history.data.hasMore && (
                  <Alert tone="warn">
                    {text(
                      "แสดงประวัติล่าสุด 20 รายการ ยังมีรายการเก่า",
                      "Showing the latest 20 actions; earlier history exists.",
                    )}
                  </Alert>
                )}
              </>
            )
          ) : null}
        </div>
      </Panel>
    </CommercePage>
  );
}

type Form = {
  sourceUrl: string;
  sourceId: string;
  catalogItemId: string;
  name: string;
  competitorSku: string;
  context: string;
  unit: string;
  min: string;
  max: string;
  count: string;
  price: string;
  currency: string;
  taxBasis: string;
  priceBasis: string;
  observedAt: string;
  relationship: string;
  note: string;
  collectionAllowed: string;
  autoRefresh: string;
};
function blankForm(row?: Workspace["rows"][number]): Form {
  const p = row?.observation.originalPack as
    | { unit?: string; min?: string; max?: string; count?: number }
    | undefined;
  return {
    sourceUrl: row?.url ?? "",
    sourceId: row?.sourceId ?? "",
    catalogItemId: "",
    name: String(row?.observation.productName ?? ""),
    competitorSku: row?.competitorSku ?? "",
    context: row?.context ?? "",
    unit: p?.unit ?? "kg",
    min: p?.min ?? "1",
    max: p?.max ?? "1",
    count: String(p?.count ?? 1),
    price: "",
    currency: "THB",
    taxBasis: "unverified",
    priceBasis: String(row?.observation.priceBasis ?? "public"),
    observedAt: new Date().toISOString().slice(0, 16),
    relationship: "uncertain",
    note: "",
    collectionAllowed: row?.collectionAllowed ? "true" : "false",
    autoRefresh: row?.autoRefresh ? "true" : "false",
  };
}
export function commandFromComparisonForm(
  action: string,
  form: Form,
  row?: Workspace["rows"][number],
): ComparisonCommand {
  const pack = {
      unit: form.unit,
      min: form.min,
      max: form.max,
      count: Number(form.count),
    },
    pair = { pairId: row?.id, revision: row?.revision };
  let command: unknown;
  if (action === "review") command = { operation: "review", note: form.note };
  else if (action === "refresh") command = { operation: "refresh", ...pair };
  else if (action === "reassign") {
    if (
      row &&
      form.sourceUrl === row.url &&
      (form.sourceId || null) === row.sourceId
    )
      throw Error("Choose a different product URL or source.");
    command = {
      operation: "reassign",
      ...pair,
      sourceUrl: form.sourceUrl,
      sourceId: form.sourceId || null,
      name: form.name,
      competitorSku: form.competitorSku,
      context: form.context,
      note: form.note,
    };
  } else if (action === "settings")
    command = {
      operation: "settings",
      ...pair,
      name: form.name,
      competitorSku: form.competitorSku,
      context: form.context,
      collectionAllowed: form.collectionAllowed === "true",
      autoRefresh: form.autoRefresh === "true",
    };
  else if (action === "create")
    command = {
      operation: "create",
      sourceUrl: form.sourceUrl,
      sourceId: form.sourceId || null,
      catalogItemId: form.catalogItemId || null,
      name: form.name,
      competitorSku: form.competitorSku,
      context: form.context,
      pack,
    };
  else if (action === "pack") command = { operation: "pack", ...pair, pack };
  else if (action === "verify")
    command = {
      operation: "verify",
      ...pair,
      relationship: form.relationship,
      note: form.note,
    };
  else if (action === "remove")
    command = { operation: "remove", ...pair, note: form.note };
  else
    command = {
      operation: "capture",
      ...pair,
      price: form.price,
      currency: form.currency,
      taxBasis: form.taxBasis,
      priceBasis: form.priceBasis,
      observedAt: Number.isFinite(Date.parse(`${form.observedAt}Z`))
        ? new Date(`${form.observedAt}Z`).toISOString()
        : "invalid",
      context: form.context,
    };
  return comparisonCommandSchema.parse(command);
}
function ActionEditor({
  workspace,
  row,
  action,
  owner,
  role,
  review,
  base,
}: {
  workspace: Workspace;
  row?: Workspace["rows"][number];
  action: string;
  owner: string;
  role: string;
  review: boolean;
  base: string;
}) {
  const [params] = useSearchParams(),
    itemId = params.get("item"),
    navigate = useNavigate(),
    jobs = useJobs(owner),
    writer = useComparisonWriter(owner),
    lock = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stored = useRef<{
    form: Form;
    fingerprint: string;
    revision: number | null;
  } | null>(null);
  if (stored.current === null) {
    try {
      const raw = JSON.parse(
        localStorage.getItem(comparisonFormKey(owner, base)) ?? "null",
      );
      if (
        raw &&
        typeof raw.form === "object" &&
        Object.keys(blankForm()).every((k) => typeof raw.form[k] === "string")
      )
        stored.current = raw;
    } catch {
      /* Invalid backup ignored. */
    }
  }
  const [form, setForm] = useState<Form>(
      () => stored.current?.form ?? blankForm(row),
    ),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [acceptedFingerprint, setAccepted] = useState(
      stored.current?.fingerprint ?? workspace.sourceFingerprint,
    ),
    [storageError, setStorageError] = useState<string | null>(null),
    [packet, setPacket] = useState<ComparisonPacket | null>(null);
  const sources = useAsync(
    () =>
      ["create", "reassign"].includes(action) &&
      canPerformComparison(role, action)
        ? api.get<{ id: string; name: string; origin: string }[]>(
            `${endpoint}/sources`,
          )
        : Promise.resolve([]),
    [action, role],
  );
  const item = useAsync(
    () =>
      action === "create" &&
      canPerformComparison(role, action) &&
      itemId &&
      comparisonUuid.safeParse(itemId).success
        ? api.get<{
            id: string;
            sourceId: string;
            url: string;
            name: string;
            sku: string;
            context: string;
            configCurrent: boolean;
          }>(`${endpoint}/items/${itemId}`)
        : Promise.resolve(null),
    [itemId, action, role],
  );
  useEffect(() => {
    if (!item.data) return;
    if (item.data.id !== itemId || !item.data.configCurrent) {
      setStorageError(
        text(
          "ข้อมูลสินค้าต้นทางเปลี่ยน เลือกใหม่",
          "Collected item changed. Select it again.",
        ),
      );
      return;
    }
    if (!stored.current)
      setForm((f) => ({
        ...f,
        sourceUrl: item.data!.url,
        sourceId: item.data!.sourceId,
        catalogItemId: item.data!.id,
        name: item.data!.name,
        competitorSku: item.data!.sku,
        context: item.data!.context,
      }));
  }, [item.data, itemId]);
  useEffect(() => {
    try {
      localStorage.setItem(
        comparisonFormKey(owner, base),
        JSON.stringify({
          form,
          fingerprint: acceptedFingerprint,
          revision: row?.revision ?? null,
        }),
      );
      setStorageError(null);
    } catch {
      setStorageError(
        text(
          "เก็บข้อมูลฟอร์มไม่ได้ ตรวจพื้นที่เบราว์เซอร์",
          "Form storage unavailable. Check browser storage.",
        ),
      );
    }
  }, [form, owner, base, acceptedFingerprint, row?.revision]);
  const stale =
      acceptedFingerprint !== workspace.sourceFingerprint ||
      (stored.current && stored.current.revision !== (row?.revision ?? null)),
    pending = jobs.some((j) => j.packet.sku === workspace.sku);
  function prepare() {
    try {
      if (!canPerformComparison(role, action))
        throw Error("Action is outside this account's permissions");
      const command = commandFromComparisonForm(action, form, row);
      setErrors({});
      const p = comparisonPacketSchema.parse({
        requestId: crypto.randomUUID(),
        sku: workspace.sku,
        sourceFingerprint: workspace.sourceFingerprint,
        commands: [command],
      });
      setPacket(p);
      return p;
    } catch (e) {
      const issues = e instanceof z.ZodError ? e.issues : [];
      const next: Record<string, string> = {};
      for (const i of issues)
        next[String(i.path[i.path.length - 1] ?? "form")] = i.message;
      setErrors(Object.keys(next).length ? next : { form: message(e) });
      setTimeout(
        () =>
          document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        0,
      );
      return null;
    }
  }
  async function save() {
    if (
      lock.current ||
      !canPerformComparison(role, action) ||
      stale ||
      pending ||
      storageError
    )
      return;
    lock.current = true;
    const p = packet ?? prepare();
    if (!p) {
      lock.current = false;
      return;
    }
    if (!canApplyComparisonPacket(role, p)) {
      lock.current = false;
      return;
    }
    const result = await writer.write({ owner, packet: p, conflict: false });
    lock.current = false;
    if (!mounted.current) return;
    if (result) {
      try {
        localStorage.removeItem(comparisonFormKey(owner, base));
      } catch {
        /* Receipt is authoritative. */
      }
      navigate(requestUrl(p.requestId));
    } else if (
      readComparisonJobs(owner).some((j) => j.packet.requestId === p.requestId)
    )
      navigate(requestUrl(p.requestId));
  }
  if (!canPerformComparison(role, action))
    return (
      <CommercePage>
        <ProductHeader workspace={workspace} />
        <Alert tone="muted">
          {text(
            "บัญชีนี้อ่านอย่างเดียว จึงไม่มีการส่งบันทึก",
            "This account is read-only; no action is dispatched.",
          )}
        </Alert>
        <WorkspaceLink to={productUrl(workspace.sku)}>
          {text("อ่านผลเทียบ", "Read comparison")}
        </WorkspaceLink>
      </CommercePage>
    );
  const change = (key: keyof Form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setPacket(null);
    setErrors({});
  };
  const input = (key: keyof Form, th: string, en: string, type = "text") => (
    <TaskInput
      label={text(th, en)}
      type={type}
      value={form[key]}
      error={errors[key]}
      onChange={(e) => change(key, e.target.value)}
    />
  );
  const select = (
    key: keyof Form,
    th: string,
    en: string,
    values: string[],
  ) => (
    <TaskSelect
      label={text(th, en)}
      value={form[key]}
      error={errors[key]}
      onChange={(e) => change(key, e.target.value)}
    >
      {values.map((v) => (
        <option key={v} value={v}>
          {choiceText(v)}
        </option>
      ))}
    </TaskSelect>
  );
  return (
    <CommercePage>
      <ProductHeader workspace={workspace} />
      <WorkspaceLink
        to={
          row
            ? `${productUrl(workspace.sku)}/pairs/${row.id}`
            : `${productUrl(workspace.sku)}/match`
        }
      >
        {text("กลับไปตรวจข้อมูล", "Back to evidence")}
      </WorkspaceLink>
      <PageHeader
        title={label(action)}
        subtitle={
          review
            ? text("ทบทวนก่อนบันทึก", "Review before saving")
            : text(
                "กรอกเฉพาะข้อมูลของการทำงานนี้",
                "Enter the fields needed for this action",
              )
        }
      />
      <Pending owner={owner} sku={workspace.sku} />
      {stale && (
        <Alert tone="warn">
          {text(
            "หลักฐานหรือฉบับข้อมูลเปลี่ยน ตรวจข้อมูลล่าสุดก่อนใช้ค่าที่เก็บไว้",
            "Evidence or revision changed. Review current data before using retained values.",
          )}
          <Button
            onClick={() => {
              stored.current = {
                form,
                fingerprint: workspace.sourceFingerprint,
                revision: row?.revision ?? null,
              };
              setAccepted(workspace.sourceFingerprint);
              setPacket(null);
            }}
          >
            {text(
              "ใช้ข้อมูลล่าสุดและทบทวนค่าที่กรอก",
              "Use current evidence and review entered values",
            )}
          </Button>
        </Alert>
      )}
      <ErrorText
        error={storageError || writer.error || item.error || sources.error}
        onRetry={
          item.error ? item.reload : sources.error ? sources.reload : undefined
        }
      />
      {item.data && form.catalogItemId !== item.data.id && (
        <Alert tone="warn">
          {text(
            "มีสินค้าจากคลังที่เลือกไว้ ค่าฟอร์มเดิมยังเก็บอยู่",
            "A collected item was selected. Your previous form values are retained.",
          )}
          <Button
            disabled={!item.data.configCurrent}
            onClick={() =>
              setForm((f) => ({
                ...f,
                sourceUrl: item.data!.url,
                sourceId: item.data!.sourceId,
                catalogItemId: item.data!.id,
                name: item.data!.name,
                competitorSku: item.data!.sku,
                context: item.data!.context,
              }))
            }
          >
            {text(
              "ใช้สินค้าที่เลือกนี้และตรวจขนาดแพ็ก",
              "Use this selected item and review its pack",
            )}
          </Button>
        </Alert>
      )}
      {review ? (
        <Panel>
          <div className="p-4 space-y-3">
            <p>
              {text("สินค้า", "Product")}: {workspace.inputs.product.name} ·{" "}
              {workspace.sku}
            </p>
            {row && (
              <p>
                {row.vendor} · {String(row.observation.productName)} ·{" "}
                {text("ฉบับ", "Revision")} {row.revision}
              </p>
            )}
            <p>{label(action)}</p>
            {["create", "settings", "reassign"].includes(action) && (
              <>
                <p>{form.name}</p>
                <p>{form.sourceUrl}</p>
              </>
            )}
            {["create", "pack"].includes(action) && (
              <PackSummary
                pack={{
                  unit: form.unit,
                  min: form.min,
                  max: form.max,
                  count: Number(form.count),
                }}
              />
            )}
            {action === "capture" && (
              <>
                <p>
                  {form.price} {form.currency} · {choiceText(form.taxBasis)} ·{" "}
                  {choiceText(form.priceBasis)}
                </p>
                <p>{form.observedAt} UTC</p>
              </>
            )}
            <p>{form.context}</p>
            {action === "settings" && (
              <p>
                {text(
                  "สิทธิ์รวบรวม / อัตโนมัติ",
                  "Collection permission / automatic collection",
                )}
                :{" "}
                {form.collectionAllowed === "true"
                  ? text("ยืนยันแล้ว", "Confirmed")
                  : text("ยังไม่ยืนยัน", "Unconfirmed")}{" "}
                /{" "}
                {form.autoRefresh === "true"
                  ? text("เปิด", "On")
                  : text("ปิด", "Off")}
              </p>
            )}
            <p>
              {choiceText(form.relationship)} · {form.note}
            </p>
            {action === "reassign" && (
              <Alert tone="warn">
                {text(
                  "เปลี่ยนลิงก์เฉพาะคู่นี้ เก็บหลักฐานเดิมในประวัติ ล้างราคาที่ใช้งาน การยืนยันคู่ และการยืนยัน VAT ปิดการรวบรวมอัตโนมัติและสิทธิ์รวบรวม ต้องบันทึกราคาและตรวจคู่ใหม่ก่อนใช้",
                  "This changes only this pair. Original quotes stay in history. The current price, match and VAT confirmation are cleared; collection permission and automatic collection are turned off. Record and review new evidence before use.",
                )}
                <p>
                  {text("ลิงก์เดิม", "Previous URL")}: {row?.url}
                </p>
              </Alert>
            )}
            <Alert tone="warn">
              {text(
                "บันทึกราคาไม่ยืนยันคู่สินค้า ราคาที่หน่วยหรือฐานไม่ตรงจะเก็บหลักฐานและแยกออกจากผลเทียบ",
                "Recording a price does not verify its product match. Incompatible bases retain evidence and remain excluded.",
              )}
            </Alert>
            <WorkspaceLink to={`${base}${itemId ? `?item=${itemId}` : ""}`}>
              {text("กลับไปแก้ข้อมูล", "Edit entered values")}
            </WorkspaceLink>
            <Button
              disabled={writer.busy || !!stale || pending || !!storageError}
              onClick={save}
            >
              {writer.busy
                ? text("กำลังบันทึก…", "Saving…")
                : text("บันทึกการทำงานนี้", "Save this action")}
            </Button>
            {errors.form && <Alert tone="danger">{errors.form}</Alert>}
          </div>
        </Panel>
      ) : (
        <Panel>
          <form
            className="p-4 grid gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (stale || pending || storageError) return;
              if (prepare())
                navigate(`${base}/review${itemId ? `?item=${itemId}` : ""}`);
            }}
          >
            {["create", "settings", "reassign"].includes(action) && (
              <>
                {input("name", "ชื่อสินค้าคู่แข่ง", "Competitor product name")}
                {["create", "reassign"].includes(action) &&
                  input(
                    "sourceUrl",
                    "ลิงก์หน้าสินค้า HTTPS",
                    "HTTPS product URL",
                  )}
                {["create", "reassign"].includes(action) && (
                  <TaskSelect
                    label={text("แหล่งราคา", "Price source")}
                    value={form.sourceId}
                    onChange={(e) => change("sourceId", e.target.value)}
                  >
                    <option value="">
                      {text(
                        "ลิงก์ร้านที่รองรับโดยไม่ผูกตัวอ่าน",
                        "Supported retailer link without a configured reader",
                      )}
                    </option>
                    {sources.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.origin}
                      </option>
                    ))}
                  </TaskSelect>
                )}
                {input(
                  "competitorSku",
                  "รหัสสินค้าคู่แข่ง ถ้ามี",
                  "Competitor SKU, if known",
                )}
              </>
            )}
            {["create", "pack"].includes(action) && (
              <>
                {select("unit", "หน่วยในแพ็ก", "Pack unit", [
                  "kg",
                  "g",
                  "l",
                  "ml",
                  "piece",
                ])}
                {input(
                  "min",
                  "จำนวนต่อชิ้น / ค่าต่ำสุด",
                  "Quantity per piece / minimum",
                )}
                {input(
                  "max",
                  "จำนวนต่อชิ้น / ค่าสูงสุด",
                  "Quantity per piece / maximum",
                )}
                {input("count", "จำนวนชิ้นในแพ็ก", "Pieces per pack", "number")}
              </>
            )}
            {action === "capture" && (
              <>
                {input(
                  "price",
                  "ราคาทั้งแพ็กที่พบ",
                  "Observed full-pack price",
                )}
                {input(
                  "currency",
                  "สกุลเงิน เช่น THB",
                  "Currency, for example THB",
                )}
                {select("taxBasis", "ฐาน VAT ที่พบ", "Observed VAT basis", [
                  "unverified",
                  "inclusive",
                  "exclusive",
                ])}
                {select(
                  "priceBasis",
                  "ฐานราคาสาธารณะหรือสมาชิก",
                  "Public or member price",
                  ["public", "member"],
                )}
                {input(
                  "observedAt",
                  "พบราคาเมื่อ (UTC)",
                  "Observed at (UTC)",
                  "datetime-local",
                )}
              </>
            )}
            {action === "settings" && (
              <>
                <TaskSelect
                  label={text(
                    "ยืนยันสิทธิ์ดึงข้อมูลสำหรับคู่นี้",
                    "Collection permission for this pair",
                  )}
                  value={form.collectionAllowed}
                  onChange={(e) => change("collectionAllowed", e.target.value)}
                >
                  <option value="false">
                    {text("ยังไม่ยืนยัน", "Unconfirmed")}
                  </option>
                  <option value="true">
                    {text("ยืนยันสิทธิ์แล้ว", "Permission confirmed")}
                  </option>
                </TaskSelect>
                <TaskSelect
                  label={text("รวบรวมอัตโนมัติ", "Automatic collection")}
                  value={form.autoRefresh}
                  onChange={(e) => change("autoRefresh", e.target.value)}
                >
                  <option value="false">{text("ปิด", "Off")}</option>
                  <option value="true">
                    {text(
                      "เปิดตามกฎต้นทางเดิม",
                      "On under existing source rules",
                    )}
                  </option>
                </TaskSelect>
              </>
            )}
            {action === "refresh" && (
              <Alert tone="warn">
                {row?.canRefresh
                  ? text(
                      "จะอ่านหน้าสินค้าผ่านตัวรวบรวมเดิม ไม่ตรวจยืนยันคู่สินค้าให้อัตโนมัติ",
                      "Reads the product page through the existing collector. This does not verify a product match.",
                    )
                  : row?.refreshReason ||
                    text("ยังไม่พร้อมรวบรวม", "Collection is unavailable")}
              </Alert>
            )}
            {["create", "capture", "settings", "reassign"].includes(action) &&
              input(
                "context",
                "เงื่อนไขราคาและบริบท",
                "Price conditions and context",
              )}
            {action === "verify" &&
              select(
                "relationship",
                "ความสัมพันธ์ของสินค้า",
                "Product relationship",
                ["uncertain", "same_product", "substitute"],
              )}
            {["verify", "remove", "review", "reassign"].includes(action) &&
              input(
                "note",
                "เหตุผลที่ตรวจแล้ว อย่างน้อย 10 ตัวอักษร",
                "Reviewed reason, at least 10 characters",
              )}
            <div className="md:col-span-2">
              <Button
                type="submit"
                disabled={!!stale || pending || !!storageError || item.loading}
              >
                {text("ทบทวนก่อนบันทึก", "Review before saving")}
              </Button>
              <ErrorText
                error={
                  errors.form ??
                  (Object.keys(errors).length
                    ? text(
                        "ตรวจช่องที่มีข้อผิดพลาด",
                        "Check the highlighted fields.",
                      )
                    : null)
                }
              />
            </div>
          </form>
        </Panel>
      )}
    </CommercePage>
  );
}
function ReceiptOutcome({ receipt }: { receipt: ComparisonReceipt }) {
  const applied = receipt.results.filter((r) => r.status === "applied").length;
  return (
    <>
      <Alert
        tone={
          receipt.status === "committed"
            ? "ok"
            : receipt.status === "partial"
              ? "warn"
              : "danger"
        }
      >
        <span role="status">
          {text("ผลที่มีหลักฐานบันทึกแล้ว", "Persisted action outcomes")}:{" "}
          {applied} / {receipt.results.length}
        </span>
      </Alert>
      <p>{comparisonDate(receipt.savedAt)}</p>
      {receipt.results.map((r) => {
        const command = receipt.packet.commands[r.index],
          recorded = r.after ?? r.before;
        return (
          <Panel key={r.index}>
            <div className="p-3">
              <p className="break-words">
                {String(
                  recorded?.competitorName ??
                    ("pairId" in command ? command.pairId : receipt.packet.sku),
                )}
              </p>
              {recorded?.sourceUrl != null && (
                <p className="break-words">{String(recorded?.sourceUrl)}</p>
              )}
              <p>
                {label(receipt.packet.commands[r.index].operation)} ·{" "}
                {r.status === "applied"
                  ? text("บันทึกแล้ว", "Persisted")
                  : r.after
                    ? text(
                        "งานไม่สำเร็จ บันทึกสถานะล้มเหลวไว้แล้ว",
                        "Action failed; failure status recorded",
                      )
                    : text("ไม่ได้บันทึก", "Not applied")}
              </p>
              {r.message && <Alert tone="danger">{r.message}</Alert>}
              {r.after?.revision != null && (
                <p>
                  {text("ฉบับข้อมูลหลังบันทึก", "Persisted record revision")}:{" "}
                  {String(r.after.revision)}
                </p>
              )}
            </div>
          </Panel>
        );
      })}
      <WorkspaceLink to={productUrl(receipt.packet.sku)}>
        {text("อ่านฐานราคาและสถานะล่าสุด", "Read current comparison evidence")}
      </WorkspaceLink>
    </>
  );
}
function Recovery({
  requestId,
  owner,
  role,
}: {
  requestId: string;
  owner: string;
  role: string;
}) {
  const jobs = useJobs(owner),
    job = jobs.find((j) => j.packet.requestId === requestId),
    writer = useComparisonWriter(owner),
    [result, setResult] = useState<ComparisonReceipt | null>(null);
  const lookup = useAsync(async () => {
    try {
      const receipt = verifyComparisonReceipt(
        await api.get(`${endpoint}/requests/${requestId}`),
        job?.packet,
      );
      if (receipt.requestId !== requestId)
        throw Error("Request identity mismatch");
      return { receipt, absent: false };
    } catch (e) {
      if ((e as { status?: number }).status === 404)
        return { receipt: null, absent: true };
      throw Error(message(e));
    }
  }, [requestId]);
  const receipt = result ?? lookup.data?.receipt;
  useEffect(() => {
    if (receipt) {
      try {
        clearComparisonJob(owner, requestId);
      } catch {
        /* Persisted receipt remains valid. */
      }
    }
  }, [receipt, owner, requestId]);
  async function retry() {
    if (
      !job ||
      job.conflict ||
      !lookup.data?.absent ||
      !canApplyComparisonPacket(role, job.packet)
    )
      return;
    const saved = await writer.write(job);
    if (saved) setResult(saved);
    else lookup.reload();
  }
  return (
    <CommercePage>
      <WorkspaceLink to={home}>
        {text("กลับไปเทียบราคา", "Back to comparison")}
      </WorkspaceLink>
      <PageHeader title={text("ตรวจผลคำขอบันทึก", "Check action request")} />
      <ErrorText error={lookup.error || writer.error} onRetry={lookup.reload} />
      {lookup.loading ? (
        <Loading variant="detail" />
      ) : receipt ? (
        <ReceiptOutcome receipt={receipt} />
      ) : lookup.error ? null : (
        <>
          <Alert tone="warn">
            {text(
              "ยังไม่พบหลักฐานคำขอนี้ที่บันทึกแล้ว จึงยังไม่แสดงว่าสำเร็จ",
              "No committed receipt was found. Success remains unverified.",
            )}
          </Alert>
          {job ? (
            job.conflict ? (
              <>
                <Alert tone="warn">
                  {text(
                    "ข้อมูลขัดแย้งหรือฉบับเปลี่ยน ต้องทบทวนข้อมูลล่าสุดเพื่อเริ่มคำขอใหม่",
                    "Evidence or revision conflicts. Review current data before starting a new request.",
                  )}
                </Alert>
                <WorkspaceLink to={productUrl(job.packet.sku)}>
                  {text("เปิดข้อมูลล่าสุด", "Inspect current evidence")}
                </WorkspaceLink>
                <Button
                  onClick={() => {
                    clearComparisonJob(owner, requestId);
                  }}
                >
                  {text(
                    "ปิดคำขอที่ขัดแย้งนี้",
                    "Dismiss this conflicting request",
                  )}
                </Button>
              </>
            ) : (
              canApplyComparisonPacket(role, job.packet) && (
                <Button disabled={writer.busy} onClick={retry}>
                  {text(
                    "ส่งคำขอเดิมอีกครั้ง",
                    "Retry the same immutable request",
                  )}
                </Button>
              )
            )
          ) : (
            <Empty>
              {text(
                "ไม่มีคำขอเดิมในเบราว์เซอร์นี้ จึงไม่สร้างคำขอใหม่เพื่อเดาผล",
                "Original request is absent from this browser. No replacement intent is guessed.",
              )}
            </Empty>
          )}
          {job && !canApplyComparisonPacket(role, job.packet) && (
            <Alert tone="warn">
              {text(
                "คำขอเดิมมีรายการนอกสิทธิ์ปัจจุบัน จึงส่งซ้ำไม่ได้ ตรวจผลเดิมได้โดยไม่สร้างคำขอใหม่",
                "The retained request includes actions outside your current permissions. You can check its result, but cannot retry it.",
              )}
            </Alert>
          )}
          <Button disabled={writer.busy} onClick={lookup.reload}>
            {text("ตรวจผลอีกครั้ง", "Check again")}
          </Button>
        </>
      )}
    </CommercePage>
  );
}
function PlanningHandoff({
  workspace,
  role,
}: {
  workspace: Workspace;
  role: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const handoff = useAsync(
    () =>
      readable(async () =>
        parseComparisonHandoff(
          await api.get(
            `${endpoint}/handoff/${encodeURIComponent(workspace.sku)}`,
          ),
          workspace.sku,
          workspace.sourceFingerprint,
        ),
      ),
    [workspace.sku, workspace.sourceFingerprint],
  );
  useEffect(() => {
    const ids = handoff.data?.eligibleIds ?? [];
    setSelected(ids.length <= 20 ? ids : []);
  }, [handoff.data]);
  return (
    <CommercePage>
      <ProductHeader workspace={workspace} />
      <WorkspaceLink to={productUrl(workspace.sku)}>
        {text("กลับไปเทียบราคา", "Back to comparison")}
      </WorkspaceLink>
      <PageHeader
        title={text("ตรวจหลักฐานก่อนวางแผน", "Review evidence before planning")}
      />
      <ErrorText error={handoff.error} onRetry={handoff.reload} />
      {handoff.loading ? (
        <Loading variant="detail" />
      ) : handoff.data && !handoff.error ? (
        <>
          <p role="status">
            {text(
              "คู่สินค้าที่มีฐานรองรับการวางแผน",
              "Pairs with supported planning evidence",
            )}
            : {handoff.data.eligibleIds.length}
          </p>
          {!handoff.data.eligibleIds.length ? (
            <Empty>
              {text(
                "ยังไม่มีฐานราคาที่พร้อมส่งต่อ ตรวจคู่สินค้า ขนาดและราคาที่พบก่อน",
                "No eligible price evidence for handoff. Review product matches, packs and observations first.",
              )}
            </Empty>
          ) : (
            <>
              <p>
                {text(
                  "จะอ่านหลักฐานล่าสุดอีกครั้งเมื่อเปิดการวางแผน ราคาคู่แข่งไม่ใช่ต้นทุนและไม่กำหนดราคาขายให้อัตโนมัติ",
                  "Planning re-reads evidence. Competitor prices are not internal costs or automatic selling-price decisions.",
                )}
              </p>
              <fieldset className="space-y-3">
                <legend>
                  {text(
                    "เลือกคู่ที่จะใช้ในร่าง สูงสุด 20 คู่",
                    "Choose pairs for this draft, up to 20",
                  )}
                </legend>
                {handoff.data.eligibleIds.map((id) => {
                  const row = workspace.rows.find((r) => r.id === id)!;
                  return (
                    <label key={id} className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.includes(id)}
                        disabled={
                          !selected.includes(id) && selected.length >= 20
                        }
                        onChange={(e) =>
                          setSelected((previous) =>
                            e.target.checked
                              ? [...previous, id]
                              : previous.filter((x) => x !== id),
                          )
                        }
                      />
                      <span>
                        {row.vendor} · {new URL(row.url).hostname} ·{" "}
                        {String(row.observation.productName)}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <p role="status">
                {text("เลือกแล้ว", "Selected")}: {selected.length} / 20
              </p>
              {!selected.length ? (
                <Alert tone="warn">
                  {text(
                    "เลือกอย่างน้อยหนึ่งคู่ก่อนเปิดร่าง",
                    "Select at least one pair before opening a draft.",
                  )}
                </Alert>
              ) : (
                canChangeComparison(role) && (
                  <>
                    <WorkspaceLink
                      to={`/planning/pack-prices/new/product?comparisonSku=${encodeURIComponent(workspace.sku)}&comparisonFingerprint=${handoff.data.sourceFingerprint}&comparisonPairs=${selected.join(",")}`}
                    >
                      {text(
                        "เสนอแพ็กและราคาในร่างส่วนตัว",
                        "Propose packs and prices in a private draft",
                      )}
                    </WorkspaceLink>
                    {role === "admin" ? (
                      <WorkspaceLink
                        to={`/planning/promotions/new?comparisonSku=${encodeURIComponent(workspace.sku)}&comparisonFingerprint=${handoff.data.sourceFingerprint}&comparisonPairs=${selected.join(",")}`}
                      >
                        {text(
                          "เปิดการทดลองโปรโมชันสำหรับสินค้านี้",
                          "Open promotion rehearsal for this product",
                        )}
                      </WorkspaceLink>
                    ) : (
                      <Alert tone="muted">
                        {text(
                          "การทดลองโปรโมชันใช้สิทธิ์ผู้ดูแลระบบเดิม บัญชีนี้วางแผนแพ็กได้ตามสิทธิ์เดิม",
                          "Promotion rehearsal retains administrator access. Pack planning follows existing permissions.",
                        )}
                      </Alert>
                    )}
                  </>
                )
              )}
              {!canChangeComparison(role) && (
                <Alert tone="muted">
                  {text(
                    "บัญชีนี้อ่านหลักฐานได้ การส่งต่อไปบันทึกร่างใช้สิทธิ์เดิม",
                    "This account can read evidence. Saving planning drafts retains existing permissions.",
                  )}
                </Alert>
              )}
            </>
          )}
          <Alert tone="warn">
            {text(
              "ยังไม่มีต้นทุน กำไร สต็อกพร้อมขายและเงื่อนไขปลายทางที่ยืนยัน การส่งต่อไม่เปิดโปรโมชันหรือเปลี่ยนราคา",
              "Authoritative costs, profit, ATP and destination terms remain missing. Handoff does not activate promotions or change prices.",
            )}
          </Alert>
        </>
      ) : null}
    </CommercePage>
  );
}

function HistoricalObservation({
  snapshot,
}: {
  snapshot: Record<string, unknown> | null;
}) {
  if (!snapshot)
    return (
      <p>
        {text(
          "ไม่มีสถานะหลังรายการนี้ คู่สินค้าอาจถูกเลิกใช้",
          "No resulting pair state; this pair may have been removed.",
        )}
      </p>
    );
  const raw = snapshot.observation as Record<string, unknown> | undefined;
  return (
    <div className="space-y-1">
      <p>
        {String(raw?.price ?? snapshot.priceIncVat ?? "—")}{" "}
        {String(
          raw?.currency ??
            text("สกุลเงินประวัติไม่ยืนยัน", "Historical currency unverified"),
        )}{" "}
        ·{" "}
        {raw
          ? choiceText(String(raw.taxBasis))
          : text(
              "ฐาน VAT ประวัติไม่ยืนยัน",
              "Historical VAT basis unverified",
            )}{" "}
        ·{" "}
        {raw
          ? choiceText(String(raw.priceBasis))
          : text(
              "ฐานสาธารณะ/สมาชิกไม่ยืนยัน",
              "Historical public/member basis unverified",
            )}
      </p>
      <PackSummary pack={raw?.pack} />
      <p>{comparisonDate(raw?.observedAt ?? snapshot.observedAt)}</p>
      <p>{String(raw?.context ?? snapshot.sourceContext ?? "")}</p>
    </div>
  );
}
function CollectedProduct({ id, role }: { id: string; role: string }) {
  const [sku, setSku] = useState(""),
    navigate = useNavigate();
  const source = useAsync(async () => {
    const raw = await api.get<{
      message: string;
      data: {
        catalogItem: { id: string; name: string };
        suggestions: { sku: string; name: string; similarityPercent: number }[];
      };
    }>(`/competitor-prices/suggestions/${id}`);
    if (raw.message) throw Error(raw.message);
    if (raw.data?.catalogItem.id !== id)
      throw Error("Collected identity mismatch");
    return raw.data;
  }, [id]);
  return (
    <CommercePage>
      <WorkspaceLink to={home}>
        {text("กลับไปเทียบราคา", "Back to comparison")}
      </WorkspaceLink>
      <PageHeader
        title={text(
          "เลือกสินค้าเราให้สินค้าที่รวบรวม",
          "Choose our product for a collected item",
        )}
      />
      <ErrorText error={source.error} onRetry={source.reload} />
      {source.loading ? (
        <Loading variant="detail" />
      ) : source.data && !source.error ? (
        <>
          <p>{source.data.catalogItem.name}</p>
          <Alert tone="warn">
            {text(
              "ความคล้ายชื่อเป็นเพียงคำแนะนำ ยังไม่ตรวจยืนยันคู่สินค้า",
              "Name similarity is a suggestion, without match verification.",
            )}
          </Alert>
          {source.data.suggestions.map((s) => (
            <WorkspaceLink
              key={s.sku}
              to={
                canPerformComparison(role, "create")
                  ? `${productUrl(s.sku)}/match/new?item=${id}`
                  : productUrl(s.sku)
              }
            >
              {s.name} · {s.sku} · {s.similarityPercent}%
            </WorkspaceLink>
          ))}
          {canPerformComparison(role, "create") && (
            <form
              className="flex flex-wrap gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (sku.trim())
                  navigate(`${productUrl(sku.trim())}/match/new?item=${id}`);
              }}
            >
              <TaskInput
                label={text("รหัสสินค้าของเรา", "Our product SKU")}
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
              <Button type="submit" disabled={!sku.trim()}>
                {text("เลือกสินค้านี้", "Choose this product")}
              </Button>
            </form>
          )}
        </>
      ) : null}
    </CommercePage>
  );
}
type Position = "we_pricier" | "we_cheaper" | "same" | "no_data" | "unmatched";
type Overview = {
  rows: {
    sku: string;
    name: string;
    category: string;
    ourPricePerKgIncVat: number | null;
    cheapest: {
      sourceName: string;
      sourceUrl: string;
      pricePerKgIncVat: number;
      observedAt: string | null;
    } | null;
    differencePercent: number | null;
    position: Position;
    readyPairs: number;
  }[];
  total: number;
  pageSize: number;
  categories: string[];
  sites: string[];
  totals: Record<
    "weCheaper" | "wePricier" | "same" | "noData" | "unmatched",
    number
  >;
};
// [position URL value, tone, totals key, Thai, English]
const POSITIONS = [
  ["we_pricier", "danger", "wePricier", "เราแพงกว่า", "We cost more"],
  ["we_cheaper", "ok", "weCheaper", "เราถูกกว่า", "We cost less"],
  ["same", "muted", "same", "ราคาเท่ากัน", "Same price"],
  ["no_data", "warn", "noData", "ยังเทียบไม่ได้", "Not comparable yet"],
  ["unmatched", "muted", "unmatched", "ยังไม่จับคู่", "Not matched yet"],
] as const;
function Difference({ row }: { row: Overview["rows"][number] }) {
  const pct = `${Math.abs(row.differencePercent ?? 0)}%`;
  if (row.position === "we_pricier")
    return <Chip tone="danger">{text(`แพงกว่า ${pct}`, `${pct} dearer`)}</Chip>;
  if (row.position === "we_cheaper")
    return <Chip tone="ok">{text(`ถูกกว่า ${pct}`, `${pct} cheaper`)}</Chip>;
  if (row.position === "same")
    return <Chip tone="muted">{text("เท่ากัน", "Same")}</Chip>;
  if (row.position === "no_data")
    return <Chip tone="warn">{text("ยังเทียบไม่ได้", "Not comparable yet")}</Chip>;
  return <Chip tone="muted">{text("ยังไม่จับคู่", "Not matched yet")}</Chip>;
}
/** Work through matching category by category; "reviewed" is the team's own marker, not a verified-pair count. */
function MatchingQueue() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "",
    page = Math.max(1, Number(params.get("page")) || 1),
    show = params.get("show") === "done" ? "done" : "todo";
  const queue = useAsync(async () => {
    const raw = await api.get<{
      data: {
        rows: { sku: string; name: string }[];
        categories: { name: string; total: number; reviewed: number }[];
        total: number;
        counts: { total: number; reviewed: number };
      };
      message: string;
    }>(
      `/competitor-prices/review?category=${encodeURIComponent(category)}&page=${page}&show=${show}`,
    );
    if (raw.message) throw Error(raw.message);
    if (!raw.data || !Array.isArray(raw.data.rows))
      throw Error("Invalid matching queue");
    return raw.data;
  }, [category, page, show]);
  const set = (next: Record<string, string>) =>
    setParams({ category, show, page: "1", ...next });
  const current =
    queue.data?.categories.some((c) => c.name === category)
      ? category
      : (queue.data?.categories[0]?.name ?? "");
  return (
    <CommercePage>
      <PageHeader
        back={{ to: home, label: text("เทียบราคาคู่แข่ง", "Competitor prices") }}
        title={text("ไล่จับคู่ตามหมวด", "Match by category")}
        subtitle={text(
          "เลือกหมวด แล้วเปิดสินค้าทีละตัวเพื่อจับคู่กับสินค้าของร้านอื่น",
          "Pick a category, then open products one by one to match them with other stores' products.",
        )}
      />
      <ErrorText error={queue.error} onRetry={queue.reload} />
      {queue.loading && !queue.data ? (
        <Loading variant="table" />
      ) : queue.data && !queue.error ? (
        <>
          <FilterBar>
            <TaskSelect
              label={text("หมวดสินค้า", "Product category")}
              value={current}
              onChange={(e) => set({ category: e.target.value })}
            >
              {queue.data.categories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({fmt.num(c.reviewed)}/{fmt.num(c.total)})
                </option>
              ))}
            </TaskSelect>
            <TaskSelect
              label={text("แสดง", "Show")}
              value={show}
              onChange={(e) => set({ show: e.target.value })}
            >
              <option value="todo">{text("ยังไม่ได้ตรวจ", "Not checked yet")}</option>
              <option value="done">{text("ตรวจแล้ว", "Checked")}</option>
            </TaskSelect>
            <p role="status" className="text-sm text-on-surface-variant">
              {text("ตรวจแล้ว", "Checked")} {fmt.num(queue.data.counts.reviewed)} /{" "}
              {fmt.num(queue.data.counts.total)}
            </p>
          </FilterBar>
          <Panel>
            {!queue.data.rows.length ? (
              <TableEmpty title={text("ไม่มีสินค้าในหมวดนี้", "No products in this category")}>
                {text("เลือกหมวดอื่น หรือดูรายการที่ตรวจแล้ว", "Pick another category or show checked products.")}
              </TableEmpty>
            ) : (
            <TableViewport>
              <Table>
                <THead>
                  <TH>{text("สินค้า", "Product")}</TH>
                  <TH />
                </THead>
                <TBody>
                  {queue.data.rows.map((r) => (
                      <TR key={r.sku}>
                        <TD>
                          <span className="block font-medium">{r.name}</span>
                          <span className="font-mono text-xs text-on-surface-variant">{r.sku}</span>
                        </TD>
                        <TD kind="actions">
                          <ButtonLink to={`${productUrl(r.sku)}/match`}>
                            {text("จับคู่", "Match")}
                          </ButtonLink>
                        </TD>
                      </TR>
                  ))}
                </TBody>
              </Table>
            </TableViewport>
            )}
          </Panel>
          <div className="flex items-center gap-3">
            <Button disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
              {text("ก่อนหน้า", "Previous")}
            </Button>
            <Button
              disabled={page * 20 >= queue.data.total}
              onClick={() => set({ page: String(page + 1) })}
            >
              {text("ถัดไป", "Next")}
            </Button>
          </div>
        </>
      ) : null}
    </CommercePage>
  );
}

function ProductIndex({ owner, role }: { owner: string; role: string }) {
  const [params, setParams] = useSearchParams(),
    [query, setQuery] = useState(params.get("search") ?? ""),
    [downloading, setDownloading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const page = Math.max(1, Math.min(1000, Number(params.get("page")) || 1));
  const filters = new URLSearchParams({
    search: params.get("search") ?? "",
    page: String(page),
    position: params.get("position") ?? "all",
    category: params.get("category") ?? "",
    site: params.get("site") ?? "",
  });
  const source = useAsync(async () => {
    const requestFilters = new URLSearchParams(filters);
    if (requestFilters.get("position") === "all")
      requestFilters.delete("position");
    const raw = await api.get<{ message: string; data: Overview }>(
      `/competitor-prices/overview?${requestFilters}`,
    );
    if (raw.message) throw Error(raw.message);
    if (!Array.isArray(raw.data?.rows)) throw Error("Invalid product index");
    return raw.data;
  }, [filters.toString()]);
  // Keep tiles and filter options on screen while the next page loads.
  const last = useRef<Overview | null>(null);
  if (source.data) last.current = source.data;
  const shown = source.data ?? last.current;
  async function download() {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const requestFilters = new URLSearchParams(filters);
      if (requestFilters.get("position") === "all")
        requestFilters.delete("position");
      const result = await authedFetch(
        `/competitor-prices/overview/export?${requestFilters}`,
      );
      if (!result.ok)
        throw Error(text("ส่งออกรายงานไม่สำเร็จ", "Report export failed."));
      const url = URL.createObjectURL(await result.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "competitor-prices.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(message(e));
    } finally {
      setDownloading(false);
    }
  }
  function change(key: string, value: string) {
    setParams({ ...Object.fromEntries(filters), [key]: value, page: "1" });
  }
  const position = filters.get("position")!;
  const pages = source.data
    ? Math.max(1, Math.ceil(source.data.total / source.data.pageSize))
    : 1;
  return (
    <CommercePage>
      <PageHeader
        title={text("เทียบราคาคู่แข่ง", "Competitor prices")}
        subtitle={text(
          "ราคาต่อกิโลกรัมของเรา เทียบกับร้านที่ถูกที่สุด รวม VAT",
          "Our price per kilogram against the cheapest store, VAT included.",
        )}
        actions={
          <>
            <Button disabled={downloading} onClick={download}>
              {text("ส่งออก Excel", "Export Excel")}
            </Button>
            <ButtonLink to={`${home}/matching`}>
              {text("ไล่จับคู่ตามหมวด", "Match by category")}
            </ButtonLink>
            <ButtonLink to={`${home}/sources`}>
              {text("แหล่งราคา", "Price sources")}
            </ButtonLink>
          </>
        }
      />
      <Pending owner={owner} />
      {shown && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {POSITIONS.map(([value, tone, key, th, en]) => (
            <StatTile
              key={value}
              label={text(th, en)}
              value={fmt.num(shown.totals[key])}
              tone={tone}
              selected={position === value}
              onClick={() =>
                change("position", position === value ? "all" : value)
              }
            />
          ))}
        </div>
      )}
      <Panel>
        <FilterBar>
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              change("search", query.trim());
            }}
          >
            <TaskInput
              type="search"
              label={text("ค้นหาชื่อหรือรหัสสินค้า", "Search name or product code")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
          <TaskSelect
            label={text("หมวดสินค้า", "Category")}
            value={filters.get("category")!}
            onChange={(e) => change("category", e.target.value)}
          >
            <option value="">{text("ทุกหมวด", "All categories")}</option>
            {shown?.categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </TaskSelect>
          <TaskSelect
            label={text("ร้าน", "Store")}
            value={filters.get("site")!}
            onChange={(e) => change("site", e.target.value)}
          >
            <option value="">{text("ทุกร้าน", "All stores")}</option>
            {shown?.sites.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </TaskSelect>
        </FilterBar>
        <ErrorText error={source.error || error} onRetry={source.reload} />
        {source.loading ? (
          <Loading variant="table" />
        ) : source.data && !source.error ? (
          !source.data.rows.length ? (
            <TableEmpty title={text("ไม่พบสินค้า", "No products found")}>
              {text(
                "ลองค้นด้วยคำอื่น หรือเลือก “ทุกหมวด” และ “ทุกร้าน”",
                "Try another search, or choose all categories and all stores.",
              )}
            </TableEmpty>
          ) : (
            <>
              <Table>
                <THead>
                  <TH>{text("สินค้า", "Product")}</TH>
                  <TH right>{text("ราคาเรา/กก.", "Our price/kg")}</TH>
                  <TH>{text("ร้านที่ถูกที่สุด", "Cheapest store")}</TH>
                  <TH>{text("ส่วนต่าง", "Difference")}</TH>
                  <TH right>{text("ร้านที่เทียบแล้ว", "Stores compared")}</TH>
                  <TH kind="actions">
                    <span className="sr-only">{text("เปิด", "Open")}</span>
                  </TH>
                </THead>
                <TBody>
                  {source.data.rows.map((r) => (
                    <TR key={r.sku}>
                      <TD>
                        <div className="font-medium">{r.name}</div>
                        <div className="font-mono text-[11px] text-on-surface-variant">
                          {r.sku}
                        </div>
                        {r.category && (
                          <div className="text-[11px] text-on-surface-variant">
                            {r.category}
                          </div>
                        )}
                      </TD>
                      <TD kind="money">{fmt.baht(r.ourPricePerKgIncVat)}</TD>
                      <TD>
                        {r.cheapest ? (
                          <>
                            <a
                              href={r.cheapest.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-primary hover:underline"
                            >
                              {r.cheapest.sourceName}
                            </a>
                            <div className="font-mono tabular-nums">
                              {fmt.baht(r.cheapest.pricePerKgIncVat)}
                              {text("/กก.", "/kg")}
                            </div>
                            <div className="text-[11px] text-on-surface-variant">
                              {fmt.date(r.cheapest.observedAt)}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD>
                        <Difference row={r} />
                      </TD>
                      <TD kind="num">{fmt.num(r.readyPairs)}</TD>
                      <TD kind="actions">
                        {r.position === "unmatched" ? (
                          <ButtonLink to={`${productUrl(r.sku)}/match`}>
                            {text("จับคู่", "Match")}
                          </ButtonLink>
                        ) : (
                          <ButtonLink to={productUrl(r.sku)}>
                            {text("เปิด", "Open")}
                          </ButtonLink>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="flex flex-wrap items-center justify-end gap-3 p-4">
                <Button
                  disabled={page <= 1}
                  onClick={() =>
                    setParams({
                      ...Object.fromEntries(filters),
                      page: String(page - 1),
                    })
                  }
                >
                  {text("ก่อนหน้า", "Previous")}
                </Button>
                <span className="text-sm tabular-nums">
                  {text(`หน้า ${page} จาก ${pages}`, `Page ${page} of ${pages}`)}
                </span>
                <Button
                  disabled={page >= pages}
                  onClick={() =>
                    setParams({
                      ...Object.fromEntries(filters),
                      page: String(page + 1),
                    })
                  }
                >
                  {text("ถัดไป", "Next")}
                </Button>
              </div>
            </>
          )
        ) : null}
      </Panel>
      {!canPerformComparison(role, "capture") && (
        <Alert tone="muted">
          {text(
            "บัญชีนี้อ่านอย่างเดียว",
            "This account retains read-only access.",
          )}
        </Alert>
      )}
      {role === "merchandising" && <MerComparisonAccess />}
    </CommercePage>
  );
}
