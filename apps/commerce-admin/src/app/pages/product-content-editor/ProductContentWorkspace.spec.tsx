// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLocale } from "@cp/ui";
import { api } from "../../../lib/api";
import ProductContentWorkspace from "./ProductContentWorkspace";
import {
  editedProductContentValues,
  type ProductContentItem,
  type ProductContentPacket,
  type ProductContentReview,
  type ProductContentSelection,
  type ProductContentReceipt,
} from "../../../../../commerce-platform/src/modules/commerce/product-content-editor/product-content-editor-contracts";
import {
  initialContentForm,
  readContentForm,
  readContentJobs,
  readContentSelection,
  storeContentForm,
  storeContentJob,
  storeContentSelection,
} from "./content-editor-journal";
import {
  contentHomeUrl,
  contentEditUrl,
  contentReviewUrl,
  contentOutcomeUrl,
} from "./content-editor-routing";

vi.mock("../../../lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  session: { claims: () => ({ sub: "fixture-owner", role: "admin" }) },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const owner = "fixture-owner";
const productId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
const home = contentHomeUrl(productId),
  edit = contentEditUrl(productId),
  reviewUrl = contentReviewUrl(productId);
const baseline: ProductContentItem = {
  productId,
  sku: "SYNTHETIC/CONTENT-1",
  version: "a".repeat(64),
  current: {
    product_name_th: "ชื่อเดิม",
    product_name_en: "Recorded name",
    product_description_th: null,
    ingredients: "Recorded ingredients",
  },
  currentRecorded: true,
  currentSource: "staff",
  currentUpdatedAt: "2026-10-10T00:00:00.000Z",
  currentUpdatedBy: owner,
  evidenceSource: "native",
};
let root: Root,
  container: HTMLDivElement,
  path: string,
  navigate: ReturnType<typeof useNavigate>;
let item: ProductContentItem,
  ownership: "commerce" | "josh",
  saved: ProductContentReceipt | null;
const absent = () =>
  Object.assign(Error("Fixture original request absent"), { status: 404 });
function reviewed(selection: ProductContentSelection): ProductContentReview {
  return {
    item,
    fields: selection.fields,
    after: editedProductContentValues(item, selection.fields),
    ownership,
    capturedAt: "2026-10-10T00:01:00.000Z",
  };
}
function receipt(packet: ProductContentPacket): ProductContentReceipt {
  return {
    kind: "product_content_edit",
    scenario: { kind: "product_content_edit" },
    id: packet.requestId,
    requestId: packet.requestId,
    packet,
    status: "committed",
    persisted: true,
    savedAt: "2026-10-10T00:01:00.000Z",
    before: item,
    after: editedProductContentValues(item, packet.fields),
    appliedCount: 1,
    source: "staff",
    updatedBy: owner,
    outboxEnqueued: true,
    downstreamDelivery: "unverified",
  };
}
function selection() {
  const form = initialContentForm(item);
  form.fields.product_name_en = { mode: "set", value: "Updated name" };
  form.fields.ingredients.mode = "clear";
  storeContentForm(owner, form);
  const selected = {
    productId,
    sku: item.sku,
    version: item.version,
    fields: { product_name_en: "Updated name", ingredients: null },
  };
  storeContentSelection(owner, selected);
  return selected;
}
function original(conflict = false) {
  const packet = { ...selection(), requestId };
  return { owner, packet, review: reviewed(packet), conflict };
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function Observe() {
  navigate = useNavigate();
  path = useLocation().pathname;
  return null;
}
async function render(
  url = home,
  role = "admin",
  account = owner,
  id = productId,
) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Observe />
        <ProductContentWorkspace role={role} owner={account} productId={id} />
      </MemoryRouter>,
    ),
  );
}
const content = () => container.textContent ?? "";
const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (node) => node.textContent === name,
  )!;
async function click(name: string) {
  await act(async () => button(name).click());
}
async function confirm() {
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
}
async function choose(field: string, mode: string) {
  const node = container.querySelector<HTMLSelectElement>(
    'select[name="' + field + '-mode"]',
  )!;
  await act(async () => {
    node.value = mode;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function fill(field: string, text: string) {
  const node = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    '[name="' + field + '"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, text);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function link(url: string) {
  await act(async () =>
    container
      .querySelector<HTMLAnchorElement>('a[href="' + url + '"]')!
      .click(),
  );
}
const writes = () =>
  vi.mocked(api.post).mock.calls.filter(([url]) => url.endsWith("/update"));
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setUiLocale("en");
  item = structuredClone(baseline);
  ownership = "commerce";
  saved = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url.includes("/items/")) return { item, ownership } as never;
    if (url.includes("/requests/")) {
      if (saved) return saved as never;
      throw absent();
    }
    throw Error("Unexpected fixture read " + url);
  });
  vi.mocked(api.post).mockImplementation(async (url, body) => {
    if (url.endsWith("/review"))
      return reviewed(body as ProductContentSelection) as never;
    if (url === "/josh/products/" + productId + "/update") {
      const envelope = body as {
        fields: ProductContentSelection["fields"];
        contentEdit: { requestId: string; sku: string; version: string };
      };
      saved = receipt({
        productId,
        ...envelope.contentEdit,
        fields: envelope.fields,
      });
      return saved as never;
    }
    throw Error("Unexpected fixture write " + url);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it.each(["BA", "marketing", "customer_service", "", "admin-helper"])(
  "denies %s before reading a product or journal",
  async (role) => {
    await render(home, role);
    expect(content()).toContain("cannot access");
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  },
);
it("requires a current account and a valid product UUID before source reads", async () => {
  await render(home, "admin", "");
  expect(api.get).not.toHaveBeenCalled();
  await render("/j/product/bad/content", "admin", owner, "bad");
  expect(content()).toContain("Invalid product identity");
  expect(api.get).not.toHaveBeenCalled();
});
it.each(["admin", "merchandising", "graphic"])(
  "supports the six-field canonical task for %s",
  async (role) => {
    await render(edit, role);
    expect(container.querySelectorAll("select")).toHaveLength(6);
    expect(content()).not.toContain("buying_price");
    expect(
      container.querySelector(
        'select[name="product_name_en-mode"] option[value="clear"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        'select[name="ingredients-mode"] option[value="clear"]',
      ),
    ).not.toBeNull();
    expect(api.get).toHaveBeenCalledWith(
      "/product-content-editor/items/" + productId,
    );
  },
);
it("gives Graphic a catalog link without a forbidden broader detail read/link", async () => {
  await render(home, "graphic");
  expect(container.querySelector('a[href="/j/allproducts"]')).not.toBeNull();
  expect(
    container.querySelector('a[href="/j/product/' + productId + '"]'),
  ).toBeNull();
  expect(vi.mocked(api.get).mock.calls).toEqual([
    ["/product-content-editor/items/" + productId],
  ]);
});
it.each(["admin", "merchandising", "graphic"])(
  "preserves contextual Josh ownership workflow for %s without native saving",
  async (role) => {
    ownership = "josh";
    item.evidenceSource = "archived_native";
    await render(home, role);
    expect(content()).toContain("Josh still owns");
    expect(container.querySelector('a[href="' + edit + '"]')).toBeNull();
    expect(
      !!container.querySelector('a[href="/j/product/edit/' + productId + '"]'),
    ).toBe(role !== "graphic");
    await act(async () => navigate(edit));
    expect(container.querySelector("form")).toBeNull();
    expect(writes()).toHaveLength(0);
  },
);
it("shows unrecorded and cleared evidence separately and creates no copied defaults", async () => {
  item = {
    ...item,
    current: {},
    currentRecorded: false,
    currentSource: null,
    currentUpdatedAt: null,
    evidenceSource: "unavailable",
  };
  await render(edit);
  expect(content()).toContain("Not recorded");
  await choose("product_name_en", "set");
  expect(
    container.querySelector<HTMLInputElement>('input[name="product_name_en"]')!
      .value,
  ).toBe("");
  await fill("product_name_en", " New native name ");
  await click("Review content edit");
  expect(path).toBe(reviewUrl);
  const body = vi.mocked(api.post).mock.calls[0][1] as ProductContentSelection;
  expect(body.fields).toEqual({ product_name_en: "New native name" });
  expect(content()).toContain("Not recorded");
  expect(writes()).toHaveLength(0);
});
it("validates names and explicit text clearing before review, focusing the invalid input", async () => {
  await render(edit);
  await choose("product_name_en", "set");
  await fill("product_name_en", " ");
  await click("Review content edit");
  expect(api.post).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    container.querySelector('input[name="product_name_en"]'),
  );
  expect(document.activeElement?.getAttribute("aria-invalid")).toBe("true");
  await fill("product_name_en", " Updated name ");
  await choose("ingredients", "clear");
  await click("Review content edit");
  expect(path).toBe(reviewUrl);
  expect(content()).toContain("Cleared");
  expect(content()).toContain("Not recorded");
  expect(writes()).toHaveLength(0);
  expect(readContentSelection(owner, productId)?.fields).toEqual({
    product_name_en: "Updated name",
    ingredients: null,
  });
});
it("blocks review/save while a failed source is loading, and retries a real failed source read", async () => {
  const gate = deferred<unknown>();
  vi.mocked(api.get).mockImplementationOnce(() => gate.promise as never);
  await render(edit);
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(container.querySelector("form")).toBeNull();
  await act(async () =>
    gate.reject(
      Object.assign(Error("Native content unavailable"), { status: 503 }),
    ),
  );
  expect(content()).toContain("Native content unavailable");
  expect(container.querySelector("form")).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
  await click("Try again");
  expect(container.querySelector("form")).not.toBeNull();
});
it("retains an edit but blocks failed-source copied fallback and stale revisions until explicit reset", async () => {
  selection();
  vi.mocked(api.get).mockRejectedValueOnce(
    Object.assign(Error("Source failed"), { status: 503 }),
  );
  await render(edit);
  expect(content()).toContain("retained local baseline");
  expect(container.querySelector("form")).toBeNull();
  item.version = "b".repeat(64);
  await click("Try again");
  expect(button("Review content edit").disabled).toBe(true);
  expect(content()).toContain("Current content changed");
  await click("Start again from current content");
  expect(button("Review content edit").disabled).toBe(false);
  expect(readContentForm(owner, productId)?.item.version).toBe(item.version);
  expect(readContentForm(owner, productId)?.fields.product_name_en.mode).toBe(
    "keep",
  );
});
it("renders an empty deep-linked review without another account’s selected fields", async () => {
  selection();
  await render(reviewUrl, "graphic", "other-account");
  expect(content()).toContain("No selected content edit for this account");
  expect(api.post).not.toHaveBeenCalled();
});
it("checks deep-linked review on every back/forward arrival and resets confirmation", async () => {
  selection();
  await render(reviewUrl);
  await confirm();
  expect(button("Save reviewed content edit").disabled).toBe(false);
  await link(edit);
  await act(async () => navigate(-1));
  expect(path).toBe(reviewUrl);
  expect(button("Save reviewed content edit").disabled).toBe(true);
  expect(
    vi.mocked(api.post).mock.calls.filter(([url]) => url.endsWith("/review")),
  ).toHaveLength(2);
  await act(async () => navigate(1));
  expect(path).toBe(edit);
});
it("does not turn a stale or failed preview into a saving action, and can retry preview", async () => {
  selection();
  vi.mocked(api.post).mockRejectedValueOnce(
    Object.assign(Error("Content changed, review again"), { status: 409 }),
  );
  await render(reviewUrl);
  expect(content()).toContain("Content changed, review again");
  expect(button("Save reviewed content edit")).toBeUndefined();
  expect(writes()).toHaveLength(0);
  await click("Try again");
  expect(button("Save reviewed content edit").disabled).toBe(true);
});
it("saves only the exact six-field envelope and waits for a durable receipt lookup before success", async () => {
  selection();
  await render(reviewUrl);
  const gate = deferred<unknown>();
  const normal = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((url) =>
    url.includes("/requests/") ? (gate.promise as never) : normal(url),
  );
  await confirm();
  await click("Save reviewed content edit");
  expect(writes()).toHaveLength(1);
  const envelope = writes()[0][1] as Record<string, unknown>;
  expect(Object.keys(envelope).sort()).toEqual(["contentEdit", "fields"]);
  expect(envelope.fields).toEqual({
    product_name_en: "Updated name",
    ingredients: null,
  });
  expect(Object.keys(envelope.contentEdit as object).sort()).toEqual([
    "requestId",
    "sku",
    "version",
  ]);
  expect(path).toMatch(/\/content\/requests\/[a-f0-9-]+$/);
  expect(content()).not.toContain("Saved content edit for 1 product");
  expect(readContentJobs(owner)).toHaveLength(1);
  await act(async () => gate.resolve(saved));
  expect(content()).toContain("Saved content edit for 1 product");
  expect(content()).toContain("Shop delivery remains unverified");
  expect(readContentJobs(owner)).toHaveLength(0);
  expect(readContentForm(owner, productId)).toBeNull();
});
it("locks duplicate clicks before React disables the saving button", async () => {
  selection();
  await render(reviewUrl);
  await confirm();
  const gate = deferred<unknown>();
  vi.mocked(api.post).mockImplementationOnce(() => gate.promise as never);
  const save = button("Save reviewed content edit");
  await act(async () => {
    save.click();
    save.click();
  });
  expect(writes()).toHaveLength(1);
  expect(readContentJobs(owner)).toHaveLength(1);
  const packet = readContentJobs(owner)[0].packet;
  saved = receipt(packet);
  await act(async () => gate.resolve(saved));
  expect(content()).toContain("Saved content edit for 1 product");
});
it("keeps an interrupted write’s immutable journal when navigating away, then recovers the original receipt", async () => {
  selection();
  await render(reviewUrl);
  await confirm();
  const gate = deferred<unknown>();
  vi.mocked(api.post).mockImplementationOnce(() => gate.promise as never);
  await act(async () => button("Save reviewed content edit").click());
  const job = readContentJobs(owner)[0];
  await act(async () => navigate(home));
  expect(content()).toContain("Check original outcome");
  expect(container.querySelector('a[href="' + edit + '"]')).toBeNull();
  saved = receipt(job.packet);
  await act(async () => gate.resolve(saved));
  expect(path).toBe(home);
  expect(readContentJobs(owner)[0].packet).toEqual(job.packet);
  await link(contentOutcomeUrl(productId, job.packet.requestId));
  expect(content()).toContain("Saved content edit for 1 product");
  expect(writes()).toHaveLength(1);
});
it("recovers a lost acknowledgement from the server without another persistence request", async () => {
  selection();
  await render(reviewUrl);
  await confirm();
  vi.mocked(api.post).mockImplementationOnce(async (_url, body) => {
    const envelope = body as {
      fields: ProductContentSelection["fields"];
      contentEdit: { requestId: string; sku: string; version: string };
    };
    saved = receipt({
      productId,
      ...envelope.contentEdit,
      fields: envelope.fields,
    });
    throw Error("Fixture response interrupted after commit");
  });
  await click("Save reviewed content edit");
  expect(content()).toContain("Saved content edit for 1 product");
  expect(writes()).toHaveLength(1);
});
it("requires verified absence and fresh confirmation before retrying the exact original request", async () => {
  const job = original();
  storeContentJob(job);
  await render(contentOutcomeUrl(productId, requestId));
  expect(content()).toContain("Completion is unconfirmed");
  expect(button("Retry checked original content edit").disabled).toBe(true);
  expect(content()).not.toContain("Saved content edit for 1 product");
  await confirm();
  await click("Check original content outcome again");
  expect(button("Retry checked original content edit").disabled).toBe(true);
  await confirm();
  await click("Retry checked original content edit");
  expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toEqual({
    fields: job.packet.fields,
    contentEdit: {
      requestId,
      sku: job.packet.sku,
      version: job.packet.version,
    },
  });
  expect(content()).toContain("Saved content edit for 1 product");
});
it("does not resend when receipt lookup failed; retry only re-reads the original outcome", async () => {
  storeContentJob(original());
  vi.mocked(api.get).mockRejectedValueOnce(
    Object.assign(Error("Receipt source unavailable"), { status: 503 }),
  );
  await render(contentOutcomeUrl(productId, requestId));
  expect(content()).toContain("Receipt source unavailable");
  expect(button("Retry checked original content edit")).toBeUndefined();
  await click("Try again");
  expect(button("Retry checked original content edit").disabled).toBe(true);
  expect(writes()).toHaveLength(0);
});
it("marks a persistence conflict and blocks stale retries until the absent original is dismissed", async () => {
  selection();
  await render(reviewUrl);
  await confirm();
  vi.mocked(api.post).mockRejectedValueOnce(
    Object.assign(Error("Stale baseline"), { status: 409 }),
  );
  await click("Save reviewed content edit");
  expect(readContentJobs(owner)[0].conflict).toBe(true);
  expect(content()).toContain("Do not resend this stale request");
  expect(button("Retry checked original content edit")).toBeUndefined();
  await click("Dismiss uncommitted stale content edit");
  expect(readContentJobs(owner)).toHaveLength(0);
  expect(writes()).toHaveLength(1);
});
it.each(["actor", "persisted", "route"])(
  "rejects a mismatched %s receipt without success or journal removal",
  async (mismatch) => {
    const job = original();
    storeContentJob(job);
    saved = receipt(job.packet);
    if (mismatch === "actor") saved.updatedBy = "different-account";
    if (mismatch === "persisted")
      (saved as unknown as { persisted: boolean }).persisted = false;
    if (mismatch === "route") {
      saved.packet.productId = "00000000-0000-4000-8000-000000000099";
      saved.before.productId = saved.packet.productId;
    }
    await render(contentOutcomeUrl(productId, requestId));
    expect(content()).not.toContain("Saved content edit for 1 product");
    expect(readContentJobs(owner)).toHaveLength(1);
    expect(button("Retry checked original content edit")).toBeUndefined();
  },
);
it("blocks dispatch when recovery storage cannot retain the original intent", async () => {
  selection();
  await render(reviewUrl);
  await confirm();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("Storage quota");
  });
  await click("Save reviewed content edit");
  expect(writes()).toHaveLength(0);
  expect(content()).toContain("No content change was sent");
});
it("rejects malformed task URLs without reading or writing unrelated destinations", async () => {
  await render(home + "/requests/not-a-uuid");
  expect(content()).toContain("Content edit page not found");
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
