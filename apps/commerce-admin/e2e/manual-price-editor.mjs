#!/usr/bin/env node
// Run against a local admin build/server. All API responses and writes are intercepted.
// This verifies UI behavior; synthetic receipt persistence is not backend/production acceptance.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.ADMIN_URL ?? "http://127.0.0.1:4415";
assert(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "Local admin server only",
);
const output =
  process.env.MANUAL_PRICE_EDITOR_OUTPUT ?? ".e2e-out/manual-price-editor";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const checked = [],
  errors = [],
  rejectedExternalRequests = [];
let harnessFailure = null;
const home = "/product-prices/current";
const sku = "SYNTHETIC/PRICE-1";
const token =
  "s-" +
  Array.from(sku)
    .map((c) => c.codePointAt(0).toString(16))
    .join("-");
const view = home + "/" + token,
  edit = view + "/edit",
  review = view + "/review";
const id = "00000000-0000-4000-8000-000000000001";
const initial = {
  sku,
  version: "a".repeat(64),
  current: { sellingUnitPrice: "10.00", orderingPrice: "100.00", moq: 2 },
  currentRecorded: true,
  currentSource: "import",
  currentUpdatedAt: "2026-10-10T00:00:00.000Z",
  currentUpdatedBy: null,
};
const deferred = () => {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
const after = (item, patch) => ({
  sellingUnitPrice:
    patch.sellingUnitPrice === undefined
      ? item.current.sellingUnitPrice
      : patch.sellingUnitPrice === null
        ? null
        : patch.sellingUnitPrice.toFixed(2),
  orderingPrice:
    patch.orderingPrice === undefined
      ? item.current.orderingPrice
      : patch.orderingPrice === null
        ? null
        : patch.orderingPrice.toFixed(2),
  moq: patch.moq === undefined ? item.current.moq : patch.moq,
});
async function open(path = home, options = {}) {
  const context = await browser.newContext({
    viewport: options.phone
      ? { width: 320, height: 740 }
      : { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const role = options.role ?? "admin",
    claims = Buffer.from(
      JSON.stringify({
        sub: "fixture-owner",
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
          currentRecorded: false,
          current: { sellingUnitPrice: null, orderingPrice: null, moq: null },
          currentSource: null,
          currentUpdatedAt: null,
        }
      : structuredClone(initial),
    ownership: options.josh ? "josh" : "commerce",
    reads: [],
    writes: [],
    receipt: null,
    ...options,
  };
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
    const answer = (json, status = 200) => route.fulfill({ status, json });
    if (request.method() === "GET") state.reads.push(path);
    if (path === "/admin/auth/me")
      return answer({
        userId: "fixture-owner",
        email: "fixture@example.invalid",
        role,
        mustChangePassword: false,
      });
    if (path === "/reports/health") return answer({ now: { problems: [] } });
    if (path === "/admin/stats") return answer({ webhooksFailed: 0 });
    if (path === "/ownership")
      return answer({ prices: state.ownership === "commerce" });
    if (path === "/product-prices" && request.method() === "GET") {
      if (state.listGate) await state.listGate.promise;
      if (state.failList) {
        state.failList = false;
        return answer({ message: "Synthetic list unavailable" }, 503);
      }
      const item = state.item;
      return answer({
        items:
          state.empty || !item.currentRecorded
            ? []
            : [
                {
                  sku: item.sku,
                  selling_unit_price: item.current.sellingUnitPrice,
                  ordering_price: item.current.orderingPrice,
                  moq: item.current.moq,
                  source: item.currentSource ?? "import",
                  updated_by: item.currentUpdatedBy,
                  updated_at: item.currentUpdatedAt ?? initial.currentUpdatedAt,
                },
              ],
        total: state.empty || !item.currentRecorded ? 0 : 1,
        page: Number(url.searchParams.get("page")) || 1,
        limit: Number(url.searchParams.get("limit")) || 20,
      });
    }
    if (path.startsWith("/product-evidence/")) {
      // The source adapter has its own contract tests. No synthetic cost/stock is fabricated here.
      return answer(
        {
          message:
            "Source evidence is unavailable in this isolated editor fixture",
        },
        503,
      );
    }
    if (path.startsWith("/product-prices/editor/items/"))
      return answer({ item: state.item, ownership: state.ownership });
    if (path.startsWith("/product-prices/editor/requests/")) {
      if (state.failReceipt) {
        state.failReceipt = false;
        return answer({ message: "Synthetic receipt lookup unavailable" }, 503);
      }
      return state.receipt
        ? answer(state.receipt)
        : answer({ message: "Original request absent" }, 404);
    }
    if (path === "/product-prices/editor/review") {
      const packet = request.postDataJSON();
      if (state.failReview) {
        state.failReview = false;
        return answer({ message: "Synthetic review unavailable" }, 503);
      }
      return answer({
        item: state.item,
        patch: packet.patch,
        after: after(state.item, packet.patch),
        ownership: state.ownership,
        capturedAt: "2026-10-10T00:01:00.000Z",
      });
    }
    if (path === "/product-prices/editor/actions") {
      const packet = request.postDataJSON();
      state.writes.push(packet);
      state.actionSeen?.release();
      if (state.actionGate) await state.actionGate.promise;
      if (state.conflict)
        return answer({ message: "Synthetic evidence changed" }, 409);
      if (state.failAction) {
        state.failAction = false;
        return answer({ message: "Synthetic interrupted write" }, 503);
      }
      if (state.receipt) {
        assert.deepEqual(packet, state.receipt.packet);
        return answer({ ...state.receipt, replayed: true });
      }
      state.receipt = {
        kind: "product_price_edit",
        scenario: { kind: "product_price_edit" },
        id: packet.requestId,
        requestId: packet.requestId,
        packet,
        status: "committed",
        persisted: true,
        savedAt: "2026-10-10T00:02:00.000Z",
        before: state.item,
        after: after(state.item, packet.patch),
        appliedCount: 1,
        source: "staff",
        updatedBy: "fixture-owner",
        outboxEnqueued: true,
        downstreamDelivery: "unverified",
      };
      if (state.loseReply) {
        state.loseReply = false;
        return route.abort("failed");
      }
      return answer(state.receipt);
    }
    if (request.method() !== "GET")
      return answer({ message: "Unexpected synthetic write prohibited" }, 500);
    return answer([]);
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  await page.locator("main").waitFor();
  return { page, context, state };
}
async function setPrice(page, value = "12.50") {
  await page
    .getByLabel("Price per selling unit — change", { exact: true })
    .selectOption("set");
  await page
    .getByRole("spinbutton", {
      name: "Price per selling unit — new value",
      exact: true,
    })
    .fill(value);
}
async function prepare(page) {
  await setPrice(page);
  await page
    .getByRole("button", { name: "Review price edit", exact: true })
    .click();
  await page.waitForURL("**/review");
  await page
    .getByRole("checkbox", { name: "Confirm reviewed price edit" })
    .waitFor();
}
async function save(page) {
  await page
    .getByRole("checkbox", { name: "Confirm reviewed price edit" })
    .check();
  await page
    .getByRole("button", { name: "Save reviewed price edit", exact: true })
    .click();
}
async function screen(page, name) {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page should fit viewport",
  );
  await page.screenshot({ path: output + "/" + name + ".png", fullPage: true });
}
try {
  {
    const gate = deferred(),
      { page, context, state } = await open(home, { listGate: gate });
    await page.locator("main [aria-busy=true]").waitFor();
    assert.equal(
      await page
        .getByText("Recorded price records: 0", { exact: true })
        .count(),
      0,
    );
    gate.release();
    state.listGate = null;
    await page
      .getByRole("link", { name: "Inspect price", exact: true })
      .click();
    await page.waitForURL("**/" + token);
    await page
      .getByRole("heading", { name: "Inspect product price" })
      .waitFor();
    await page
      .getByRole("link", { name: "Edit inspected price", exact: true })
      .click();
    await setPrice(page, "0");
    await page
      .getByLabel("Price per ordering unit — change", { exact: true })
      .selectOption("clear");
    await page
      .getByRole("button", { name: "Review price edit", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Confirm reviewed price edit" })
      .check();
    await page.goBack();
    await page
      .getByRole("spinbutton", {
        name: "Price per selling unit — new value",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole("spinbutton", {
          name: "Price per selling unit — new value",
          exact: true,
        })
        .inputValue(),
      "0",
    );
    await page.goForward();
    await page
      .getByRole("checkbox", { name: "Confirm reviewed price edit" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Confirm reviewed price edit" })
        .isChecked(),
      false,
    );
    state.actionGate = deferred();
    state.actionSeen = deferred();
    await page
      .getByRole("checkbox", { name: "Confirm reviewed price edit" })
      .check();
    await page
      .getByRole("button", { name: "Save reviewed price edit", exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await state.actionSeen.promise;
    await page
      .getByText(
        "Saving the original request. Waiting for a confirmed outcome.",
        { exact: true },
      )
      .waitFor();
    assert.equal(state.writes.length, 1);
    assert.equal(state.receipt, null);
    assert.deepEqual(state.writes[0].patch, {
      sellingUnitPrice: 0,
      orderingPrice: null,
    });
    assert.equal(await page.getByText("Saved", { exact: true }).count(), 0);
    state.actionGate.release();
    state.actionGate = null;
    await page
      .getByText("Saved price edit for 1 SKU", { exact: true })
      .waitFor();
    assert.match(new URL(page.url()).pathname, /\/requests\//);
    assert.equal(state.writes.length, 1);
    assert.equal(
      (await page
        .getByText("Shop delivery remains unverified.", { exact: false })
        .count()) >= 1,
      true,
    );
    await screen(page, "desktop-verified-outcome");
    checked.push(
      "Canonical inspect/edit/review/outcome, retained back/forward fields, new confirmation, duplicate click lock, zero/clear/omitted semantics and persistence-only badge",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(edit, { phone: true });
    await page
      .getByLabel("Price per selling unit — change", { exact: true })
      .waitFor();
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await menu.click();
    assert.equal(await menu.getAttribute("aria-expanded"), "true");
    await menu.click();
    assert.equal(await menu.getAttribute("aria-expanded"), "false");
    await setPrice(page, "12.345");
    await page
      .getByRole("button", { name: "Review price edit", exact: true })
      .click();
    const price = page.getByRole("spinbutton", {
      name: "Price per selling unit — new value",
      exact: true,
    });
    assert.equal(await price.getAttribute("aria-invalid"), "true");
    assert(await price.evaluate((input) => input === document.activeElement));
    await price.fill("12.50");
    await page
      .getByRole("button", { name: "Review price edit", exact: true })
      .click();
    const confirm = page.getByRole("checkbox", {
      name: "Confirm reviewed price edit",
    });
    await confirm.focus();
    await page.keyboard.press("Space");
    assert.equal(await confirm.isChecked(), true);
    await screen(page, "phone-keyboard-review");
    assert.equal(state.writes.length, 0);
    checked.push(
      "320px phone layout, expandable navigation, labeled errors and focus, keyboard review confirmation without writes",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(edit, { loseReply: true });
    await prepare(page);
    await save(page);
    await page
      .getByText("Saved price edit for 1 SKU", { exact: true })
      .waitFor();
    assert.equal(state.writes.length, 1);
    assert(state.reads.some((path) => path.includes("/requests/")));
    checked.push(
      "Lost post-commit reply recovers the persisted original receipt before resending",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(edit, { failAction: true });
    await prepare(page);
    await save(page);
    await page
      .getByText(
        "No committed edit found for this account. Completion is unconfirmed.",
        { exact: true },
      )
      .waitFor();
    const retry = page.getByRole("button", {
      name: "Retry checked original edit",
      exact: true,
    });
    assert.equal(await retry.isDisabled(), true);
    await page
      .getByRole("checkbox", { name: "Confirm exact original edit retry" })
      .check();
    await retry.click();
    await page
      .getByText("Saved price edit for 1 SKU", { exact: true })
      .waitFor();
    assert.equal(state.writes.length, 2);
    assert.deepEqual(state.writes[0], state.writes[1]);
    checked.push(
      "Pre-commit interruption checks absence and resends only the same immutable request",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(edit, { conflict: true });
    await prepare(page);
    await save(page);
    await page
      .getByRole("button", {
        name: "Dismiss uncommitted stale edit",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", {
          name: "Retry checked original edit",
          exact: true,
        })
        .count(),
      0,
    );
    assert.equal(await page.getByText("Saved", { exact: true }).count(), 0);
    assert.equal(state.writes.length, 1);
    checked.push(
      "Changed evidence retains the original intent and blocks automatic/stale retry",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(home, { failList: true });
    await page
      .locator("main")
      .getByRole("button", { name: "Try again", exact: true })
      .click();
    await page
      .getByText("Recorded price records: 1", { exact: true })
      .waitFor();
    assert.equal(state.writes.length, 0);
    checked.push(
      "List read failure has a working retry and authoritative recorded count",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(
      home + "?search=" + encodeURIComponent(sku),
      { noCurrent: true },
    );
    await page
      .getByRole("link", {
        name: "Inspect this exact SKU in known products",
        exact: true,
      })
      .click();
    await page.getByText("No price record", { exact: true }).waitFor();
    await page
      .getByRole("link", { name: "Edit inspected price", exact: true })
      .click();
    await prepare(page);
    await save(page);
    await page
      .getByText("Saved price edit for 1 SKU", { exact: true })
      .waitFor();
    assert.equal(state.receipt.before.currentRecorded, false);
    assert.deepEqual(state.receipt.after, {
      sellingUnitPrice: "12.50",
      orderingPrice: null,
      moq: null,
    });
    assert.equal(
      await page
        .getByText(
          "This known product has no current price record. Saving creates a price row with only the selected fields.",
          { exact: true },
        )
        .count(),
      0,
    );
    await screen(page, "first-record-outcome");
    checked.push(
      "Empty recorded list discovers a known SKU, creates only selected values and avoids pre-save warning on committed receipt",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(view, { josh: true });
    await page
      .getByText(
        "Josh still owns prices. Retained commerce values may differ from the current Josh price. Editing is unavailable here.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Edit inspected price", exact: true })
        .count(),
      0,
    );
    assert.equal(state.writes.length, 0);
    checked.push(
      "Ownership-disabled inspection labels retained commerce evidence and exposes no edit",
    );
    await context.close();
  }
  {
    const { page, context, state } = await open(edit, {
      role: "business_analyst",
    });
    await page.locator("main").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Review price edit", exact: true })
        .count(),
      0,
    );
    assert.equal(
      state.reads.filter((path) => path.startsWith("/product-prices/editor/"))
        .length,
      0,
    );
    assert.equal(state.writes.length, 0);
    checked.push(
      "Unauthorised BA cannot read or submit manual price edit despite a deep link",
    );
    await context.close();
  }
  assert.deepEqual(errors, [], "No JavaScript page errors");
  console.log(
    "PASS: " +
      checked.length +
      " manual price editor browser scenarios; intercepted local fixtures only",
  );
} catch (error) {
  harnessFailure = error instanceof Error ? error.message : String(error);
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .at(-1);
  if (page && !page.isClosed()) {
    try {
      await page.screenshot({
        path: output + "/failure.png",
        fullPage: true,
        timeout: 5000,
      });
      writeFileSync(output + "/failure-dom.html", await page.content());
      writeFileSync(
        output + "/failure-state.json",
        JSON.stringify({ url: page.url(), harnessFailure }, null, 2),
      );
    } catch {
      /* Keep the original failure if capture is unavailable. */
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
      },
      null,
      2,
    ),
  );
  await browser.close();
}
