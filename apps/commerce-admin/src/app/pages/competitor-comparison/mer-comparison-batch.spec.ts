import { expect, it } from "vitest";
import { fixtureInputs } from "../../../../../commerce-platform/src/modules/integration/pack-price-planning/pack-fixtures";
import {
  comparisonRows,
  comparisonWorkspaceSchema,
} from "../../../../../commerce-platform/src/modules/integration/competitor-prices/comparison-contracts";
import {
  authorizedBatchPacket,
  batchChoicesAllowed,
  emptyBatch,
  type BatchDraft,
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
        context: "Recorded price terms",
        ourProductVersion: "b".repeat(64),
        relationship: "uncertain",
      })),
    ),
  });
}
const requestId = "00000000-0000-4000-8000-000000000099";

it("MER submits explicit verification decisions without modifying the retained draft", () => {
  const w = workspace();
  const draft: BatchDraft = {
    ...emptyBatch(w),
    choices: w.rows.map((row) => ({
      pairId: row.id,
      revision: row.revision,
      decision: "same_product",
      note: "Reviewed exact source and product identity",
    })),
  };
  const before = structuredClone(draft);
  expect(batchChoicesAllowed(draft, "merchandising")).toBe(true);
  const packet = authorizedBatchPacket(draft, w, requestId, "merchandising");
  expect(packet.commands.map((command) => command.operation)).toEqual([
    "verify",
    "verify",
  ]);
  expect(draft).toEqual(before);
  expect(() =>
    authorizedBatchPacket(draft, w, requestId, "business_analyst"),
  ).toThrow("permissions");
});

it("a role change cannot partially submit a retained verify/remove batch", () => {
  const w = workspace();
  const draft: BatchDraft = {
    ...emptyBatch(w),
    choices: w.rows.map((row, index) => ({
      pairId: row.id,
      revision: row.revision,
      decision: index ? "remove" : "same_product",
      note: "Explicit historical decision before the role change",
    })),
  };
  expect(batchChoicesAllowed(draft, "merchandising")).toBe(false);
  expect(() =>
    authorizedBatchPacket(draft, w, requestId, "merchandising"),
  ).toThrow("permissions");
  for (const role of ["admin", "marketing"])
    expect(
      authorizedBatchPacket(draft, w, requestId, role).commands.map(
        (command) => command.operation,
      ),
    ).toEqual(["verify", "remove"]);
  expect(draft.choices).toHaveLength(2);
  expect(draft.choices[1].decision).toBe("remove");
});

it("MER still needs current source/revision and explicit nonempty decisions", () => {
  const w = workspace();
  expect(() =>
    authorizedBatchPacket(emptyBatch(w), w, requestId, "merchandising"),
  ).toThrow();
  const draft: BatchDraft = {
    ...emptyBatch(w),
    choices: [
      {
        pairId: w.rows[0].id,
        revision: w.rows[0].revision - 1,
        decision: "same_product",
        note: "Reviewed exact source and product identity",
      },
    ],
  };
  expect(() =>
    authorizedBatchPacket(draft, w, requestId, "merchandising"),
  ).toThrow();
});
