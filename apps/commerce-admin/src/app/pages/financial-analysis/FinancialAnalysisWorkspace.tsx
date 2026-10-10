import { useState, useEffect } from "react";
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
  Table,
  THead,
  TBody,
  TH,
  TD,
  TR,
  useUiLocale,
} from "@cp/ui";
import {
  FINANCE_API as endpoint,
  FINANCE_HOME as home,
  defaultFinanceQuery,
  financeDetailSchema,
  financePeriodError,
  financeQuerySchema,
  financeResponseSchema,
  financeRoles,
  financeSearch,
  fields,
  monthWindow,
  month as monthSchema,
  uuid,
  type FinanceField,
  type FinanceQuery,
  type FinanceResponse,
  type FinancePeriod,
} from "../../../../../commerce-platform/src/modules/integration/financial-analysis/financial-analysis";
import { goalDraftPageSchema } from "../../../../../commerce-platform/src/modules/integration/financial-goals/financial-goals";
import { api, session } from "../../../lib/api";
import { normalizeRole } from "../../../lib/role-home";
import { CommercePage } from "../../CommercePage";
import { commerceText as text } from "../../commerce-copy";
import { useAsync } from "../../hooks";
import { WorkspaceLink } from "../../WorkspaceParts";
import { PlanningError } from "../planning/PlanningError";
import { friendlyError } from "../planning/promotion-contracts";
import { dateText } from "../pack-price/pack-copy";
import { goalLabel } from "../financial-goals/GoalEvidence";
const fieldLabel = (f: FinanceField) =>
  text(
    ...(
      {
        total_price: [
          "ยอดรวมออเดอร์ที่บันทึก รวม VAT หลังส่วนลด ก่อนคืนเงิน",
          "Recorded order total incl. VAT, after discounts, before refunds",
        ],
        subtotal_ex_vat: [
          "Subtotal ไม่รวม VAT ที่ต้นทางบันทึก",
          "Source-recorded subtotal ex VAT",
        ],
        vat_amount: ["VAT ที่ต้นทางบันทึก", "Source-recorded VAT"],
        discount_inc_vat: [
          "ส่วนลดรวม VAT ที่ต้นทางบันทึก",
          "Source-recorded discount incl. VAT",
        ],
        delivery_fee: [
          "ค่าจัดส่งที่ต้นทางบันทึก",
          "Source-recorded delivery fee",
        ],
      } as Record<FinanceField, [string, string]>
    )[f],
  );
const unavailable = () =>
  text("ยังไม่ยืนยัน / ไม่มีข้อมูล", "Unavailable / unverified");
const reasonLabel = (reason: string | null) =>
  reason
    ? text(
        ...((
          {
            incompatible_timezone: [
              "เขตเวลาของสองช่วงไม่ตรงกัน",
              "Incompatible timezones",
            ],
            different_sources: [
              "สองช่วงมาจากคนละแหล่ง",
              "Different source systems",
            ],
            incompatible_currency: [
              "สกุลเงินไม่ตรงกัน ต้องมีสัญญา FX ก่อนเทียบ",
              "Incompatible currencies; an FX contract is required",
            ],
            currency_unverified: [
              "ยังไม่ยืนยันสกุลเงินตามสัญญารายงาน",
              "Currency contract unverified",
            ],
            incompatible_uom: [
              "หน่วยและฐานยอดไม่ตรงกัน",
              "Incompatible unit or amount basis",
            ],
            same_period: ["เลือกเดือนเดียวกัน", "Same calendar month"],
            missing_field_coverage: [
              "ค่าฟิลด์ไม่ครบทุกออเดอร์ที่อ่านพบ",
              "Field values missing from returned eligible orders",
            ],
            non_positive_previous: [
              "ฐานช่วงอ้างอิงเป็นศูนย์หรือติดลบ จึงไม่คำนวณเปอร์เซ็นต์",
              "Reference total is zero or negative; percentage unavailable",
            ],
          } as Record<string, [string, string]>
        )[reason] ?? ["ยังไม่ยืนยัน", "Unverified"]),
      )
    : text(
        "เทียบยอดที่บันทึกในแหล่งเดียวกัน",
        "Recorded source totals compared",
      );
async function readable<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    throw Error(friendlyError(e));
  }
}
function verifiedResponse(raw: unknown, query: FinanceQuery): FinanceResponse {
  const value = financeResponseSchema.parse(raw) as FinanceResponse;
  if (financeSearch(value.query) !== financeSearch(query))
    throw Error("Financial response identity mismatch");
  return value;
}
function queryFrom(params: URLSearchParams) {
  const entries = [...params.entries()];
  if (new Set(entries.map(([k]) => k)).size !== entries.length) return null;
  const p = financeQuerySchema.safeParse(Object.fromEntries(entries));
  return p.success && !financePeriodError(p.data) ? p.data : null;
}
const route = (action: string, q: FinanceQuery) =>
  home + "/" + action + financeSearch(q);
export default function FinancialAnalysisWorkspace({
  role = session.claims()?.role,
}: {
  role?: string;
}) {
  useUiLocale();
  const normalized = normalizeRole(role),
    location = useLocation(),
    [params] = useSearchParams(),
    query = queryFrom(params),
    suffix = location.pathname.slice(home.length).replace(/\/$/, "");
  if (!financeRoles.includes(normalized))
    return (
      <CommercePage>
        <Alert tone="danger">
          {text(
            "บัญชีนี้ไม่มีสิทธิ์อ่านรายงานการเงินของทีมเดิม",
            "This account cannot read the existing team financial reports.",
          )}
        </Alert>
      </CommercePage>
    );
  if (!suffix)
    return (
      <Navigate to={route("period", query ?? defaultFinanceQuery())} replace />
    );
  if (suffix === "/period")
    return (
      <PeriodPicker
        key={location.search}
        query={query}
        invalid={params.size > 0 && !query}
      />
    );
  if (!query)
    return (
      <CommercePage>
        <Alert tone="danger">
          {text(
            "ช่วงเดือนหรือเขตเวลาในลิงก์ไม่ถูกต้อง เลือกใหม่ก่อนอ่าน",
            "Invalid calendar months or timezone. Choose periods before reading.",
          )}
        </Alert>
        <WorkspaceLink to={route("period", defaultFinanceQuery())}>
          {text("เลือกช่วงที่จะทบทวน", "Choose review periods")}
        </WorkspaceLink>
      </CommercePage>
    );
  if (suffix === "/coverage" || suffix === "/variance")
    return (
      <Analysis
        key={normalized}
        query={query}
        action={suffix.slice(1) as "coverage" | "variance"}
      />
    );
  const order = suffix.match(/^\/months\/([^/]+)\/orders\/([^/]+)$/),
    refund = suffix.match(/^\/months\/([^/]+)\/refunds\/([^/]+)\/([^/]+)$/);
  const validMonth = (m: string) =>
    monthSchema.safeParse(m).success &&
    [query.month, query.compare].includes(m);
  if (order && validMonth(order[1]) && uuid.safeParse(order[2]).success)
    return (
      <Detail
        query={query}
        recordMonth={order[1]}
        kind="orders"
        id={uuid.parse(order[2])}
      />
    );
  if (
    refund &&
    validMonth(refund[1]) &&
    uuid.safeParse(refund[2]).success &&
    uuid.safeParse(refund[3]).success
  )
    return (
      <Detail
        query={query}
        recordMonth={refund[1]}
        kind="refunds"
        orderId={uuid.parse(refund[2])}
        id={uuid.parse(refund[3])}
      />
    );
  return (
    <CommercePage>
      <Alert tone="danger">
        {text("ลิงก์หลักฐานไม่ถูกต้อง", "Invalid financial evidence link.")}
      </Alert>
      <WorkspaceLink to={route("coverage", query)}>
        {text("กลับไปตรวจความครบถ้วน", "Back to source coverage")}
      </WorkspaceLink>
    </CommercePage>
  );
}
function Steps({ query, action }: { query: FinanceQuery; action: string }) {
  return (
    <nav
      aria-label={text("ขั้นตอนทบทวนข้อมูลการเงิน", "Financial review steps")}
      className="grid gap-2 sm:grid-cols-3"
    >
      {(["period", "coverage", "variance"] as const).map((s, i) => (
        <Link
          key={s}
          to={route(s, query)}
          aria-current={action === s ? "step" : undefined}
          className="rounded-lg border border-secondary-container p-3 min-h-11 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {i + 1}.{" "}
          {text(
            ...(
              {
                period: ["เลือกเดือนและฐานเวลา", "Choose months and timezone"],
                coverage: [
                  "ตรวจข้อมูลและหลักฐาน",
                  "Review coverage and evidence",
                ],
                variance: ["เทียบยอดที่อ่านได้", "Compare recorded totals"],
              } as Record<string, [string, string]>
            )[s],
          )}
        </Link>
      ))}
    </nav>
  );
}
function PeriodPicker({
  query,
  invalid,
}: {
  query: FinanceQuery | null;
  invalid: boolean;
}) {
  const navigate = useNavigate(),
    [form, setForm] = useState<FinanceQuery>(query ?? defaultFinanceQuery()),
    [error, setError] = useState(false);
  const goals = useAsync(
    () =>
      readable(async () =>
        goalDraftPageSchema.parse(
          await api.get("/reports/financial-goals/drafts"),
        ),
      ),
    [],
  );
  useEffect(() => {
    if (error)
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [error]);
  function read() {
    const p = financeQuerySchema.safeParse(form);
    if (!p.success || financePeriodError(p.data)) {
      setError(true);
      return;
    }
    navigate(route("coverage", p.data));
  }
  return (
    <CommercePage>
      <PageHeader
        title={text(
          "ตรวจฐานข้อมูลการเงินก่อนเทียบผล",
          "Review financial coverage before comparing",
        )}
        subtitle={text(
          "ใช้ยอดที่ต้นทางบันทึก แยกจากกำไรจริงและผลสำเร็จตามเป้า",
          "Inspect recorded source amounts separately from actual profit and target attainment.",
        )}
      />
      <Steps query={query ?? defaultFinanceQuery()} action="period" />
      {invalid && (
        <Alert tone="warn">
          {text(
            "ลิงก์เดิมไม่ถูกต้อง เลือกช่วงใหม่ก่อนทำต่อ",
            "The original link is invalid. Choose new periods to continue.",
          )}
        </Alert>
      )}
      <Panel>
        <PanelHead
          title={text("เลือกช่วงที่จะทบทวน", "Choose review periods")}
        />
        <div className="p-4 grid gap-4 sm:grid-cols-2">
          <TaskInput
            type="month"
            label={text("เดือนที่ทบทวน", "Review month")}
            value={form.month}
            error={
              error
                ? text(
                    "ใช้เดือน 2000–2099 ที่เริ่มแล้ว",
                    "Choose a month from 2000–2099 that has started.",
                  )
                : undefined
            }
            onChange={(e) => {
              setForm((f) => ({ ...f, month: e.target.value }));
              setError(false);
            }}
          />
          <TaskInput
            type="month"
            label={text("เดือนอ้างอิง", "Reference month")}
            value={form.compare}
            error={
              error
                ? text(
                    "เลือกเดือนอื่นที่เริ่มแล้ว",
                    "Choose a different month that has started.",
                  )
                : undefined
            }
            onChange={(e) => {
              setForm((f) => ({ ...f, compare: e.target.value }));
              setError(false);
            }}
          />
          <TaskSelect
            label={text("เขตเวลาของเดือนทั้งสอง", "Timezone for both months")}
            value={form.timezone}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                timezone: e.target.value as FinanceQuery["timezone"],
              }))
            }
          >
            <option value="UTC">
              UTC ·{" "}
              {text(
                "ตรงกับช่วงเดือนของร่างเป้ากำไรเดิม",
                "Matches the existing profit-goal month boundary",
              )}
            </option>
            <option value="Asia/Bangkok">
              Asia/Bangkok ·{" "}
              {text(
                "UTC+7 ตามสัญญารายงานเดิม",
                "UTC+7 under the existing report contract",
              )}
            </option>
          </TaskSelect>
          <TaskSelect
            label={text(
              "ร่างเป้าส่วนตัวที่ต้องการดูประกอบ (เลือกกรอก)",
              "My private goal draft for context (optional)",
            )}
            value={form.goalId ?? ""}
            onChange={(e) =>
              setForm(({ goalId, ...f }) =>
                e.target.value ? { ...f, goalId: e.target.value } : f,
              )
            }
          >
            <option value="">
              {text("ยังไม่เลือกร่างเป้า", "No goal draft selected")}
            </option>
            {form.goalId &&
              !goals.data?.items.some((g) => g.id === form.goalId) && (
                <option value={form.goalId}>{form.goalId}</option>
              )}
            {goals.data?.items.map((g) => (
              <option key={g.id} value={g.id}>
                {g.scenario.name} · {g.scenario.period}
              </option>
            ))}
          </TaskSelect>
        </div>
      </Panel>
      <PlanningError error={goals.error} onRetry={goals.reload} />
      {goals.loading && <Loading variant="table" />}
      {goals.data && !goals.error && !goals.data.items.length && (
        <Empty>
          {text(
            "ยังไม่มีร่างเป้าส่วนตัวในหน้าที่อ่านได้ เป้าของผู้อื่นไม่ได้แสดงในหน้านี้",
            "No private goal drafts returned. Other owners’ goals are not shared here.",
          )}
        </Empty>
      )}
      {goals.data?.next && (
        <Alert tone="muted">
          {text(
            "มีร่างส่วนตัวหน้าถัดไป เปิดหน้าร่างเป้าเพื่ออ่านเพิ่มเติม",
            "More private goals exist. Open goal drafts to inspect them.",
          )}
        </Alert>
      )}
      <Alert tone="muted">
        {text(
          "เลือกเต็มเดือนตามปฏิทิน เดือนอาจมีจำนวนวันต่างกัน เวลาสิ้นสุดเป็นขอบเขตที่ไม่รวมข้อมูล ณ เวลานั้น",
          "These are full calendar months, which may have different day counts. The end boundary is exclusive.",
        )}
      </Alert>
      <div className="flex gap-3 flex-wrap">
        <Button onClick={read}>
          {text(
            "อ่านช่วงที่เลือกและตรวจความครบถ้วน",
            "Read selected periods and review coverage",
          )}
        </Button>
        <WorkspaceLink to="/planning/profit-goals">
          {text(
            "ทบทวนร่างเป้ากำไรและต้นทุนเดิม",
            "Review existing profit and cost goal drafts",
          )}
        </WorkspaceLink>
      </div>
    </CommercePage>
  );
}
function PeriodHeader({ period: p }: { period: FinancePeriod }) {
  return (
    <div className="space-y-2">
      <Chip tone="warn">
        {p.coverage === "unavailable"
          ? text("ยังอ่านต้นทางไม่ได้", "Source unavailable")
          : text(
              "อ่านได้บางส่วน ความครบถ้วนต้นทางยังไม่ยืนยัน",
              "Partial read; upstream completeness unverified",
            )}
      </Chip>
      <p>
        {p.window.month} · {p.window.timezone} · {p.window.days}{" "}
        {text("วันตามปฏิทิน", "calendar days")}
      </p>
      <p className="break-words">
        [{p.window.from}, {p.window.to})
      </p>
      <p>
        {text("อ่านเมื่อ", "Read at")}: {dateText(p.capturedAt)} · {p.source}
      </p>
      {Date.parse(p.window.to) > Date.parse(p.capturedAt) && (
        <Alert tone="warn">
          {text(
            "เดือนนี้ยังไม่ปิด ยอดที่อ่านได้ไม่ใช่ยอดครบเดือน",
            "This month is still open. These are not complete month-end amounts.",
          )}
        </Alert>
      )}
    </div>
  );
}
function Gaps() {
  return (
    <Panel>
      <PanelHead
        title={text(
          "สิ่งที่ต้องมี ก่อนใช้เป็นผลการเงินจริง",
          "Required contracts for actual financial results",
        )}
      />
      <div className="p-4 space-y-3">
        <ul className="list-disc pl-5 space-y-3">
          <li>
            {text(
              "ยอดขายสุทธิไม่รวม VAT: ต้องยืนยันการจัดสรรส่วนลด VAT/ค่าจัดส่ง เครดิตและคืนสินค้าที่ผูกกับออเดอร์ และช่วงรับรู้รายได้ที่ครบถ้วน Subtotal เดิมยังใช้แทนไม่ได้",
              "Net sales ex VAT needs reconciled discount/tax/delivery allocation, linked returns and credits, and complete recognition periods. The recorded subtotal cannot substitute for it.",
            )}
          </li>
          <li>
            {text(
              "COGS: ต้องมีต้นทุนของรายการจริงที่มีผลตามวันที่ หน่วยขาย/แปลงหน่วย สกุลเงินและฐาน VAT รวมการกลับรายการคืนสินค้า buying_price ในแค็ตตาล็อกยังไม่ใช่ต้นทุนจริงของออเดอร์",
              "COGS needs effective order-line cost, selling-unit conversion, currency/VAT basis and return reversals. Catalog buying_price is not actual order COGS.",
            )}
          </li>
          <li>
            {text(
              "ค่าใช้จ่าย: ต้องมีต้นทุนดำเนินงาน ค่าธรรมเนียมและการจัดสรรในเดือนเดียวกัน",
              "Expenses need operating costs, fees and allocation on the same monthly basis.",
            )}
          </li>
          <li>
            {text(
              "ยอดรวมเดิมระบุ THB รวม VAT หลังส่วนลด ส่วนลดจึงไม่ถูกหักซ้ำ ยังไม่มีสกุลเงินต่อแถวหรือ FX/UOM สำหรับรวมข้ามฐาน และไม่ใช้ VAT คงที่ 7% แปลงทุกยอด",
              "The native report declares THB incl. VAT after discounts. Discounts are not subtracted again. Per-record currency and cross-basis FX/UOM contracts are absent; a fixed 7% divisor is not used.",
            )}
          </li>
          <li>
            {text(
              "การคืนเงินใช้วันที่สร้างบันทึกคืนเงิน ไม่ใช่เดือนของออเดอร์หรือวันรับรู้ทางบัญชี จำนวนคืนสินค้าหรือเครดิตทั้งหมดและ VAT ยังไม่ยืนยัน จึงไม่หักยอดนี้ออกจากยอดออเดอร์",
              "Refunds use refund-record creation time, separate from the order month or accounting recognition. Complete returns/credits and tax allocation are unverified, so these amounts are not subtracted from order totals.",
            )}
          </li>
          <li>
            {text(
              "ความครบถ้วน/สดใหม่: ต้องมี watermark/backfill ของออเดอร์และ refunds[] รวมสัญญาการปิดเดือน เวลาอ่านและ copied_at ล่าสุดไม่พิสูจน์ข้อมูลครบหรือ replication lag",
              "Completeness/freshness needs order/refund backfill watermarks and a month-close contract. Read time and latest copied_at do not prove completeness or replication lag.",
            )}
          </li>
        </ul>
        <Alert tone="muted">
          {text(
            "กำไรจริง Margin, ROAS ผลต่างจากเป้าจริง และ %สำเร็จตามเป้า: ยังไม่คำนวณ ไม่มีคำอธิบายเชิงเหตุและผล",
            "Actual profit, margin, ROAS, goal variance and attainment remain unavailable. No causal explanation is inferred.",
          )}
        </Alert>
      </div>
    </Panel>
  );
}
function Analysis({
  query: q,
  action,
}: {
  query: FinanceQuery;
  action: "coverage" | "variance";
}) {
  const key = financeSearch(q),
    read = useAsync(
      () =>
        readable(async () =>
          verifiedResponse(await api.get(endpoint + key), q),
        ),
      [key],
    ),
    v = read.data;
  return (
    <CommercePage>
      <PageHeader
        title={text(
          action === "coverage"
            ? "ตรวจความครบถ้วนของข้อมูลการเงิน"
            : "เทียบยอดการเงินที่บันทึกไว้",
          action === "coverage"
            ? "Review financial source coverage"
            : "Compare recorded financial amounts",
        )}
        actions={
          <Button onClick={read.reload}>
            {text("อ่านหลักฐานใหม่", "Refresh financial evidence")}
          </Button>
        }
      />
      <Steps query={q} action={action} />
      <PlanningError error={read.error} onRetry={read.reload} />
      {read.loading ? (
        <Loading variant="detail" />
      ) : (
        v &&
        !read.error && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              {[v.current, v.previous].map((p) => (
                <Panel key={p.window.month}>
                  <div className="p-4">
                    <PeriodHeader period={p} />
                  </div>
                </Panel>
              ))}
            </div>
            {v.current.coverage === "unavailable" ||
            v.previous.coverage === "unavailable" ? (
              <Alert tone="danger">
                {text(
                  "บางช่วงยังไม่มีผลอ่านที่ยืนยันได้ กดอ่านใหม่ได้ ยังไม่แสดงว่าไม่มีธุรกรรม",
                  "Some periods have no verified source read. Refresh to retry; this does not establish zero business activity.",
                )}
              </Alert>
            ) : null}
            {action === "coverage" ? (
              <>
                <Coverage period={v.current} query={q} />
                <Coverage period={v.previous} query={q} />
              </>
            ) : (
              <>
                <Alert tone="muted">
                  {text(
                    "ผลต่างนี้เปรียบเทียบยอดที่บันทึกไว้เท่านั้น ไม่ใช่กำไร ผลสำเร็จตามเป้า หรือเหตุของการเปลี่ยนแปลง",
                    "Differences compare recorded source amounts only; they are not profit, target attainment or causes of change.",
                  )}
                </Alert>
                {v.variance.unequalCalendarDays && (
                  <Alert tone="warn">
                    {text(
                      "จำนวนวันของสองเดือนต่างกัน เปรียบเทียบยอดเต็มเดือน ไม่ใช่อัตราต่อวัน",
                      "Calendar day counts differ. These are monthly totals, not daily rates.",
                    )}
                  </Alert>
                )}
                <Panel>
                  <Table>
                    <THead>
                      <TH>{text("ฟิลด์ที่บันทึก", "Recorded field")}</TH>
                      <TH>{q.month}</TH>
                      <TH>{q.compare}</TH>
                      <TH>
                        {text(
                          "ผลต่าง THB ตามสัญญารายงาน",
                          "Difference in source-declared THB",
                        )}
                      </TH>
                      <TH>%</TH>
                      <TH>{text("ฐานและข้อจำกัด", "Basis and limits")}</TH>
                    </THead>
                    <TBody>
                      {v.variance.fields.map((x) => (
                        <TR key={x.field}>
                          <TD>{fieldLabel(x.field)}</TD>
                          <TD>{x.current ?? unavailable()}</TD>
                          <TD>{x.previous ?? unavailable()}</TD>
                          <TD>{x.delta ?? unavailable()}</TD>
                          <TD>
                            {x.percent === null
                              ? unavailable()
                              : x.percent + "%"}
                          </TD>
                          <TD>
                            {reasonLabel(x.reason)}
                            {x.percentReason && (
                              <p>{reasonLabel(x.percentReason)}</p>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </Panel>
                <WorkspaceLink to={route("coverage", q)}>
                  {text(
                    "ตรวจแถวที่อ่านได้และเหตุของข้อมูลขาด",
                    "Inspect returned records and coverage reasons",
                  )}
                </WorkspaceLink>
              </>
            )}
            <GoalContext value={v} />
            <Gaps />
          </>
        )
      )}
    </CommercePage>
  );
}
function Coverage({
  period: p,
  query: q,
}: {
  period: FinancePeriod;
  query: FinanceQuery;
}) {
  const orders = p.orders,
    refunds = p.refunds;
  return (
    <>
      <Panel>
        <PanelHead
          title={text(
            "หลักฐานเดือน " + p.window.month,
            "Evidence for " + p.window.month,
          )}
        />
        <div className="p-4 space-y-3">
          {orders ? (
            <>
              <p role="status">
                {text(
                  "ออเดอร์ที่ผ่านสถานะและการชำระตามกฎต้นทาง",
                  "Orders meeting the native status and payment rule",
                )}
                : {orders.paidOrders}
              </p>
              <p>
                {text(
                  "สถานะชำระ/ส่งแล้ว แต่ไม่ผ่านกฎ payment success ที่ไม่ใช่ test",
                  "Settled-status orders excluded by the successful non-test payment rule",
                )}
                : {orders.excludedWithoutPayment}
              </p>
              <p>
                {text(
                  "นับตาม order.create_date ไม่ใช่วันที่รับชำระหรือวันรับรู้รายได้",
                  "Uses order.create_date, not cash-receipt or accounting recognition date.",
                )}
              </p>
              {orders.legacyCopyOrders !== null && (
                <p>
                  {text(
                    "ออเดอร์สำเนาเดิม source_version=0 (ไม่พิสูจน์ backfill ของ refunds)",
                    "Legacy copy orders with source_version=0 (does not establish refund backfill)",
                  )}
                  : {orders.legacyCopyOrders}
                </p>
              )}
              <p>
                {text(
                  "เวลาเขียนสำเนาล่าสุดในกลุ่มที่อ่านได้",
                  "Latest copy write among returned eligible orders",
                )}
                :{" "}
                {orders.latestCopyWriteAt
                  ? dateText(orders.latestCopyWriteAt)
                  : unavailable()}
              </p>
              <Table>
                <THead>
                  <TH>{text("ฟิลด์", "Field")}</TH>
                  <TH>{text("ผลรวมของค่าที่มี", "Sum of known values")}</TH>
                  <TH>
                    {text("แถวที่มีค่า / ขาดค่า", "Known / missing rows")}
                  </TH>
                  <TH>{text("แถวค่าติดลบ", "Negative-value rows")}</TH>
                </THead>
                <TBody>
                  {fields.map((f) => (
                    <TR key={f}>
                      <TD>{fieldLabel(f)}</TD>
                      <TD>
                        {orders.values[f].knownSum ??
                          (orders.paidOrders === 0
                            ? text(
                                "ไม่พบแถวที่เข้าเกณฑ์ในการอ่านนี้",
                                "No eligible rows on this read",
                              )
                            : unavailable())}
                      </TD>
                      <TD>
                        {orders.values[f].knownRows} /{" "}
                        {orders.values[f].missingRows}
                      </TD>
                      <TD>{orders.values[f].negativeRows}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {!orders.items.length ? (
                <Empty>
                  {text(
                    "ไม่พบออเดอร์ที่เข้าเกณฑ์ในข้อมูลที่อ่านได้ ยังไม่พิสูจน์ว่าไม่มีออเดอร์จริงทั้งหมด",
                    "No eligible orders returned. This does not prove complete absence of business orders.",
                  )}
                </Empty>
              ) : (
                <>
                  <p>
                    {text(
                      "หลักฐานตัวอย่างที่อ่านพบ สูงสุด 20 แถว",
                      "Returned evidence sample, up to 20 rows",
                    )}
                    : {orders.items.length}
                    {orders.hasMore
                      ? text(
                          " · มีแถวเพิ่มเติม ตัวอย่างนี้ไม่ใช่ยอดรวมทั้งหมด",
                          " · More eligible rows exist; the sample is not the full total",
                        )
                      : ""}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {orders.items.map((o) => (
                      <WorkspaceLink
                        key={o.id}
                        to={route(
                          "months/" + p.window.month + "/orders/" + o.id,
                          q,
                        )}
                      >
                        {o.number ?? o.id} ·{" "}
                        {o.values.total_price ?? unavailable()} ·{" "}
                        {dateText(o.createdAt)}
                      </WorkspaceLink>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <Alert tone="warn">
              {text(
                "อ่านข้อมูลออเดอร์ไม่ได้ จึงยังไม่ยืนยันยอดหรือจำนวน",
                "Order source unavailable; amounts and counts remain unverified.",
              )}
            </Alert>
          )}
          {refunds ? (
            <>
              <p>
                {text(
                  "บันทึกคืนเงินที่สร้างในเดือนนี้ และสถานะ refunded",
                  "Refund records created in this month with refunded status",
                )}
                : {refunds.records}
              </p>
              <p>
                {text(
                  "ยอดคืนเงินของแถวที่มีค่า (ไม่หักจากยอดออเดอร์)",
                  "Known refund-record amounts (not subtracted from order totals)",
                )}
                :{" "}
                {refunds.knownAmount ??
                  (refunds.records === 0
                    ? text("ไม่พบแถวในการอ่านนี้", "No rows on this read")
                    : unavailable())}
              </p>
              <p>
                {text(
                  "แถวขาดจำนวนเงิน / ค่าติดลบ / ออเดอร์ไม่พบ / ออเดอร์คนละเดือน",
                  "Missing amounts / negative values / unlinked orders / orders outside this month",
                )}
                : {refunds.missingRows} / {refunds.negativeRows} /{" "}
                {refunds.unlinkedOrders} / {refunds.outsideOrderPeriod}
              </p>
              {refunds.items.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {refunds.items.map((r) => (
                    <WorkspaceLink
                      key={r.orderId + ":" + r.id}
                      to={route(
                        "months/" +
                          p.window.month +
                          "/refunds/" +
                          r.orderId +
                          "/" +
                          r.id,
                        q,
                      )}
                    >
                      {text("ตรวจหลักฐานคืนเงิน", "Review refund evidence")} ·{" "}
                      {r.id} · {r.amount ?? unavailable()}
                    </WorkspaceLink>
                  ))}
                </div>
              ) : (
                <Empty>
                  {text(
                    "ไม่พบบันทึกคืนเงินในผลอ่านนี้ ความครบถ้วน refunds[] ยังไม่ยืนยัน",
                    "No refund records returned. Refund-history completeness remains unverified.",
                  )}
                </Empty>
              )}
              {refunds.hasMore && (
                <p>
                  {text(
                    "มีบันทึกคืนเงินเพิ่มเติม ตัวอย่างสูงสุด 20 แถว",
                    "More refund records exist; only up to 20 sample rows are linked.",
                  )}
                </p>
              )}
            </>
          ) : (
            <Alert tone="warn">
              {text(
                "อ่านบันทึกคืนเงินไม่ได้ ไม่แทนที่ด้วยยอดศูนย์",
                "Refund source unavailable; no zero amount is substituted.",
              )}
            </Alert>
          )}
        </div>
      </Panel>
    </>
  );
}
function GoalContext({ value: v }: { value: FinanceResponse }) {
  return (
    <Panel>
      <PanelHead
        title={text(
          "บริบทเป้ากำไรและต้นทุนเดิม",
          "Existing profit and cost goal context",
        )}
      />
      <div className="p-4 space-y-3">
        {v.goalContext && (
          <>
            <p>
              {text(
                "บริบท GMV และเป้า GMV เดิมของเดือน UTC",
                "Existing GMV and GMV target context for the UTC month",
              )}
              : {v.goalContext.period}
            </p>
            <p>
              {text("GMV ที่รายงานเดิมอ่านได้", "GMV from the existing reader")}
              : {v.goalContext.context.gmvIncVat ?? unavailable()} ·{" "}
              {text("เป้า GMV เดิม", "Existing GMV target")}:{" "}
              {v.goalContext.context.monthlyGmvTarget ?? unavailable()}
            </p>
            <p>
              {text("แหล่งบริบทเป้า", "Goal-context source")}:{" "}
              {v.goalContext.source}
            </p>
            <Alert tone="muted">
              {text(
                "GMV เป็นบริบทแยก ไม่ใช้แทนยอดสุทธิ กำไร หรือ actual ของร่างเป้า ไม่หักหรือรวมกับยอดในตารางนี้",
                "GMV stays separate from net sales, profit and a draft goal’s actual. It is not combined with this table.",
              )}
            </Alert>
            {v.query.timezone !== "UTC" && (
              <Alert tone="warn">
                {text(
                  "ช่วงเดือน Bangkok ต่างจากเดือน UTC ของบริบทเป้า จึงไม่เทียบ actual กับเป้า",
                  "Bangkok-month boundaries differ from the goal’s UTC month; actual-to-target comparison is unavailable.",
                )}
              </Alert>
            )}
          </>
        )}
        {v.goalContextIssue && (
          <Alert tone="warn">
            {v.goalContextIssue === "private_goal_unavailable"
              ? text(
                  "ยังอ่านร่างเป้าส่วนตัวที่เลือกไม่ได้ ตรวจสิทธิ์และอ่านใหม่",
                  "The selected private goal is unavailable. Check access and retry.",
                )
              : text(
                  "ยังอ่านบริบทเป้าเดิมไม่ได้ อ่านใหม่ได้",
                  "Existing goal context is unavailable. Refresh to retry.",
                )}
          </Alert>
        )}
        {v.selectedGoal && (
          <>
            <WorkspaceLink
              to={"/planning/profit-goals/drafts/" + v.selectedGoal.id}
            >
              {v.selectedGoal.name}
            </WorkspaceLink>
            <p>
              {goalLabel(v.selectedGoal.metric)} · {v.selectedGoal.period} ·{" "}
              {text("เป้าที่บันทึก", "Recorded target")}:{" "}
              {v.selectedGoal.target} · {text("ฉบับ", "Revision")}{" "}
              {v.selectedGoal.revision}
            </p>
            {!v.selectedGoal.compatiblePeriod && (
              <Alert tone="warn">
                {text(
                  "เดือนหรือฐานเวลาไม่ตรงกับร่างเป้าที่เลือก",
                  "The selected goal uses a different month or time boundary.",
                )}
              </Alert>
            )}
            <p>
              {text(
                "Actual, ผลต่างจากเป้า และ %สำเร็จ: ยังไม่มีฐานการเงินจริงที่ยืนยันได้",
                "Actual, goal variance and attainment: authoritative financial basis unavailable.",
              )}
            </p>
          </>
        )}
        <WorkspaceLink to="/planning/profit-goals">
          {text(
            "ทบทวนร่างเป้ากำไรและต้นทุนเดิม",
            "Review existing profit and cost goal drafts",
          )}
        </WorkspaceLink>
      </div>
    </Panel>
  );
}
function Detail({
  query: q,
  recordMonth,
  kind,
  id,
  orderId,
}: {
  query: FinanceQuery;
  recordMonth: string;
  kind: "orders" | "refunds";
  id: string;
  orderId?: string;
}) {
  const key =
      `${kind}/${kind === "refunds" ? orderId + "/" : ""}${id}?` +
      new URLSearchParams({ month: recordMonth, timezone: q.timezone }),
    read = useAsync(
      () =>
        readable(async () => {
          const d = financeDetailSchema.parse(
            await api.get(endpoint + "/" + key),
          );
          if (
            d.kind !== kind ||
            d.record.id !== id ||
            d.window.month !== recordMonth ||
            d.window.timezone !== q.timezone ||
            (d.kind === "refunds" && d.record.orderId !== orderId)
          )
            throw Error("Financial record identity mismatch");
          return d;
        }),
      [key],
    );
  return (
    <CommercePage>
      <WorkspaceLink to={route("coverage", q)}>
        {text("กลับไปตรวจความครบถ้วน", "Back to source coverage")}
      </WorkspaceLink>
      <PageHeader
        title={text(
          kind === "orders"
            ? "หลักฐานออเดอร์ที่ต้นทางบันทึก"
            : "หลักฐานคืนเงินที่ต้นทางบันทึก",
          kind === "orders"
            ? "Source-recorded order evidence"
            : "Source-recorded refund evidence",
        )}
        actions={
          <Button onClick={read.reload}>
            {text("อ่านหลักฐานใหม่", "Refresh financial evidence")}
          </Button>
        }
      />
      <PlanningError error={read.error} onRetry={read.reload} />
      {read.loading ? (
        <Loading variant="detail" />
      ) : (
        read.data &&
        !read.error && (
          <Panel>
            <div className="p-4 space-y-3 break-words">
              <Chip tone="muted">
                {text(
                  "อ่านหลักฐานล่าสุด ไม่ใช่ผลการเงินจริงที่ครบถ้วน",
                  "Latest source read; financial completeness unverified",
                )}
              </Chip>
              <p>
                {read.data.window.month} · {read.data.window.timezone} · [
                {read.data.window.from}, {read.data.window.to})
              </p>
              <p>
                {text(
                  "เวลาในหลักฐานแสดงเป็น ISO UTC ช่วงเดือนใช้เขตเวลาที่เลือกข้างต้น",
                  "Evidence timestamps use ISO UTC; the calendar month uses the timezone shown above.",
                )}
              </p>
              <p>
                {text("รหัสบันทึก", "Record ID")}: {read.data.record.id}
              </p>
              <p>
                {text("แหล่งและเวลาอ่าน", "Source and read time")}:{" "}
                {read.data.source} · {read.data.capturedAt}
              </p>
              <p>
                {text("วันที่สร้างบันทึก", "Record created at")}:{" "}
                {read.data.record.createdAt}
              </p>
              {read.data.kind === "orders" ? (
                <>
                  <p>
                    {read.data.record.number} · {read.data.record.status}
                  </p>
                  {fields.map((f) => (
                    <p key={f}>
                      {fieldLabel(f)}:{" "}
                      {read.data!.kind === "orders"
                        ? (read.data!.record.values[f] ?? unavailable())
                        : null}
                    </p>
                  ))}
                  <p>
                    {text(
                      "เวลาเขียนสำเนา / version",
                      "Copy write time / version",
                    )}
                    :{" "}
                    {read.data.record.copiedAt
                      ? read.data.record.copiedAt
                      : unavailable()}{" "}
                    / {read.data.record.sourceVersion ?? unavailable()}
                  </p>
                </>
              ) : (
                <>
                  <p>
                    {text("ออเดอร์ที่เชื่อม", "Linked order ID")}:{" "}
                    {read.data.record.orderId}
                  </p>
                  <p>
                    {text("จำนวนเงินที่บันทึก", "Recorded amount")}:{" "}
                    {read.data.record.amount ?? unavailable()}
                  </p>
                  <p>
                    {text("ออเดอร์สร้างเมื่อ", "Linked order created at")}:{" "}
                    {read.data.record.orderCreatedAt
                      ? read.data.record.orderCreatedAt
                      : unavailable()}
                  </p>
                  <p>
                    {text(
                      "ประมวลผลคืนเงินเมื่อ (ไม่ใช่ช่วงที่ใช้กรอง)",
                      "Refund processed at (not the filter timestamp)",
                    )}
                    :{" "}
                    {read.data.record.processedAt
                      ? read.data.record.processedAt
                      : unavailable()}
                  </p>
                  <Alert tone="warn">
                    {text(
                      "บันทึกคืนเงินนี้กรองด้วย created_at ไม่หักซ้ำจากยอดออเดอร์ และยังไม่แทน ledger ทางบัญชี",
                      "This refund uses created_at filtering. It is not subtracted again or treated as an accounting ledger entry.",
                    )}
                  </Alert>
                </>
              )}
              <Alert tone="muted">
                {text(
                  "หลักฐานนี้อ่านใหม่ตามขอบเขตเดือนและกฎเดิม ผลอาจเปลี่ยนจากหน้ารวม ความสดใหม่ต้นทางยังไม่ยืนยัน",
                  "This record was reread within the month and original eligibility boundary. It may differ from the earlier summary; upstream freshness is unverified.",
                )}
              </Alert>
            </div>
          </Panel>
        )
      )}
      <Gaps />
    </CommercePage>
  );
}
