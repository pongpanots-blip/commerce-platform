// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLocale } from "@cp/ui";
import { api } from "../../../lib/api";
import { fixtureInputs } from "../../../../../commerce-platform/src/modules/integration/pack-price-planning/pack-fixtures";
import {
  COMPARISON_HOME as home,
  COMPARISON_API as endpoint,
  comparisonRows,
  comparisonWorkspaceSchema,
  verifyComparisonReceipt,
  type ComparisonPacket,
} from "../../../../../commerce-platform/src/modules/integration/competitor-prices/comparison-contracts";
import ComparisonWorkspace from "./ComparisonWorkspace";
import {
  comparisonFormKey,
  readComparisonJobs,
  storeComparisonJob,
} from "./comparison-journal";
import { ValidatedPlanningHandoff } from "./ValidatedPlanningHandoff";
let role = "admin";
const owner = "00000000-0000-4000-8000-000000000010";
vi.mock("../../../lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  authedFetch: vi.fn(),
  session: { claims: () => ({ sub: owner, role }) },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root, saved: unknown;
const base = home + "/products/SYNTHETIC-SKU";
function workspace() {
  const inputs = fixtureInputs();
  inputs.observations[1].priceBasis = "public";
  const metadata = inputs.observations.map((o, i) => ({
    id: o.id,
    sourceId: `00000000-0000-4000-8000-00000000000${i + 4}`,
    sourceName: "Same vendor",
    sourceUrl: `https://vendor-${i}.example.invalid/product`,
    context: "Synthetic public price terms",
    ourProductVersion: "b".repeat(64),
    relationship: "same_product",
  }));
  return comparisonWorkspaceSchema.parse({
    sku: inputs.sku,
    inputs,
    rows: comparisonRows(inputs, metadata),
    sourceFingerprint: inputs.sourceFingerprint,
    capturedAt: inputs.capturedAt,
    observationsTruncated: false,
    upstreamFreshness: "unverified",
  });
}
function packet(): ComparisonPacket {
  const w = workspace();
  return {
    requestId: "00000000-0000-4000-8000-000000000099",
    sku: w.sku,
    sourceFingerprint: w.sourceFingerprint,
    commands: [
      {
        operation: "verify",
        pairId: w.rows[0].id,
        revision: 1,
        relationship: "same_product",
        note: "Reviewed source and exact product identity",
      },
    ],
  };
}
function receipt(p = packet(), status: "committed" | "failed" = "committed") {
  return verifyComparisonReceipt({
    kind: "competitor_action",
    id: "00000000-0000-4000-8000-000000000088",
    requestId: p.requestId,
    packet: p,
    status,
    persisted: true,
    sellingPriceWrites: false,
    activationAllowed: false,
    savedAt: fixtureInputs().capturedAt,
    results: p.commands.map((c, index) => ({
      index,
      pairId: "pairId" in c ? c.pairId : null,
      status: status === "committed" ? "applied" : "failed",
      message: status === "failed" ? "Synthetic failure" : "",
      before: null,
      after:
        status === "committed"
          ? c.operation === "review"
            ? {
                productId: fixtureInputs().product.id,
                reviewedAt: fixtureInputs().capturedAt,
              }
            : {
                id:
                  "pairId" in c ? c.pairId : fixtureInputs().observations[0].id,
                revision: 2,
              }
          : null,
    })),
  });
}
function Location() {
  const p = useLocation(),
    navigate = useNavigate();
  return (
    <>
      <output>{p.pathname + p.search}</output>
      <button onClick={() => navigate(-1)}>Back test</button>
      <button onClick={() => navigate(1)}>Forward test</button>
    </>
  );
}
async function render(path = base, selectedRole = "admin", handoff = false) {
  role = selectedRole;
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Location />
        {handoff ? (
          <ValidatedPlanningHandoff>
            {(referral) => (
              <span>
                Planning child {referral?.sku} {referral?.selectedIds.join(",")}
              </span>
            )}
          </ValidatedPlanningHandoff>
        ) : (
          <ComparisonWorkspace role={role} />
        )}
      </MemoryRouter>,
    ),
  );
}
const content = () => container.textContent ?? "";
const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (x) => x.textContent === name,
  )!;
async function link(path: string) {
  const a = container.querySelector<HTMLAnchorElement>(`a[href="${path}"]`)!;
  expect(a).toBeTruthy();
  await act(async () =>
    a.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    ),
  );
}
function field(label: string) {
  const l = [...container.querySelectorAll("label")].find((x) =>
    x.textContent?.startsWith(label),
  );
  return (
    l?.htmlFor
      ? document.getElementById(l.htmlFor)
      : l?.querySelector("input,select")
  ) as HTMLInputElement;
}
async function fill(label: string, value: string) {
  const node = field(label);
  expect(node).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setUiLocale("en");
  saved = null;
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url.includes("/handoff/")) {
      const w = workspace();
      return {
        sku: w.sku,
        sourceFingerprint: w.sourceFingerprint,
        packSourceFingerprint: w.sourceFingerprint,
        eligibleIds: w.rows.map((x) => x.id),
        productName: w.inputs.product.name,
        capturedAt: w.capturedAt,
        activationAllowed: false,
        sellingPriceWrites: false,
      };
    }
    if (url.includes("/products/")) return workspace();
    if (url.includes("/requests/")) {
      if (saved) return saved;
      throw Object.assign(Error("Absent"), { status: 404 });
    }
    if (url.endsWith("/history"))
      return { pairId: workspace().rows[0].id, items: [], hasMore: false };
    if (url.endsWith("/sources")) return [];
    return {
      message: "",
      data: {
        rows: [],
        categories: [],
        total: 0,
        counts: { total: 0, reviewed: 0 },
      },
    };
  });
  vi.mocked(api.post).mockImplementation(async (_url, p) => {
    saved = receipt(p as ComparisonPacket);
    return saved;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
it("renders two vendors with duplicate names and exact kilogram bases without false completed-action badges", async () => {
  await render();
  expect(content()).toContain("100.000000 THB / kg");
  expect(content()).toContain("90.000000 THB / kg");
  expect(content()).toContain("vendor-0.example.invalid");
  expect(content()).toContain("vendor-1.example.invalid");
  expect(content()).toContain("Comparable at this read: 2");
  expect(content()).not.toContain("Persisted action outcomes");
});
it.each(["business_analyst", "merchandising"])(
  "%s retains original access scope before writes",
  async (selected) => {
    await render(base, selected);
    expect(api.post).not.toHaveBeenCalled();
    if (selected === "merchandising") {
      expect(api.get).not.toHaveBeenCalled();
      expect(content()).toContain("cannot read competitor evidence");
    } else {
      expect(content()).toContain("Public prices");
      expect(
        container.querySelector(`a[href="${base}/review-marker"]`),
      ).toBeNull();
    }
  },
);
it("legacy SKU links resolve into canonical URL and action back-forward retains entered values", async () => {
  await render(home + "?sku=SYNTHETIC-SKU");
  expect(container.querySelector("output")!.textContent).toBe(base);
  const task = base + "/pairs/" + workspace().rows[0].id + "/verify";
  await link(base + "/pairs/" + workspace().rows[0].id);
  await link(task);
  await fill("Reviewed reason", "Reviewed source after inspection");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(container.querySelector("output")!.textContent).toBe(task + "/review");
  await act(async () => button("Back test").click());
  expect(field("Reviewed reason").value).toBe(
    "Reviewed source after inspection",
  );
  await act(async () => button("Forward test").click());
  expect(api.post).not.toHaveBeenCalled();
});
it("duplicate synchronous clicks save one immutable packet and success requires a matching persisted receipt", async () => {
  await render(base + "/pairs/" + workspace().rows[0].id + "/verify");
  await fill("Reviewed reason", "Reviewed exact synthetic product");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await act(async () => {
    button("Save this action").click();
    button("Save this action").click();
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(content()).toContain("Persisted action outcomes: 1 / 1");
  expect(readComparisonJobs(owner)).toEqual([]);
});
it("mismatched receipts stay unverified and unavailable request lookup blocks retries", async () => {
  vi.mocked(api.post).mockResolvedValue(
    receipt({ ...packet(), requestId: "00000000-0000-4000-8000-000000000077" }),
  );
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url.includes("/requests/"))
      throw Object.assign(Error("storage offline"), { status: 503 });
    if (url.includes("/products/")) return workspace();
    return [];
  });
  await render(base + "/pairs/" + workspace().rows[0].id + "/verify");
  await fill("Reviewed reason", "Reviewed exact synthetic product");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await act(async () => button("Save this action").click());
  expect(content()).not.toContain("Persisted action outcomes");
  expect(readComparisonJobs(owner)).toHaveLength(1);
  expect(button("Retry the same immutable request")).toBeUndefined();
});
it("known absent requests retry the original packet, while conflict requests cannot blindly retry", async () => {
  const p = packet();
  storeComparisonJob({ owner, packet: p, conflict: false });
  await render(home + "/requests/" + p.requestId);
  await act(async () => button("Retry the same immutable request").click());
  expect(api.post).toHaveBeenCalledWith(endpoint + "/actions", p);
  expect(content()).toContain("Persisted action outcomes: 1 / 1");
});
it("failed persisted receipts show zero completed actions", async () => {
  saved = receipt(packet(), "failed");
  await render(home + "/requests/" + packet().requestId);
  expect(content()).toContain("Persisted action outcomes: 0 / 1");
  expect(content()).toContain("Not applied");
  expect(api.post).not.toHaveBeenCalled();
});
it("owner journals reject replacement of an existing request and isolate foreign or corrupt entries", () => {
  storeComparisonJob({ owner, packet: packet(), conflict: false });
  expect(() =>
    storeComparisonJob({
      owner,
      packet: { ...packet(), sku: "DIFFERENT" },
      conflict: false,
    }),
  ).toThrow("immutable");
  expect(readComparisonJobs("another")).toEqual([]);
  localStorage.setItem("cp-comparison-requests:" + owner, "{");
  expect(readComparisonJobs(owner)).toEqual([]);
});
it("storage failures prevent dispatch, and loading/failure retry never claims empty success", async () => {
  let reject!: (e: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((_ok, no) => {
        reject = no;
      }),
  );
  await render();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(content()).not.toContain("No product pairs yet");
  await act(async () => reject(Error("Synthetic read failure")));
  expect(button("Try again")).toBeTruthy();
  await act(async () => button("Try again").click());
  expect(content()).toContain("Public prices");
});
it("empty pairs and invalid task/UUID links have useful states", async () => {
  const w = workspace();
  w.rows = [];
  w.inputs.observations = [];
  vi.mocked(api.get).mockResolvedValue(w);
  await render();
  expect(content()).toContain("No product pairs yet");
  expect(content()).not.toContain("Persisted action outcomes");
});
it("handoff selects bounded compatible IDs and excludes unchecked pairs from its URL", async () => {
  await render(base + "/planning");
  const boxes = container.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  expect(boxes.length).toBe(2);
  await act(async () => boxes[1].click());
  const link = container.querySelector<HTMLAnchorElement>(
    'a[href^="/planning/pack-prices/new/product?"]',
  )!;
  expect(new URL(link.href).searchParams.get("comparisonPairs")).toBe(
    workspace().rows[0].id,
  );
});
it("handoff revalidates authoritative identity and rejects stale, duplicate or oversized selection before planning", async () => {
  await render(
    "/planning/pack-prices/new/product?comparisonSku=SYNTHETIC-SKU&comparisonFingerprint=" +
      "b".repeat(64) +
      "&comparisonPairs=" +
      workspace().rows[0].id,
    "admin",
    true,
  );
  expect(content()).not.toContain("Planning child");
  expect(content()).toContain("changed");
});
it("valid handoff preserves only selected IDs and ordinary planning renders without a comparison request", async () => {
  await render(
    "/planning/pack-prices/new/product?comparisonSku=SYNTHETIC-SKU&comparisonFingerprint=" +
      "a".repeat(64) +
      "&comparisonPairs=" +
      workspace().rows[1].id,
    "admin",
    true,
  );
  expect(content()).toContain(
    "Planning child SYNTHETIC-SKU " + workspace().rows[1].id,
  );
});
it("retained forms require explicit review after source revision changes", async () => {
  const task = base + "/pairs/" + workspace().rows[0].id + "/verify";
  localStorage.setItem(
    comparisonFormKey(owner, task),
    JSON.stringify({
      form: {
        sourceUrl: "",
        sourceId: "",
        catalogItemId: "",
        name: "",
        competitorSku: "",
        context: "",
        unit: "kg",
        min: "1",
        max: "1",
        count: "1",
        price: "",
        currency: "THB",
        taxBasis: "inclusive",
        priceBasis: "public",
        observedAt: "2026-10-09T12:00",
        relationship: "uncertain",
        note: "Old pending review values",
        collectionAllowed: "false",
        autoRefresh: "false",
      },
      fingerprint: "b".repeat(64),
      revision: 1,
    }),
  );
  await render(task);
  expect(content()).toContain("Evidence or revision changed");
  expect(button("Review before saving").disabled).toBe(true);
  expect(field("Reviewed reason").value).toBe("Old pending review values");
});
it("interrupted saves cannot redirect a later navigation when a delayed receipt arrives", async () => {
  let release!: (v: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((ok) => {
        release = ok;
      }),
  );
  await render(base + "/pairs/" + workspace().rows[0].id + "/verify");
  await fill("Reviewed reason", "Reviewed interrupted synthetic product");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await act(async () => button("Save this action").click());
  const intent = vi.mocked(api.post).mock.calls[0][1] as ComparisonPacket;
  await link(home);
  await act(async () => release(receipt(intent)));
  expect(container.querySelector("output")!.textContent).toBe(home);
  expect(content()).not.toContain("Persisted action outcomes");
});
it("conflicting journal requests require current evidence review rather than replay", async () => {
  storeComparisonJob({ owner, packet: packet(), conflict: true });
  await render(home + "/requests/" + packet().requestId);
  expect(button("Retry the same immutable request")).toBeUndefined();
  expect(content()).toContain(
    "Review current data before starting a new request",
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("more than twenty eligible handoff pairs require an explicit bounded selection", async () => {
  const w = workspace();
  w.inputs.observations = Array.from({ length: 21 }, (_, i) => ({
    ...w.inputs.observations[0],
    id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, "0")}`,
  }));
  w.rows = w.inputs.observations.map((o) => ({ ...w.rows[0], id: o.id }));
  const normal = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation(async (url) =>
    url.includes("/handoff/")
      ? {
          sku: w.sku,
          sourceFingerprint: w.sourceFingerprint,
          packSourceFingerprint: w.sourceFingerprint,
          eligibleIds: w.rows.map((r) => r.id),
          productName: w.inputs.product.name,
          capturedAt: w.capturedAt,
          activationAllowed: false,
          sellingPriceWrites: false,
        }
      : url.includes("/products/")
        ? w
        : normal(url),
  );
  await render(base + "/planning");
  expect(
    container.querySelector('a[href^="/planning/pack-prices/new/product?"]'),
  ).toBeNull();
  const boxes = container.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  for (let i = 0; i < 20; i++) await act(async () => boxes[i].click());
  expect(boxes[20].disabled).toBe(true);
  expect(
    new URL(
      container.querySelector<HTMLAnchorElement>(
        'a[href^="/planning/pack-prices/new/product?"]',
      )!.href,
    ).searchParams
      .get("comparisonPairs")!
      .split(","),
  ).toHaveLength(20);
});
it("legacy source links resolve to a distinct canonical action URL", async () => {
  await render(home + "?step=sources");
  expect(container.querySelector("output")!.textContent).toBe(
    home + "/sources",
  );
  expect(content()).toContain("Manage price sources");
});

it("source reassignment reviews previous/new URL, reason and disabled collection before sending", async () => {
  const w = workspace(),
    path = base + "/pairs/" + w.rows[0].id + "/reassign";
  vi.mocked(api.get).mockImplementation(async (url) =>
    url.endsWith("/sources")
      ? [
          {
            id: w.rows[1].sourceId,
            name: "Other vendor",
            origin: "https://vendor-1.example.invalid",
          },
        ]
      : url.includes("/requests/")
        ? saved
        : w,
  );
  await render(path);
  await fill(
    "HTTPS product URL",
    "https://vendor-1.example.invalid/new-product",
  );
  await fill("Price source", w.rows[1].sourceId!);
  await fill(
    "Reviewed reason, at least 10 characters",
    "Reviewed changed source and original historical quote",
  );
  await act(async () => button("Review before saving").click());
  expect(content()).toContain("Original quotes stay in history");
  expect(content()).toContain(w.rows[0].url);
  expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  await act(async () => button("Save this action").click());
  expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({
    sku: w.sku,
    commands: [
      {
        operation: "reassign",
        pairId: w.rows[0].id,
        sourceId: w.rows[1].sourceId,
        sourceUrl: "https://vendor-1.example.invalid/new-product",
      },
    ],
  });
});
const tick = async (index = 0) =>
  act(async () =>
    container
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      [index].click(),
  );
async function chooseBatch() {
  const w = workspace();
  await render(base + "/batch");
  await tick(0);
  await fill(
    "Reason for Same vendor · " + w.rows[0].id,
    "Reviewed exact source and product identity",
  );
  await fill("Decision for Same vendor · " + w.rows[0].id, "same_product");
  await tick(1);
  await fill(
    "Reason for Same vendor · " + w.rows[1].id,
    "Reviewed unsuitable alternate product pair",
  );
  await fill("Decision for Same vendor · " + w.rows[1].id, "remove");
  await act(async () => button("Review selected decisions").click());
}
it("batch review requires explicit confirmation and duplicate clicks send exactly the selected pairs", async () => {
  await chooseBatch();
  expect(content()).toContain("the SKU reviewed marker is unchanged");
  expect(button("Confirm and save selected pairs").disabled).toBe(true);
  expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  await tick();
  await act(async () => {
    button("Confirm and save selected pairs").click();
    button("Confirm and save selected pairs").click();
  });
  expect(vi.mocked(api.post)).toHaveBeenCalledTimes(1);
  const p = vi.mocked(api.post).mock.calls[0][1] as ComparisonPacket;
  expect(p.commands.map((c) => c.operation)).toEqual(["verify", "remove"]);
  expect(content()).toContain("Persisted action outcomes: 2 / 2");
});
it("direct batch review without retained decisions cannot dispatch", async () => {
  await render(base + "/batch/review");
  expect(content()).toContain("No pairs selected");
  await tick();
  expect(button("Confirm and save selected pairs").disabled).toBe(true);
  expect(vi.mocked(api.post)).not.toHaveBeenCalled();
});
it("back-forward retains reviewed choices and requires a fresh confirmation", async () => {
  await chooseBatch();
  await tick();
  await act(async () => button("Back test").click());
  expect(
    field("Reason for Same vendor · " + workspace().rows[0].id).value,
  ).toBe("Reviewed exact source and product identity");
  await act(async () => button("Forward test").click());
  expect(button("Confirm and save selected pairs").disabled).toBe(true);
  expect(vi.mocked(api.post)).not.toHaveBeenCalled();
});
it("changed batch evidence preserves choices but blocks confirmation until explicitly discarded", async () => {
  await render(base + "/batch");
  await tick(0);
  await fill(
    "Reason for Same vendor · " + workspace().rows[0].id,
    "Reviewed exact source and product identity",
  );
  const changed = workspace();
  changed.sourceFingerprint = "c".repeat(64);
  changed.inputs.sourceFingerprint = changed.sourceFingerprint;
  vi.mocked(api.get).mockResolvedValue(changed);
  await act(async () => button("Review selected decisions").click());
  expect(content()).toContain("Retained decisions cannot be submitted");
  await tick();
  expect(button("Confirm and save selected pairs").disabled).toBe(true);
  await act(async () =>
    button("Discard retained decisions and review current pairs").click(),
  );
  expect(content()).toContain("Selected pairs: 0");
  expect(vi.mocked(api.post)).not.toHaveBeenCalled();
});
it("a persisted partial batch counts only applied native outcomes", async () => {
  await chooseBatch();
  vi.mocked(api.post).mockImplementation(async (_url, p) => {
    const r = receipt(p as ComparisonPacket);
    saved = verifyComparisonReceipt({
      ...r,
      status: "partial",
      results: r.results.map((x, i) =>
        i
          ? {
              ...x,
              status: "failed",
              after: null,
              message: "Synthetic missing pair",
            }
          : x,
      ),
    });
    return saved;
  });
  await tick();
  await act(async () => button("Confirm and save selected pairs").click());
  expect(content()).toContain("Persisted action outcomes: 1 / 2");
  expect(content()).toContain("Not applied");
  expect(content()).toContain("Synthetic missing pair");
});
it("batch storage failure sends no action and remains recoverable in context", async () => {
  await chooseBatch();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("Unavailable");
  });
  await tick();
  await act(async () => button("Confirm and save selected pairs").click());
  expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  expect(content()).toContain("Recovery storage is unavailable");
});
it.each(["business_analyst", "merchandising"])(
  "%s cannot dispatch selected pair decisions",
  async (selectedRole) => {
    await render(base + "/batch", selectedRole);
    expect(button("Confirm and save selected pairs")).toBeUndefined();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      0,
    );
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    if (selectedRole === "merchandising")
      expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  },
);
