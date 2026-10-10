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
import FinancialAnalysisWorkspace from "./FinancialAnalysisWorkspace";
import { api } from "../../../lib/api";
import {
  FINANCE_HOME as home,
  financeSearch,
  recordedVariance,
  fields,
} from "../../../../../commerce-platform/src/modules/integration/financial-analysis/financial-analysis";
import {
  fixtureAnalysis,
  financeQuery,
  orderId,
  refundId,
} from "../../../../../commerce-platform/src/modules/integration/financial-analysis/finance-fixtures";
let role = "admin",
  root: Root,
  container: HTMLDivElement;
vi.mock("../../../lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  session: { claims: () => ({ sub: "finance-test", role }) },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const path = (action = "coverage") =>
    home + "/" + action + financeSearch(financeQuery),
  text = () => container.textContent ?? "";
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  )!;
function Location() {
  const l = useLocation(),
    n = useNavigate();
  return (
    <>
      <output>{l.pathname + l.search}</output>
      <button onClick={() => n(-1)}>Back test</button>
      <button onClick={() => n(1)}>Forward test</button>
      <button onClick={() => n(path("period"))}>Period test</button>
    </>
  );
}
async function render(r = "admin", entry = path()) {
  role = r;
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Location />
        <Routes>
          <Route
            path={home + "/*"}
            element={<FinancialAnalysisWorkspace role={r} />}
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
}
async function link(href: string) {
  await act(async () =>
    container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!.click(),
  );
}
function field(label: string) {
  const l = [...container.querySelectorAll("label")].find((e) =>
    e.textContent?.startsWith(label),
  )!;
  return document.getElementById(l.htmlFor) as HTMLInputElement;
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
beforeEach(() => {
  vi.resetAllMocks();
  setUiLocale("en");
  sessionStorage.clear();
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url.startsWith("/reports/financial-goals"))
      return { items: [], next: null };
    if (
      url.startsWith("/reports/financial-analysis/orders/") ||
      url.startsWith("/reports/financial-analysis/refunds/")
    ) {
      const u = new URL(url, "http://synthetic"),
        m = u.searchParams.get("month")!,
        v = fixtureAnalysis({
          ...financeQuery,
          month: m,
          timezone: u.searchParams.get(
            "timezone",
          ) as typeof financeQuery.timezone,
          compare: m === "2026-08" ? "2026-09" : "2026-08",
        }).current;
      return {
        kind: url.includes("/orders/") ? "orders" : "refunds",
        window: v.window,
        source: v.source,
        capturedAt: v.capturedAt,
        upstreamFreshness: "unverified",
        record: url.includes("/orders/")
          ? v.orders!.items[0]
          : v.refunds!.items[0],
      };
    }
    const u = new URL(url, "http://synthetic");
    return fixtureAnalysis(
      Object.fromEntries(u.searchParams) as typeof financeQuery,
    );
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it.each(["admin", "sales_manager", "business_analyst"])(
  "%s can read native team evidence without writes or completed badges",
  async (r) => {
    await render(r);
    expect(text()).toContain("Partial read; upstream completeness unverified");
    expect(text()).toContain("SYNTHETIC-1");
    expect(text()).toContain("COGS needs effective order-line cost");
    expect(text()).not.toContain("Saved successfully");
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  },
);
it.each(["sale", "marketing", "merchandising", "cs", "graphic"])(
  "%s direct URLs deny before financial/goal reads",
  async (r) => {
    await render(r);
    expect(text()).toContain("cannot read");
    expect(api.get).not.toHaveBeenCalled();
  },
);
it("canonical entry redirects to distinct period URL and empty private goals remain explicit", async () => {
  await render("business_analyst", home);
  expect(container.querySelector("output")!.textContent).toContain("/period?");
  expect(text()).toContain("No private goal drafts returned");
  expect(api.get).toHaveBeenCalledTimes(1);
});
it("calendar/timezone inputs lead to scoped coverage, variance, back and forward URLs", async () => {
  await render("admin", path("period"));
  await fill("Review month", "2026-07");
  await fill("Reference month", "2026-06");
  await fill("Timezone for both months", "Asia/Bangkok");
  await act(async () =>
    button("Read selected periods and review coverage").click(),
  );
  const q = {
    month: "2026-07",
    compare: "2026-06",
    timezone: "Asia/Bangkok" as const,
  };
  expect(container.querySelector("output")!.textContent).toBe(
    home + "/coverage" + financeSearch(q),
  );
  await link(home + "/variance" + financeSearch(q));
  expect(text()).toContain("Compare recorded financial amounts");
  await act(async () => button("Back test").click());
  expect(text()).toContain("Review financial source coverage");
  await act(async () => button("Forward test").click());
  expect(text()).toContain("Compare recorded financial amounts");
});
it("previous-month order detail and refund composite identity preserve original comparison", async () => {
  await render();
  const order =
    home + "/months/2026-08/orders/" + orderId + financeSearch(financeQuery);
  await link(order);
  expect(api.get).toHaveBeenLastCalledWith(
    "/reports/financial-analysis/orders/" +
      orderId +
      "?month=2026-08&timezone=UTC",
  );
  expect(text()).toContain("Source-recorded order evidence");
  await link(path());
  expect(container.querySelector("output")!.textContent).toBe(path());
  const refund =
    home +
    "/months/2026-09/refunds/" +
    orderId +
    "/" +
    refundId +
    financeSearch(financeQuery);
  await link(refund);
  expect(text()).toContain("Source-recorded refund evidence");
  await act(async () => button("Back test").click());
  expect(container.querySelector("output")!.textContent).toBe(path());
});
it("period form restores URL selections after back navigation", async () => {
  await render("admin", path("period"));
  await fill("Review month", "2026-07");
  await act(async () =>
    button("Read selected periods and review coverage").click(),
  );
  await link(
    home + "/period" + financeSearch({ ...financeQuery, month: "2026-07" }),
  );
  expect(field("Review month").value).toBe("2026-07");
  await act(async () => button("Back test").click());
  await act(async () => button("Back test").click());
  expect(field("Review month").value).toBe("2026-09");
});
it("same month validation exposes labeled errors and remains on period page", async () => {
  await render("admin", path("period"));
  await fill("Reference month", "2026-09");
  await act(async () =>
    button("Read selected periods and review coverage").click(),
  );
  expect(text()).toContain("Choose a different month");
  expect(field("Reference month").getAttribute("aria-invalid")).toBe("true");
  expect(container.querySelector("output")!.textContent).toBe(path("period"));
});
it.each([
  "?month=2026-09&compare=2026-08&timezone=UTC&month=2026-09",
  "?month=2099-01&compare=2026-08&timezone=UTC",
  "?month=2026-09&compare=2026-08&timezone=UTC&source=replica",
])("rejects invalid/future/override URLs before reads: %s", async (q) => {
  await render("admin", home + "/coverage" + q);
  expect(text()).toContain("Invalid calendar");
  expect(api.get).not.toHaveBeenCalled();
});
it("shows skeleton for delayed reads, hides stale evidence while loading, then shows authoritative counts", async () => {
  let resolve!: (v: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(
    () => new Promise((r) => (resolve = r)),
  );
  await render();
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(text()).not.toContain("SYNTHETIC-1");
  await act(async () => resolve(fixtureAnalysis()));
  expect(text()).toContain("SYNTHETIC-1");
  expect(text()).toContain("1 / 0");
});
it.each(["HTTP 403", "HTTP 404", "HTTP 503"])(
  "sanitizes %s and retries without success/zero substitutes",
  async (error) => {
    vi.mocked(api.get).mockRejectedValueOnce(Error(error));
    await render();
    expect(text()).not.toContain("SYNTHETIC-1");
    expect(text()).not.toContain("No eligible orders returned");
    await act(async () => button("Try again").click());
    expect(text()).toContain("SYNTHETIC-1");
    expect(api.post).not.toHaveBeenCalled();
  },
);
it("unavailable refund source stays unknown alongside orders and remains refreshable", async () => {
  const v = fixtureAnalysis();
  v.current.refunds = null;
  v.current.issues = ["refunds_unavailable"];
  v.variance = recordedVariance(v.current, v.previous);
  vi.mocked(api.get).mockResolvedValueOnce(v);
  await render();
  expect(text()).toContain("Refund source unavailable; no zero amount");
  expect(text()).toContain("SYNTHETIC-1");
  expect(button("Refresh financial evidence")).toBeDefined();
});
it("empty eligible query keeps upstream absence/completeness unknown", async () => {
  const v = fixtureAnalysis();
  v.current.orders = {
    paidOrders: 0,
    excludedWithoutPayment: 0,
    legacyCopyOrders: 0,
    latestCopyWriteAt: null,
    values: Object.fromEntries(
      fields.map((f) => [
        f,
        {
          value: "0.00",
          knownSum: null,
          knownRows: 0,
          missingRows: 0,
          negativeRows: 0,
        },
      ]),
    ) as NonNullable<typeof v.current.orders>["values"],
    items: [],
    hasMore: false,
  };
  v.variance = recordedVariance(v.current, v.previous);
  vi.mocked(api.get).mockResolvedValueOnce(v);
  await render();
  expect(text()).toContain(
    "No eligible orders returned. This does not prove complete absence",
  );
});
it("rejects a valid but unrelated response and fabricated actuals", async () => {
  const v = fixtureAnalysis({ ...financeQuery, month: "2026-07" });
  vi.mocked(api.get).mockResolvedValueOnce(v);
  await render();
  expect(text()).not.toContain("SYNTHETIC-1");
  expect(button("Try again")).toBeDefined();
});
it("interrupted/duplicate refresh reads show only the latest response and no persistence request", async () => {
  let first!: (v: unknown) => void, last!: (v: unknown) => void;
  await render();
  vi.mocked(api.get)
    .mockImplementationOnce(() => new Promise((r) => (first = r)))
    .mockImplementationOnce(() => new Promise((r) => (last = r)));
  await act(async () => {
    button("Refresh financial evidence").click();
    button("Refresh financial evidence").click();
  });
  const latest = fixtureAnalysis();
  latest.current.orders!.items[0].number = "LATEST";
  latest.previous.orders!.items[0].number = "LATEST-reference";
  await act(async () => last(latest));
  expect(text()).toContain("LATEST");
  await act(async () => first(fixtureAnalysis()));
  expect(text()).toContain("LATEST");
  expect(text()).not.toContain("SYNTHETIC-1");
  expect(api.post).not.toHaveBeenCalled();
});
it("a late read after leaving analysis cannot overwrite period selections", async () => {
  let resolve!: (v: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(
    () => new Promise((r) => (resolve = r)),
  );
  await render();
  await act(async () => button("Period test").click());
  await fill("Review month", "2026-07");
  await act(async () => resolve(fixtureAnalysis()));
  expect(field("Review month").value).toBe("2026-07");
  expect(text()).not.toContain("SYNTHETIC-1");
});
it("evidence outside selected months and wrong payload identity cannot render", async () => {
  await render(
    "admin",
    home + "/months/2026-07/orders/" + orderId + financeSearch(financeQuery),
  );
  expect(api.get).not.toHaveBeenCalled();
  expect(text()).toContain("Invalid financial evidence");
});

it("shows the selected Bangkok interval and explicit UTC evidence timestamps without local calendar ambiguity", async () => {
  const q = { ...financeQuery, timezone: "Asia/Bangkok" as const };
  await render(
    "business_analyst",
    home + "/months/2026-09/orders/" + orderId + financeSearch(q),
  );
  expect(text()).toContain(
    "2026-09 · Asia/Bangkok · [2026-08-31T17:00:00.000Z, 2026-09-30T17:00:00.000Z)",
  );
  expect(text()).toContain("Record created at: 2026-09-15T00:00:00Z");
  expect(text()).toContain("Evidence timestamps use ISO UTC");
});
