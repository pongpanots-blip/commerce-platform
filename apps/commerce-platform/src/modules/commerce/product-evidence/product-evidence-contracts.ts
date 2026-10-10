import { z } from "zod";

const recorded = z.string().nullable();
const value = z.union([z.string(), z.number()]).nullable();
const provenance = {
  source: z.enum([
    "native",
    "archived_native",
    "copied_snapshot",
    "unavailable",
  ]),
  recordedAt: recorded,
};
export const productEvidenceSchema = z.object({
  sku: z.string(),
  capturedAt: z.string(),
  freshness: z.literal("unverified"),
  prices: z.object({
    ...provenance,
    sellingUnitPrice: value,
    orderingPrice: value,
    moq: value,
    currency: z.null(),
    taxBasis: z.null(),
  }),
  cost: z.object({
    ...provenance,
    amount: value,
    currency: z.null(),
    unit: z.null(),
    taxBasis: z.null(),
    observedAt: z.null(),
  }),
  units: z.object({
    ...provenance,
    selling: value,
    ordering: value,
    packSize: value,
  }),
  stock: z.object({
    status: z.enum([
      "recorded",
      "unavailable",
      "ambiguous_identity",
      "organization_scope_unavailable",
    ]),
    unit: z.null(),
    observedAt: z.null(),
    warehouses: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        quantity: z.string(),
        reserved: z.string(),
        owner: z.enum(["commerce", "erp"]),
        sellable: z.boolean(),
        recordedAt: recorded,
      }),
    ),
  }),
});
export type ProductEvidence = z.infer<typeof productEvidenceSchema>;
