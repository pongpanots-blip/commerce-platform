// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { fixtureInputs } from "../../../../../commerce-platform/src/modules/integration/pack-price-planning/pack-fixtures";
import {
  comparisonWorkspaceSchema,
  comparisonRows,
} from "../../../../../commerce-platform/src/modules/integration/competitor-prices/comparison-contracts";
import {
  batchDraftSchema,
  batchIsStale,
  batchPacket,
  emptyBatch,
  readBatch,
  storeBatch,
} from "./comparison-batch";
function workspace() {
  const inputs = fixtureInputs();
  return comparisonWorkspaceSchema.parse({
    sku: inputs.sku,
    inputs,
    sourceFingerprint: inputs.sourceFingerprint,
    capturedAt: inputs.capturedAt,
    upstreamFreshness: "unverified",
    observationsTruncated: false,
    rows: comparisonRows(
      inputs,
      inputs.observations.map((o) => ({
        id: o.id,
        sourceId: null,
        sourceName: "Synthetic vendor",
        sourceUrl: "https://vendor.example.invalid/" + o.id,
        context: "Recorded terms",
        ourProductVersion: "b".repeat(64),
        relationship: "uncertain",
      })),
    ),
  });
}
const requestId = "00000000-0000-4000-8000-000000000099";
const draft = () => {
  const w = workspace();
  return {
    ...emptyBatch(w),
    choices: w.rows.map((r, i) => ({
      pairId: r.id,
      revision: r.revision,
      decision: i ? ("remove" as const) : ("same_product" as const),
      note: "Explicitly reviewed synthetic evidence",
    })),
  };
};
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("starts empty and sends only explicit decisions, without accepting suggestions or marking the SKU reviewed", () => {
  const w = workspace();
  expect(emptyBatch(w).choices).toEqual([]);
  expect(() => batchPacket(emptyBatch(w), w, requestId)).toThrow();
  const packet = batchPacket(draft(), w, requestId);
  expect(packet.commands.map((c) => c.operation)).toEqual(["verify", "remove"]);
  expect(packet.commands[0]).toMatchObject({
    relationship: "same_product",
    revision: w.rows[0].revision,
  });
});
it.each(["source", "revision", "sku", "missing"] as const)(
  "blocks retained choices after %s changes",
  (kind) => {
    const w = workspace();
    const d = draft();
    if (kind === "source") w.sourceFingerprint = "c".repeat(64);
    if (kind === "revision") w.rows[0].revision++;
    if (kind === "sku") w.sku = "OTHER-SKU";
    if (kind === "missing") w.rows = [];
    expect(batchIsStale(d, w)).toBe(true);
    expect(() => batchPacket(d, w, requestId)).toThrow("changed");
  },
);
it("rejects duplicate pairs, more than 20, unreviewed reasons and unsupported decision values", () => {
  const d = draft();
  expect(
    batchDraftSchema.safeParse({ ...d, choices: [d.choices[0], d.choices[0]] })
      .success,
  ).toBe(false);
  expect(
    batchDraftSchema.safeParse({ ...d, choices: Array(21).fill(d.choices[0]) })
      .success,
  ).toBe(false);
  expect(() =>
    batchPacket(
      { ...d, choices: [{ ...d.choices[0], note: "short" }] },
      workspace(),
      requestId,
    ),
  ).toThrow();
  expect(
    batchDraftSchema.safeParse({
      ...d,
      choices: [{ ...d.choices[0], decision: "refresh" }],
    }).success,
  ).toBe(false);
});
it("restores only this account and SKU, preserving original revisions and source identity", () => {
  const d = draft();
  storeBatch("owner-a", d);
  expect(readBatch("owner-a", d.sku)).toEqual(d);
  expect(readBatch("owner-b", d.sku)).toBeNull();
  expect(readBatch("owner-a", "OTHER-SKU")).toBeNull();
});
it("fails storage verification when local persistence silently loses the chosen decisions", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  expect(() => storeBatch("owner", draft())).toThrow("storage");
  expect(readBatch("owner", workspace().sku)).toBeNull();
});
