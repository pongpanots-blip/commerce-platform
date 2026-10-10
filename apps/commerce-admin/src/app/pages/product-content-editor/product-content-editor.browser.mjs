#!/usr/bin/env node
// Local intercepted UI fixtures only. This harness never reaches a real backend or captures images.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.ADMIN_URL ?? "http://127.0.0.1:4415";
assert(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "Local admin server only",
);
const output =
  process.env.PRODUCT_CONTENT_EDITOR_OUTPUT ??
  ".e2e-out/product-content-editor";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const productId = "00000000-0000-4000-8000-000000000001";
const owner = "fixture-owner";
const home = "/j/product/" + productId + "/content",
  edit = home + "/edit",
  review = home + "/review";
const initial = {
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
const checked = [],
  errors = [],
  rejectedExternalRequests = [];
let harnessFailure = null;
const deferred = () => {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
async function open(path = edit, options = {}) {
  const context = await browser.newContext({
    viewport: options.phone
      ? { width: 320, height: 740 }
      : { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const role = options.role ?? "admin";
  const claims = Buffer.from(
    JSON.stringify({
      sub: owner,
      email: "fixture@example.invalid",
      role,
      exp: 4102444800,
    }),
  ).toString("base64url");
  await context.addInitScript(
    ({ claims }) => {
      sessionStorage.setItem("cp_admin_token", "e30." + claims + ".fixture");
      localStorage.setItem("cp_ui_locale", "en");
    },
    { claims },
  );
  const state = {
    item: options.noCurrent
      ? {
          ...initial,
          current: {},
          currentRecorded: false,
          currentSource: null,
          currentUpdatedAt: null,
          evidenceSource: "unavailable",
        }
      : structuredClone(initial),
    ownership: options.josh ? "josh" : "commerce",
    reads: [],
    writes: [],
    relays: [],
    receipt: null,
    unexpected: [],
    ...options,
  };
  if (options.josh) state.item.evidenceSource = "archived_native";
  await context.route("**/*", (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (["127.0.0.1", "localhost"].includes(hostname)) return route.continue();
    rejectedExternalRequests.push(hostname);
    return route.abort();
  });
  await context.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace(/^\/api/, "");
    const answer = (json, status = 200) => route.fulfill({ json, status });
    if (request.method() === "GET") state.reads.push(path);
    if (path === "/admin/auth/me")
      return answer({
        userId: owner,
        email: "fixture@example.invalid",
        role,
        mustChangePassword: false,
      });
    if (path === "/reports/health") return answer({ now: { problems: [] } });
    if (path === "/admin/stats") return answer({ webhooksFailed: 0 });
    if (path === "/ownership")
      return answer({
        productContent: state.ownership === "commerce",
        productMaster: false,
        ordering: false,
        prices: false,
        productImages: false,
        promotions: false,
        catalog: false,
      });
    if (path === "/josh/admin-call") {
      const relay = request.postDataJSON();
      state.relays.push(relay);
      if (relay.method === "GET" && relay.path === "/product/admin/list") {
        return answer({
          data: [
            {
              product_inventory_id: productId,
              product_inventory_sku: initial.sku,
              product_name: "Catalog fixture name",
              product_status: "active",
              media: [],
              // Existing catalog displays these copied fields. They are deliberately absent in the editor.
              selling_unit_price: null,
              product_inventory_quantity: null,
            },
          ],
          totalCount: 1,
          page: 1,
        });
      }
      state.unexpected.push(relay);
      return answer({ message: "Unexpected broader relay prohibited" }, 500);
    }
    if (path === "/product-content-editor/items/" + productId) {
      if (state.itemGate) await state.itemGate.promise;
      if (state.failItem) {
        state.failItem = false;
        return answer({ message: "Synthetic native source unavailable" }, 503);
      }
      return answer({ item: state.item, ownership: state.ownership });
    }
    if (path.startsWith("/product-content-editor/requests/")) {
      if (state.receiptGate) await state.receiptGate.promise;
      if (state.failReceipt) {
        state.failReceipt = false;
        return answer({ message: "Synthetic receipt read unavailable" }, 503);
      }
      return state.receipt
        ? answer(state.receipt)
        : answer({ message: "Original request absent" }, 404);
    }
    if (path === "/product-content-editor/review") {
      const selection = request.postDataJSON();
      if (state.failReview) {
        state.failReview = false;
        return answer({ message: "Synthetic stale content baseline" }, 409);
      }
      assert.deepEqual(Object.keys(selection).sort(), [
        "fields",
        "productId",
        "sku",
        "version",
      ]);
      return answer({
        item: state.item,
        fields: selection.fields,
        after: { ...state.item.current, ...selection.fields },
        ownership: state.ownership,
        capturedAt: "2026-10-10T00:01:00.000Z",
      });
    }
    if (path === "/josh/products/" + productId + "/update") {
      const envelope = request.postDataJSON();
      assert.deepEqual(Object.keys(envelope).sort(), ["contentEdit", "fields"]);
      assert.deepEqual(Object.keys(envelope.contentEdit).sort(), [
        "requestId",
        "sku",
        "version",
      ]);
      assert(
        Object.keys(envelope.fields).every((field) =>
          [
            "product_name_th",
            "product_name_en",
            "product_description_th",
            "product_description_en",
            "ingredients",
            "allergens",
          ].includes(field),
        ),
      );
      state.writes.push(envelope);
      state.writeSeen?.release();
      if (state.writeGate) await state.writeGate.promise;
      if (state.conflict) return answer({ message: "Synthetic conflict" }, 409);
      if (state.failWrite) {
        state.failWrite = false;
        return answer({ message: "Synthetic interrupted write" }, 503);
      }
      const packet = {
        productId,
        ...envelope.contentEdit,
        fields: envelope.fields,
      };
      if (state.receipt) {
        assert.deepEqual(packet, state.receipt.packet);
        return answer({ ...state.receipt, replayed: true });
      }
      state.receipt = {
        kind: "product_content_edit",
        scenario: { kind: "product_content_edit" },
        id: packet.requestId,
        requestId: packet.requestId,
        packet,
        status: "committed",
        persisted: true,
        savedAt: "2026-10-10T00:02:00.000Z",
        before: structuredClone(state.item),
        after: { ...state.item.current, ...packet.fields },
        appliedCount: 1,
        source: "staff",
        updatedBy: owner,
        outboxEnqueued: true,
        downstreamDelivery: "unverified",
      };
      if (state.loseReply) {
        state.loseReply = false;
        return route.abort("failed");
      }
      return answer(state.receipt);
    }
    state.unexpected.push({ path, method: request.method() });
    return answer({ message: "Unexpected fixture request prohibited" }, 500);
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  await page.locator("main").waitFor();
  return { page, context, state };
}
async function setName(page, value = "Updated name") {
  await page
    .getByRole("combobox", { name: "English name — change", exact: true })
    .selectOption("set");
  await page
    .getByRole("textbox", { name: "English name — new text", exact: true })
    .fill(value);
}
async function prepare(page) {
  await setName(page);
  await page
    .getByRole("combobox", { name: "Ingredients — change", exact: true })
    .selectOption("clear");
  await page
    .getByRole("button", { name: "Review content edit", exact: true })
    .click();
  await page.waitForURL("**/review");
  await page
    .getByRole("checkbox", { name: "Confirm reviewed content edit" })
    .waitFor();
}
async function save(page) {
  await page
    .getByRole("checkbox", { name: "Confirm reviewed content edit" })
    .check();
  await page
    .getByRole("button", { name: "Save reviewed content edit", exact: true })
    .click();
}
async function fits(page) {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page fits viewport",
  );
}
async function completed(page) {
  await page
    .getByText("Saved content edit for 1 product", { exact: true })
    .waitFor();
}
try {
  for (const phone of [false, true]) {
    const { page, context, state } = await open("/j/allproducts", {
      role: "graphic",
      phone,
    });
    const entry = page.getByRole("link", { name: "Edit product content" });
    await entry.first().waitFor();
    assert.equal(await entry.filter({ visible: true }).count(), 1);
    await entry.filter({ visible: true }).click();
    await page.waitForURL("**" + home);
    await page
      .getByRole("heading", { name: "Inspect product content" })
      .waitFor();
    assert.equal(
      await page.getByRole("link", { name: "Open product detail" }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("link", { name: "Back to product catalog" }).count(),
      1,
    );
    assert.equal(
      state.relays.some((relay) =>
        /^\/product\/[a-f0-9-]{36}$/.test(relay.path),
      ),
      false,
    );
    await page
      .getByRole("link", { name: "Edit inspected content", exact: true })
      .click();
    await setName(page, " ");
    await page
      .getByRole("button", { name: "Review content edit", exact: true })
      .click();
    const input = page.getByRole("textbox", {
      name: "English name — new text",
      exact: true,
    });
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    assert(await input.evaluate((node) => node === document.activeElement));
    await input.fill("Updated name");
    await page
      .getByRole("button", { name: "Review content edit", exact: true })
      .click();
    const confirmation = page.getByRole("checkbox", {
      name: "Confirm reviewed content edit",
    });
    await confirmation.focus();
    await page.keyboard.press("Space");
    assert.equal(await confirmation.isChecked(), true);
    await fits(page);
    if (phone) {
      const menu = page.getByRole("button", { name: "Menu", exact: true });
      await menu.click();
      assert.equal(await menu.getAttribute("aria-expanded"), "true");
      await menu.click();
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
      await fits(page);
    }
    assert.equal(state.writes.length, 0);
    assert.deepEqual(state.unexpected, []);
    checked.push(
      (phone ? "320px phone" : "desktop") +
        " Graphic catalog canonical entry, no broader detail read, six-field editor, labeled validation/focus and keyboard confirmation",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(edit);
    await prepare(page);
    await page
      .getByRole("checkbox", { name: "Confirm reviewed content edit" })
      .check();
    await page.goBack();
    await page
      .getByRole("textbox", { name: "English name — new text", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "English name — new text", exact: true })
        .inputValue(),
      "Updated name",
    );
    await page.goForward();
    const checkbox = page.getByRole("checkbox", {
      name: "Confirm reviewed content edit",
    });
    await checkbox.waitFor();
    assert.equal(await checkbox.isChecked(), false);
    state.writeGate = deferred();
    state.writeSeen = deferred();
    state.receiptGate = deferred();
    await checkbox.check();
    const button = page.getByRole("button", {
      name: "Save reviewed content edit",
      exact: true,
    });
    await button.evaluate((node) => {
      node.click();
      node.click();
    });
    await state.writeSeen.promise;
    assert.equal(state.writes.length, 1);
    assert.equal(await page.getByText("Saved", { exact: true }).count(), 0);
    state.writeGate.release();
    await page.waitForURL("**/requests/*");
    await page.locator("main [aria-busy=true]").waitFor();
    assert.equal(await page.getByText("Saved", { exact: true }).count(), 0);
    state.receiptGate.release();
    await completed(page);
    assert.deepEqual(state.receipt.packet.fields, {
      product_name_en: "Updated name",
      ingredients: null,
    });
    assert.equal(Object.hasOwn(state.receipt.after, "allergens"), false);
    await fits(page);
    checked.push(
      "Back/forward preserves edit and resets confirmation; duplicate clicks lock; success waits for original persisted receipt; kept missing fields stay missing",
    );
    await context.close();
  }
  {
    const gate = deferred(),
      { page, context, state } = await open(edit, {
        itemGate: gate,
        failItem: true,
      });
    await page.locator("main [aria-busy=true]").waitFor();
    assert.equal(await page.locator("main").getByRole("combobox").count(), 0);
    gate.release();
    state.itemGate = null;
    await page
      .getByText("Synthetic native source unavailable", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Review content edit", exact: true })
        .count(),
      0,
    );
    await page
      .locator("main")
      .getByRole("button", { name: "Try again", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "English name — change", exact: true })
      .waitFor();
    assert.equal(state.writes.length, 0);
    checked.push(
      "Loading skeleton and failed native source disable editing; successful read retry restores controls",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(edit, { loseReply: true });
    await prepare(page);
    await save(page);
    await completed(page);
    assert.equal(state.writes.length, 1);
    assert(state.reads.some((path) => path.includes("/requests/")));
    checked.push(
      "Lost post-commit acknowledgement recovers original receipt without repeating persistence",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(edit, {
      failWrite: true,
      failReceipt: true,
    });
    await prepare(page);
    await save(page);
    await page
      .getByText("Synthetic receipt read unavailable", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", {
          name: "Retry checked original content edit",
          exact: true,
        })
        .count(),
      0,
    );
    await page
      .locator("main")
      .getByRole("button", { name: "Try again", exact: true })
      .click();
    const retry = page.getByRole("button", {
      name: "Retry checked original content edit",
      exact: true,
    });
    await retry.waitFor();
    assert.equal(await retry.isDisabled(), true);
    await page
      .getByRole("checkbox", { name: "Confirm exact original content retry" })
      .check();
    await retry.click();
    await completed(page);
    assert.equal(state.writes.length, 2);
    assert.deepEqual(state.writes[0], state.writes[1]);
    checked.push(
      "Failed receipt read prevents resend; verified absence and explicit confirmation retry the same immutable request",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(edit, { conflict: true });
    await prepare(page);
    await save(page);
    await page
      .getByRole("button", {
        name: "Dismiss uncommitted stale content edit",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", {
          name: "Retry checked original content edit",
          exact: true,
        })
        .count(),
      0,
    );
    assert.equal(await page.getByText("Saved", { exact: true }).count(), 0);
    assert.equal(state.writes.length, 1);
    checked.push(
      "Stale persistence conflict retains original request and blocks retries and success badge",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(edit, { noCurrent: true });
    await page.getByText("No recorded content row", { exact: false }).waitFor();
    await page
      .getByRole("combobox", { name: "English name — change", exact: true })
      .selectOption("set");
    assert.equal(
      await page
        .getByRole("textbox", { name: "English name — new text", exact: true })
        .inputValue(),
      "",
    );
    await prepare(page);
    await save(page);
    await completed(page);
    assert.deepEqual(state.receipt.before.current, {});
    assert.deepEqual(state.receipt.after, {
      product_name_en: "Updated name",
      ingredients: null,
    });
    checked.push(
      "Known product with no native row uses empty defaults and creates only selected fields, preserving missing versus cleared values",
    );
    await context.close();
  }
  for (const role of ["admin", "graphic", "marketing"]) {
    const { page, context, state } = await open(
      role === "marketing" ? "/j/allproducts" : home,
      { role, josh: true },
    );
    if (role === "marketing") {
      await page
        .getByText("Catalog fixture name", { exact: true })
        .filter({ visible: true })
        .first()
        .waitFor();
      assert.equal(
        await page.getByRole("link", { name: "Edit product content" }).count(),
        0,
      );
    } else {
      await page
        .getByText("Josh still owns this content.", { exact: false })
        .waitFor();
      assert.equal(
        await page
          .getByRole("link", {
            name: "Edit this Josh-owned product",
            exact: true,
          })
          .count(),
        role === "admin" ? 1 : 0,
      );
      assert.equal(
        await page
          .getByRole("link", { name: "Edit inspected content", exact: true })
          .count(),
        0,
      );
    }
    assert.equal(state.writes.length, 0);
    checked.push(
      role + " task visibility and Josh-owned contextual legacy workflow",
    );
    await context.close();
  }
  assert.deepEqual(errors, [], "No JavaScript page errors");
  console.log(
    "PASS: " +
      checked.length +
      " content editor browser scenarios; intercepted local fixtures only",
  );
} catch (error) {
  harnessFailure = error instanceof Error ? error.message : String(error);
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .at(-1);
  if (page && !page.isClosed()) {
    try {
      writeFileSync(output + "/failure-dom.html", await page.content());
      writeFileSync(
        output + "/failure-state.json",
        JSON.stringify({ url: page.url(), harnessFailure }, null, 2),
      );
    } catch {
      /* Preserve the original harness failure. */
    }
  }
  throw error;
} finally {
  writeFileSync(
    output + "/results.json",
    JSON.stringify(
      {
        checked,
        errors,
        harnessFailure,
        rejectedExternalRequests: [...new Set(rejectedExternalRequests)],
        fixtureMode: "intercepted-local-UI",
        productionRequests: 0,
        realBackendWrites: 0,
        screenshotsCaptured: 0,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
