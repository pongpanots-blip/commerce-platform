// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLocale } from "@cp/ui";
import { api, salesAssignmentApi } from "../../lib/api";
import { SalesAssignment } from "./SalesAssignment";
import {
  ASSIGNMENT_API as endpoint,
  ASSIGNMENT_HOME as home,
  verifyAssignmentReceipt,
  type AssignmentPacket,
  type AssignmentReview,
} from "../../../../commerce-platform/src/modules/integration/customers/assignment-contracts";
import {
  readAssignmentJobs,
  storeAssignmentJob,
  assignmentFormKey,
} from "./sales-assignment/assignment-journal";
let role = "admin",
  account = "00000000-0000-4000-8000-000000000001";
vi.mock("../../lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  salesAssignmentApi: { reps: vi.fn() },
  session: { claims: () => ({ sub: account, role }) },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const company = "00000000-0000-4000-8000-000000000101",
  second = "00000000-0000-4000-8000-000000000102",
  rep = "00000000-0000-4000-8000-000000000201",
  old = "00000000-0000-4000-8000-000000000202",
  request = "00000000-0000-4000-8000-000000000099";
const selection = { companyIds: [company, second], salesUserId: rep };
const query = new URLSearchParams({
  companies: selection.companyIds.join(","),
  owner: rep,
}).toString();
const reviewPath = home + "/assign/review?" + query;
const data = (): AssignmentReview => ({
  items: selection.companyIds.map((companyId, n) => ({
    companyId,
    name: n ? "South Company" : "North Company",
    previousOwner: { id: old, name: "Previous Rep" },
    recorded: true,
    version: "a".repeat(64),
    importedCustomerCount: n + 1,
  })),
  newOwner: { id: rep, name: "New Rep" },
  capturedAt: "2026-10-10T00:00:00.000Z",
  ownership: "commerce",
  sourceFreshness: "unverified",
});
const packet = (): AssignmentPacket => ({
  requestId: request,
  salesUserId: rep,
  changes: data().items.map((i) => ({
    companyId: i.companyId,
    version: i.version,
  })),
});
const receipt = (p = packet()) =>
  verifyAssignmentReceipt(
    {
      kind: "customer_assignment",
      scenario: { kind: "customer_assignment" },
      id: "00000000-0000-4000-8000-000000000088",
      requestId: p.requestId,
      packet: p,
      status: "committed",
      persisted: true,
      appliedCount: p.changes.length,
      items: data().items.map((i, n) => ({
        ...i,
        companyId: p.changes[n].companyId,
        version: p.changes[n].version,
        newOwner: { id: rep, name: "New Rep" },
        savedVersion: "b".repeat(64),
      })),
      savedAt: "2026-10-10T01:00:00.000Z",
      outboxEnqueued: true,
      downstreamDelivery: "unverified",
    },
    p,
  );
const missing = () => Object.assign(Error("Not found"), { status: 404 });
let container: HTMLDivElement,
  root: Root,
  record: ReturnType<typeof receipt> | null;
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
async function render(path = home, selectedRole = "admin") {
  role = selectedRole;
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Location />
        <SalesAssignment role={role} />
      </MemoryRouter>,
    ),
  );
}
const content = () => container.textContent ?? "";
const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === name,
  )!;
async function click(name: string) {
  expect(button(name)).toBeTruthy();
  await act(async () => button(name).click());
}
async function tick() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function anchor(path: string) {
  const link = container.querySelector<HTMLAnchorElement>(`a[href="${path}"]`)!;
  expect(link).toBeTruthy();
  await act(async () =>
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    ),
  );
}
async function confirm() {
  await act(async () =>
    container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click(),
  );
}
const actions = () =>
  vi.mocked(api.post).mock.calls.filter(([p]) => p === endpoint + "/actions");
beforeEach(() => {
  setUiLocale("en");
  vi.clearAllMocks();
  localStorage.clear();
  role = "admin";
  account = "00000000-0000-4000-8000-000000000001";
  record = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(salesAssignmentApi.reps).mockResolvedValue([
    { id: rep, name: "New Rep" },
  ]);
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith(endpoint + "/companies"))
      return {
        items: data().items.map((i) => ({ id: i.companyId, name: i.name })),
        hasMore: false,
        ownership: "commerce",
        sourceFreshness: "unverified",
      };
    if (path.startsWith(endpoint + "/requests/")) {
      if (record) return record;
      throw missing();
    }
    throw Error("Unexpected read " + path);
  });
  vi.mocked(api.post).mockImplementation(async (path: string, raw: unknown) => {
    if (path === endpoint + "/review") return data();
    if (path === endpoint + "/actions") {
      record = receipt(raw as AssignmentPacket);
      return record;
    }
    throw Error("Unexpected mutation " + path);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("keeps the existing entry and uses real selection plus separate navigable review URL", async () => {
  await render();
  expect(content()).toContain("Assign customer coverage");
  await act(async () => {
    container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click();
    const select = container.querySelector<HTMLSelectElement>("select")!;
    select.value = rep;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("Review assignment");
  expect(container.querySelector("output")!.textContent).toContain(
    "/assign/review?",
  );
  expect(actions()).toHaveLength(0);
});
it("shows company scope, previous/new owner and imported counts before explicit confirmation", async () => {
  await render(reviewPath);
  expect(content()).toContain("North Company");
  expect(content()).toContain("South Company");
  expect(content()).toContain("Previous Rep");
  expect(content()).toContain("New Rep");
  expect(content()).toContain("upstream freshness is unverified");
  expect(button("Confirm and save assignments").disabled).toBe(true);
  await confirm();
  expect(button("Confirm and save assignments").disabled).toBe(false);
});
it("persists an immutable recovery packet before dispatch and accepts only the matching receipt", async () => {
  await render(reviewPath);
  vi.mocked(api.post).mockImplementation(async (path, raw) => {
    if (path === endpoint + "/actions") {
      expect(readAssignmentJobs(account)[0].packet).toEqual(raw);
      record = receipt(raw as AssignmentPacket);
      return record;
    }
    return data();
  });
  await confirm();
  await click("Confirm and save assignments");
  expect(content()).toContain("2 companies persisted");
  expect(actions()).toHaveLength(1);
  expect(readAssignmentJobs(account)).toHaveLength(0);
});
it("locks duplicate clicks synchronously before React disables the control", async () => {
  let resolve!: (v: unknown) => void;
  vi.mocked(api.post).mockImplementation(async (path, raw) =>
    path.endsWith("/review")
      ? data()
      : new Promise((r) => {
          resolve = r;
        }),
  );
  await render(reviewPath);
  await confirm();
  await act(async () => {
    button("Confirm and save assignments").click();
    button("Confirm and save assignments").click();
  });
  expect(actions()).toHaveLength(1);
  await act(async () => resolve(receipt(actions()[0][1] as AssignmentPacket)));
});
it("cancels review with no mutation and supports browser back/forward", async () => {
  await render(reviewPath);
  await anchor(home + "/assign?" + query);
  expect(content()).toContain("Assign customer coverage");
  expect(actions()).toHaveLength(0);
  await click("Back test");
  expect(content()).toContain("Review assignment before saving");
  await click("Forward test");
  expect(content()).toContain("Assign customer coverage");
  expect(actions()).toHaveLength(0);
});
it("an interrupted successful response cannot redirect after navigating back to selection", async () => {
  let resolve!: (v: unknown) => void;
  vi.mocked(api.post).mockImplementation(async (path) =>
    path.endsWith("/review")
      ? data()
      : new Promise((r) => {
          resolve = r;
        }),
  );
  await render(reviewPath);
  await confirm();
  await click("Confirm and save assignments");
  const p = actions()[0][1] as AssignmentPacket;
  await anchor(home + "/assign?" + query);
  await act(async () => resolve(receipt(p)));
  expect(container.querySelector("output")!.textContent).toBe(
    home + "/assign?" + query,
  );
  expect(content()).toContain("Assign customer coverage");
});
it("a dropped committed response recovers the saved receipt without a second write", async () => {
  vi.mocked(api.post).mockImplementation(async (path, raw) => {
    if (path.endsWith("/review")) return data();
    record = receipt(raw as AssignmentPacket);
    throw Error("Connection dropped after commit");
  });
  await render(reviewPath);
  await confirm();
  await click("Confirm and save assignments");
  expect(content()).toContain("Save outcome is unverified");
  const job = readAssignmentJobs(account)[0];
  await anchor(home + "/requests/" + job.packet.requestId);
  expect(content()).toContain("2 companies persisted");
  expect(actions()).toHaveLength(1);
});
it("a missing receipt plus unchanged evidence enables only an explicitly confirmed original retry", async () => {
  storeAssignmentJob({ owner: account, packet: packet() });
  await render(home + "/requests/" + request);
  await tick();
  expect(content()).toContain("No committed receipt");
  expect(button("Retry original request safely").disabled).toBe(true);
  await confirm();
  await click("Retry original request safely");
  expect(actions()[0][1]).toEqual(packet());
  expect(content()).toContain("2 companies persisted");
});
it("changed ownership/customer evidence blocks blind replay", async () => {
  storeAssignmentJob({ owner: account, packet: packet() });
  vi.mocked(api.post).mockResolvedValue({
    ...data(),
    items: data().items.map((i) => ({ ...i, version: "c".repeat(64) })),
  });
  await render(home + "/requests/" + request);
  await tick();
  expect(content()).toContain("Evidence changed");
  expect(button("Retry original request safely")).toBeUndefined();
  expect(actions()).toHaveLength(0);
});
it("a failed receipt lookup cannot enable retry or report success", async () => {
  storeAssignmentJob({ owner: account, packet: packet() });
  vi.mocked(api.get).mockRejectedValue(Error("Receipt store unavailable"));
  await render(home + "/requests/" + request);
  expect(content()).toContain("Receipt store unavailable");
  expect(button("Retry original request safely")).toBeUndefined();
  await click("Retry original request");
  expect(actions()).toHaveLength(0);
});
it("a generic success response never manufactures assignment evidence", async () => {
  vi.mocked(api.post).mockImplementation(async (path) =>
    path.endsWith("/review") ? data() : { status: true },
  );
  await render(reviewPath);
  await confirm();
  await click("Confirm and save assignments");
  expect(content()).toContain("Save outcome is unverified");
  expect(content()).not.toContain("companies persisted");
  expect(readAssignmentJobs(account)).toHaveLength(1);
});
it("partial/mismatched receipt data cannot report a successful bulk assignment", async () => {
  vi.mocked(api.post).mockImplementation(async (path, raw) => {
    if (path.endsWith("/review")) return data();
    const r = receipt(raw as AssignmentPacket);
    return { ...r, appliedCount: 1, items: r.items.slice(0, 1) };
  });
  await render(reviewPath);
  await confirm();
  await click("Confirm and save assignments");
  expect(content()).toContain("Save outcome is unverified");
  expect(content()).not.toContain("companies persisted");
});
it("recovery storage failure blocks dispatch", async () => {
  await render(reviewPath);
  await confirm();
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw Error("Storage unavailable");
    });
  try {
    await click("Confirm and save assignments");
    expect(actions()).toHaveLength(0);
    expect(content()).toContain("No save was sent");
  } finally {
    storage.mockRestore();
  }
});
it("empty and failed company lists offer useful scoped feedback and retry", async () => {
  vi.mocked(api.get).mockRejectedValueOnce(Error("Source unavailable"));
  await render();
  expect(content()).toContain("Source unavailable");
  vi.mocked(api.get).mockResolvedValue({
    items: [],
    hasMore: false,
    ownership: "commerce",
    sourceFreshness: "unverified",
  });
  await click("Retry companies");
  expect(content()).toContain("No matching companies");
});
it("loading skeletons prevent review before source data is ready", async () => {
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
  await render();
  expect(container.querySelector("[role=status]")).not.toBeNull();
  expect(button("Review assignment").disabled).toBe(true);
});
it("the search bound is explicit and stale server names/IDs cannot alter the review scope", async () => {
  vi.mocked(api.get).mockResolvedValue({
    items: data().items.map((i) => ({ id: i.companyId, name: i.name })),
    hasMore: true,
    ownership: "commerce",
    sourceFreshness: "unverified",
  });
  await render();
  expect(content()).toContain("first 20 matching companies");
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.mocked(api.post).mockResolvedValue({
    ...data(),
    items: [data().items[0]],
  });
  await render(reviewPath);
  expect(content()).toContain("Review differs from the selected scope");
  expect(actions()).toHaveLength(0);
});
it.each([
  "sale",
  "business_analyst",
  "marketing",
  "merchandising",
  "cs",
  "graphic",
])(
  "%s cannot read or mutate the assignment workspace",
  async (selectedRole) => {
    await render(reviewPath, selectedRole);
    expect(content()).toContain("Only administrators");
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(salesAssignmentApi.reps).not.toHaveBeenCalled();
  },
);
it("sales manager retains existing authority and never submits a client actor override", async () => {
  await render(reviewPath, "sales_manager");
  await confirm();
  await click("Confirm and save assignments");
  expect(actions()[0][1]).not.toHaveProperty("actor");
  expect(content()).toContain("companies persisted");
});
it("owner-scoped recovery storage cannot expose another account intent and refuses packet mutation", () => {
  const p = packet();
  storeAssignmentJob({ owner: account, packet: p });
  expect(readAssignmentJobs("other")).toEqual([]);
  expect(() =>
    storeAssignmentJob({ owner: account, packet: { ...p, salesUserId: old } }),
  ).toThrow("immutable");
  expect(readAssignmentJobs(account)[0].packet).toEqual(p);
});
it("restores saved selection without posting an assignment", async () => {
  localStorage.setItem(assignmentFormKey(account), JSON.stringify(selection));
  await render();
  expect(
    [
      ...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
    ].filter((i) => i.checked),
  ).toHaveLength(2);
  expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe(rep);
  expect(actions()).toHaveLength(0);
});
it("a rejected stale save remains recoverable and requires a new review after confirmed receipt absence", async () => {
  vi.mocked(api.post).mockImplementation(async (path) => {
    if (path.endsWith("/review")) return data();
    throw Object.assign(Error("Stale"), { status: 409 });
  });
  await render(reviewPath);
  await confirm();
  await click("Confirm and save assignments");
  const job = readAssignmentJobs(account)[0];
  expect(job.rejected).toBe(true);
  await anchor(home + "/requests/" + job.packet.requestId);
  await tick();
  await click("Review again after the original request was rejected");
  expect(readAssignmentJobs(account)).toHaveLength(0);
  expect(container.querySelector("output")!.textContent).toContain("/assign?");
});

it("keeps unchanged companies visible with owner evidence and blocks confirmation", async () => {
  vi.mocked(api.post).mockResolvedValue({
    ...data(),
    items: data().items.map((i) => ({
      ...i,
      previousOwner: { id: rep, name: "New Rep" },
    })),
  });
  await render(reviewPath);
  expect(content()).toContain(
    "These companies already have the selected owner",
  );
  expect(content()).toContain("North Company");
  expect(content()).toContain("South Company");
  expect(button("Confirm and save assignments").disabled).toBe(true);
  expect(
    container.querySelector<HTMLInputElement>("input[type=checkbox]")!.disabled,
  ).toBe(true);
  expect(actions()).toHaveLength(0);
});
