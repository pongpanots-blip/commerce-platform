import { z } from "zod";
import {
  comparisonUuid,
  comparisonPacketSchema,
  type ComparisonWorkspace,
} from "../../../../../commerce-platform/src/modules/integration/competitor-prices/comparison-contracts";
import { comparisonFormKey } from "./comparison-journal";
export const batchDraftSchema = z
  .object({
    sku: z.string().min(1).max(100),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    choices: z
      .array(
        z
          .object({
            pairId: comparisonUuid,
            revision: z.number().int().min(1),
            decision: z.enum([
              "uncertain",
              "same_product",
              "substitute",
              "remove",
            ]),
            note: z.string().max(900),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .refine(
    (v) => new Set(v.choices.map((c) => c.pairId)).size === v.choices.length,
    "Choose each pair once",
  );
export type BatchDraft = z.infer<typeof batchDraftSchema>;
export const batchBase = (sku: string) =>
  `/j/marketing/competitor-prices/products/${encodeURIComponent(sku)}/batch`;
export function emptyBatch(workspace: ComparisonWorkspace): BatchDraft {
  return {
    sku: workspace.sku,
    sourceFingerprint: workspace.sourceFingerprint,
    choices: [],
  };
}
export function batchIsStale(
  draft: BatchDraft,
  workspace: ComparisonWorkspace,
) {
  return (
    draft.sku !== workspace.sku ||
    draft.sourceFingerprint !== workspace.sourceFingerprint ||
    draft.choices.some(
      (c) =>
        !workspace.rows.some(
          (r) => r.id === c.pairId && r.revision === c.revision,
        ),
    )
  );
}
export function batchPacket(
  draft: BatchDraft,
  workspace: ComparisonWorkspace,
  requestId: string,
) {
  const parsed = batchDraftSchema.parse(draft);
  if (batchIsStale(parsed, workspace))
    throw Error(
      "Comparison evidence changed. Review current pairs before confirming.",
    );
  return comparisonPacketSchema.parse({
    requestId,
    sku: parsed.sku,
    sourceFingerprint: parsed.sourceFingerprint,
    commands: parsed.choices.map((c) =>
      c.decision === "remove"
        ? {
            operation: "remove",
            pairId: c.pairId,
            revision: c.revision,
            note: c.note,
          }
        : {
            operation: "verify",
            pairId: c.pairId,
            revision: c.revision,
            relationship: c.decision,
            note: c.note,
          },
    ),
  });
}
export function readBatch(owner: string, sku: string) {
  try {
    const value = batchDraftSchema.safeParse(
      JSON.parse(
        localStorage.getItem(comparisonFormKey(owner, batchBase(sku))) ??
          "null",
      ),
    );
    return value.success && value.data.sku === sku ? value.data : null;
  } catch {
    return null;
  }
}
export function storeBatch(owner: string, draft: BatchDraft) {
  const valid = batchDraftSchema.parse(draft);
  localStorage.setItem(
    comparisonFormKey(owner, batchBase(valid.sku)),
    JSON.stringify(valid),
  );
  if (JSON.stringify(readBatch(owner, valid.sku)) !== JSON.stringify(valid))
    throw Error("Recovery storage unavailable");
}
