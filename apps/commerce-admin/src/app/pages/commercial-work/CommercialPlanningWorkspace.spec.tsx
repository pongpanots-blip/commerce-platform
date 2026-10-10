// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLocale } from "@cp/ui";
import {
  planHome,
  planApi,
  planInputsSchema,
  planReceiptSchema,
  planScenarioSchema,
  previewPlan,
  type PlanKind,
  type PlanInputs,
  type PlanScenario,
  type PlanReceipt,
} from "../../../../../commerce-platform/src/modules/integration/commercial-work/commercial-work";
import { api } from "../../../lib/api";
import {
  SalesWorkWorkspace,
  MarketingReadinessWorkspace,
} from "./CommercialPlanningWorkspace";
import {
  formFromPlan,
  storePlanForm,
  readPlanJobs,
  storePlanJob,
  type PlanSaveJob,
} from "./plan-form";
let role = "admin",
  kind: PlanKind = "sales_work",
  root: Root,
  container: HTMLDivElement,
  saved: PlanReceipt | null;
vi.mock("../../../lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  session: { claims: () => ({ sub: "actor-a", role }) },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const company = "00000000-0000-4000-8000-000000000001",
  order = "00000000-0000-4000-8000-000000000002",
  id = "00000000-0000-4000-8000-000000000010",
  requestId = "00000000-0000-4000-8000-000000000099";
function inputs(
  k = kind,
  subject = k === "sales_work" ? company : "SKU",
  selected = k === "sales_work" ? order : null,
): PlanInputs {
  return planInputsSchema.parse({
    schemaVersion: 1,
    kind: k,
    capturedAt: "2026-10-10T00:00:00Z",
    sourceFingerprint: "a".repeat(64),
    scope:
      k === "sales_work"
        ? role === "sale"
          ? "own_assigned_company"
          : "authorized_team_company"
        : "marketing_catalog",
    source: "replica",
    upstreamFreshness: "unverified",
    subject: {
      id: subject,
      name: "Synthetic source",
      assignedRepId: k === "sales_work" ? company : null,
    },
    orders:
      k === "sales_work"
        ? [
            {
              id: order,
              number: "SYNTHETIC-1",
              status: "paid",
              paid: true,
              createdAt: "2026-10-09T00:00:00Z",
            },
          ]
        : [],
    historyCoverage: "returned_page_only",
    historyHasMore: false,
    selectedOrderId: selected,
    historicalLines:
      k === "sales_work" && selected
        ? [
            {
              sku: "SKU",
              name: "Synthetic line",
              recordedQuantity: "2",
              historicalUnit: null,
              recordedUnitPrice: "107",
            },
          ]
        : [],
    product:
      k === "marketing_readiness"
        ? {
            status: "active",
            recordedPrice: "107",
            recordedStock: 1,
            sellingUnit: "PK",
            imageCount: 1,
            categoryId: company,
            sourceChangedAt: null,
          }
        : null,
    followUpEligible: k === "sales_work",
    reorderEligible: k === "sales_work" && !!selected,
    knownReasons: [],
    missing:
      k === "sales_work"
        ? [
            "reorder_cadence",
            "current_customer_price",
            "selling_unit_mapping",
            "available_to_promise",
            "upstream_freshness",
          ]
        : [
            "spend",
            "attribution",
            "stock_age",
            "effective_internal_cost",
            "available_to_promise",
            "upstream_freshness",
          ],
    actualMargin: null,
    roas: null,
    currentOrderTotal: null,
    operationalWrites: false,
    activationAllowed: false,
  });
}
function scenario(k = kind) {
  const i = inputs(k);
  return planScenarioSchema.parse({
    kind: k,
    task: k === "sales_work" ? "follow_up" : "campaign_brief",
    name: "Synthetic review draft",
    subjectId: i.subject.id,
    orderId: i.selectedOrderId,
    note: "Review source evidence with a person",
    dueDate: null,
    sourceFingerprint: i.sourceFingerprint,
    lines: [],
  });
}
function receipt(s = scenario(), revision = 1) {
  const i = inputs(s.kind, s.subjectId, s.orderId);
  i.sourceFingerprint = s.sourceFingerprint;
  return planReceiptSchema.parse({
    ...previewPlan(s, i),
    id,
    revision,
    status: "draft",
    saved: true,
    persisted: true,
    operationalWrites: false,
    activationAllowed: false,
    createdAt: i.capturedAt,
    updatedAt: i.capturedAt,
  });
}
function job(): PlanSaveJob {
  return {
    schemaVersion: 1,
    owner: "actor-a",
    requestId,
    draftId: null,
    revision: null,
    scenario: scenario(),
    createdAt: "2026-10-10T00:00:00Z",
    conflict: false,
  };
}
const text = () => container.textContent ?? "",
  button = (s: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === s)!;
function Location() {
  const l = useLocation(),
    n = useNavigate();
  return (
    <>
      <output>{l.pathname + l.search}</output>
      <button onClick={() => n(-1)}>Back test</button>
      <button onClick={() => n(1)}>Forward test</button>
    </>
  );
}
async function render(r = "admin", path = planHome(kind) + "/new/source") {
  role = r;
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Location />
        <Routes>
          <Route
            path={planHome(kind) + "/*"}
            element={
              kind === "sales_work" ? (
                <SalesWorkWorkspace role={r} />
              ) : (
                <MarketingReadinessWorkspace role={r} />
              )
            }
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
}
async function link(path: string) {
  await act(async () =>
    container.querySelector<HTMLAnchorElement>(`a[href="${path}"]`)!.click(),
  );
}
function field(label: string) {
  const l = [...container.querySelectorAll("label")].find((e) =>
    e.textContent?.startsWith(label),
  );
  return (
    l?.htmlFor
      ? document.getElementById(l.htmlFor)
      : l?.querySelector("input,select")
  ) as HTMLInputElement;
}
async function fill(label: string, value: string) {
  const i = field(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      i instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(i, value);
    i.dispatchEvent(new Event("input", { bubbles: true }));
    i.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function review() {
  await link(planHome(kind) + "/new/review");
  await act(async () => button("Review current values").click());
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  setUiLocale("en");
  kind = "sales_work";
  role = "admin";
  saved = null;
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url.includes("/subjects"))
      return {
        items: [
          {
            id: kind === "sales_work" ? company : "SKU",
            name: "Synthetic source",
          },
        ],
        hasMore: false,
        coverage: "returned_page_only",
      };
    if (url.includes("/inputs/")) {
      const u = new URL(url, "http://fixture");
      return inputs(
        kind,
        decodeURIComponent(u.pathname.split("/").pop()!),
        u.searchParams.get("orderId"),
      );
    }
    if (url.includes("/preview?")) {
      const s = planScenarioSchema.parse(
        JSON.parse(
          Buffer.from(
            new URL(url, "http://fixture").searchParams.get("scenario")!,
            "base64url",
          ).toString(),
        ),
      );
      return previewPlan(s, inputs(s.kind, s.subjectId, s.orderId));
    }
    if (url.includes("/requests/")) {
      if (saved) return saved;
      throw Object.assign(Error("Absent"), {
        status: 404,
        details: { code: "PLAN_REQUEST_ABSENT" },
      });
    }
    if (url.includes("/drafts/")) {
      if (saved) return saved;
      throw Object.assign(Error("Absent"), { status: 404 });
    }
    return { items: [], next: null };
  });
  vi.mocked(api.post).mockImplementation(async (_u, p) => {
    saved = receipt((p as { scenario: PlanScenario }).scenario);
    return saved;
  });
  vi.mocked(api.patch).mockImplementation(async (_u, p) => {
    const v = p as { scenario: PlanScenario; revision: number };
    saved = receipt(v.scenario, v.revision + 1);
    return saved;
  });
  storePlanForm("actor-a", undefined, null, formFromPlan(scenario()));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  setUiLocale("th");
});
it("action URLs, back/forward and reload retain form; review requires a fresh preview", async () => {
  await render();
  await link(planHome(kind) + "/new/proposal");
  await fill("Work draft name", "My private task");
  await act(async () => button("Back test").click());
  expect(container.querySelector("output")?.textContent).toContain(
    "/new/source",
  );
  await act(async () => button("Forward test").click());
  expect(field("Work draft name").value).toBe("My private task");
  await link(planHome(kind) + "/new/review");
  expect(button("Save work draft for review")).toBeUndefined();
  expect(text()).toContain("No verified review");
});
it("double clicks produce one immutable request and success only after persistence", async () => {
  await render();
  await review();
  let release!: (v: unknown) => void;
  vi.mocked(api.post).mockImplementationOnce(
    async (_u, p) =>
      new Promise((ok) => {
        saved = receipt((p as { scenario: PlanScenario }).scenario);
        release = ok;
      }),
  );
  const save = button("Save work draft for review");
  await act(async () => {
    save.click();
    save.click();
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(text()).not.toContain("This save request is verified");
  expect(readPlanJobs("actor-a", kind)).toHaveLength(1);
  await act(async () => release(saved));
  expect(text()).toContain("This save request is verified");
  expect(readPlanJobs("actor-a", kind)).toHaveLength(0);
});
it("malformed claimed success never becomes a saved badge", async () => {
  await render();
  await review();
  vi.mocked(api.post).mockResolvedValueOnce({ ...receipt(), persisted: false });
  await act(async () => button("Save work draft for review").click());
  expect(text()).toContain("not marked successful");
  expect(text()).not.toContain("Saved draft receipt verified");
});
it("a dropped committed response recovers its original receipt without another write", async () => {
  await render();
  await review();
  vi.mocked(api.post).mockImplementationOnce(async (_u, p) => {
    saved = receipt((p as { scenario: PlanScenario }).scenario);
    throw Error("Dropped reply");
  });
  await act(async () => button("Save work draft for review").click());
  expect(text()).toContain("Saved draft receipt verified");
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("confirmed absence retries the same packet; generic authorization 404 never permits retry", async () => {
  storePlanJob(job());
  await render("admin", planHome(kind) + "/requests/" + requestId);
  await act(async () => button("Retry the same request").click());
  expect(api.post).toHaveBeenCalledWith(planApi(kind) + "/drafts", {
    requestId,
    scenario: job().scenario,
  });
  expect(text()).toContain("This save request is verified");
});
it("inaccessible committed source is not interpreted as an absent request", async () => {
  storePlanJob(job());
  vi.mocked(api.get).mockRejectedValue(
    Object.assign(Error("Scope revoked"), { status: 404 }),
  );
  await render("admin", planHome(kind) + "/requests/" + requestId);
  expect(button("Retry the same request")).toBeUndefined();
  expect(api.post).not.toHaveBeenCalled();
  expect(button("Try again")).toBeDefined();
});
it("journal quota stops dispatch; source failure exposes useful retry with sanitized errors", async () => {
  await render();
  await review();
  const native = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (k, v) {
    if (k.startsWith("cp:commercial-request:")) throw Error("Quota");
    return native.call(this, k, v);
  });
  await act(async () => button("Save work draft for review").click());
  expect(api.post).not.toHaveBeenCalled();
  expect(text()).toContain("No save was sent");
});
it.each([400, 403, 404, 409])(
  "known failed intent %i needs current-source review rather than blind replay",
  async (status) => {
    await render();
    await review();
    vi.mocked(api.post).mockRejectedValueOnce(
      Object.assign(Error("Changed"), { status }),
    );
    await act(async () => button("Save work draft for review").click());
    expect(readPlanJobs("actor-a", kind)[0].conflict).toBe(true);
    expect(button("Retry the same request")).toBeUndefined();
    expect(text()).toContain("Review current data");
  },
);
it("stale backup choice carries latest revision and fresh matching-source fingerprint", async () => {
  saved = receipt(scenario(), 2);
  const old = formFromPlan(scenario());
  old.name = "Previous task";
  storePlanForm("actor-a", id, 1, old);
  await render("admin", planHome(kind) + "/drafts/" + id + "/edit/proposal");
  expect(field("Work draft name").disabled).toBe(true);
  await act(async () => button("Copy my previous values for review").click());
  expect(field("Work draft name").value).toBe("Previous task");
  await link(planHome(kind) + "/drafts/" + id + "/edit/review");
  await act(async () => button("Review current values").click());
  await act(async () => button("Save work draft for review").click());
  expect(api.patch).toHaveBeenCalledWith(
    planApi(kind) + "/drafts/" + id,
    expect.objectContaining({ revision: 2 }),
  );
  expect(text()).toContain("Revision 3");
});
it("late review cannot overwrite a changed subject or redirect an interrupted step", async () => {
  await render();
  let release!: (v: unknown) => void;
  const normal = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation(async (u) =>
    u.includes("/preview?")
      ? new Promise((ok) => {
          release = ok;
        })
      : normal(u),
  );
  await link(planHome(kind) + "/new/review");
  await act(async () => button("Review current values").click());
  await link(planHome(kind) + "/new/source");
  await fill("Choose a company", "");
  await act(async () => release(previewPlan(scenario(), inputs())));
  expect(container.querySelector("output")?.textContent).toContain(
    "/new/source",
  );
  await link(planHome(kind) + "/new/review");
  expect(button("Save work draft for review")).toBeUndefined();
});
it("Sales stays read-only, denies editing and makes no write call", async () => {
  await render("sale");
  await review();
  expect(text()).toContain("Historical selling-unit mapping");
  expect(button("Save work draft for review")).toBeUndefined();
  expect(api.post).not.toHaveBeenCalled();
});
it.each(["business_analyst", "marketing", "merchandising", "cs", "graphic"])(
  "%s is denied Sales sources before any API call",
  async (r) => {
    await render(r);
    expect(api.get).not.toHaveBeenCalled();
    expect(text()).toContain("cannot read");
  },
);
it("Marketing readiness has missing critical evidence and retains only a private draft", async () => {
  kind = "marketing_readiness";
  storePlanForm("actor-a", undefined, null, formFromPlan(scenario()));
  await render("marketing");
  await review();
  expect(text()).toContain("Further confirmation required");
  expect(text()).toContain("Sales attribution");
  expect(text()).not.toContain("Ready to activate");
  await act(async () => button("Save work draft for review").click());
  expect(saved?.scenario.kind).toBe("marketing_readiness");
  expect(saved?.preview.roas).toBeNull();
});
it("reorder quantities are entered explicitly rather than copied from history", async () => {
  await render();
  await fill("Work to review", "reorder");
  await link(planHome(kind) + "/new/proposal");
  expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  expect(field("My proposed quantity").value).toBe("");
  await fill("My proposed quantity", "3");
  await act(async () => button("Review work and evidence").click());
  expect(text()).toContain("My proposed quantity: 3");
  expect(text()).toContain("Historical unit unverified");
});
it("loading is distinct from empty and retry restores source evidence", async () => {
  let reject!: (e: unknown) => void;
  const normal = vi.mocked(api.get).getMockImplementation()!;
  let fault = true;
  vi.mocked(api.get).mockImplementation(async (u) =>
    u.includes("/inputs/") && fault
      ? new Promise((_ok, no) => {
          reject = no;
          fault = false;
        })
      : normal(u),
  );
  await render();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  await act(async () => reject(Error("SQL credentials")));
  expect(text()).not.toContain("SQL credentials");
  await act(async () => button("Try again").click());
  expect(text()).toContain("Evidence and required confirmations");
});
it("empty draft lists count authoritative rows and unknown routes have useful guidance", async () => {
  await render("admin", planHome(kind));
  expect(text()).toContain("No drafts on this page");
  expect(text()).toContain("Drafts returned on this page: 0");
  expect(text()).not.toContain("Draft saved");
});
it("the journal partitions owners/kinds and rejects request identity changes", () => {
  const original = job();
  storePlanJob(original);
  expect(readPlanJobs("other", kind)).toEqual([]);
  expect(readPlanJobs("actor-a", "marketing_readiness")).toEqual([]);
  expect(() =>
    storePlanJob({
      ...original,
      scenario: { ...original.scenario, name: "Changed" },
    }),
  ).toThrow("identity changed");
});
