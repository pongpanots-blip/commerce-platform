import { z } from "zod";
import {
  comparePacks,
  inspectObservation,
  observationSchema,
  packInputsSchema,
  type PackInputs,
} from "../pack-price-planning/pack-price";

export const COMPARISON_HOME = "/j/marketing/competitor-prices";
export const COMPARISON_API = "/competitor-prices/workspace";
export const canChangeComparison = (role: string) =>
  ["admin", "marketing"].includes(role);
export const comparisonUuid = z.uuid().transform((v) => v.toLowerCase());
const decimal = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,4})?$/)
  .refine((v) => Number(v) > 0 && Number(v) <= 100000);
const money = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/)
  .refine((v) => Number(v) > 0 && Number(v) <= 9999999999.99);
const sku = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\x00-\x1f\x7f]+$/);
export const comparisonPackSchema = z
  .object({
    unit: z.enum(["kg", "g", "l", "ml", "piece"]),
    min: decimal,
    max: decimal,
    count: z.number().int().min(1).max(1000),
  })
  .strict()
  .superRefine((v, c) => {
    if (Number(v.max) < Number(v.min))
      c.addIssue({
        code: "custom",
        path: ["max"],
        message: "Maximum must not be less than minimum",
      });
    if (
      v.unit === "piece" &&
      (!Number.isInteger(Number(v.min)) || !Number.isInteger(Number(v.max)))
    )
      c.addIssue({
        code: "custom",
        path: ["min"],
        message: "Pieces must be whole",
      });
    try {
      normalizedComparisonPack(v);
    } catch {
      c.addIssue({
        code: "custom",
        path: ["min"],
        message: "Pack precision or total exceeds supported storage",
      });
    }
  });
/** Exact column precision; never round grams/ml or replace a range by its midpoint. */
export function normalizedComparisonPack(v: {
  unit: string;
  min: string;
  max: string;
  count: number;
}) {
  const convert = (s: string) => {
    const [whole, fraction = ""] = s.split(".");
    const n = BigInt(whole + fraction) * BigInt(10 ** (4 - fraction.length));
    const divisor = ["g", "ml"].includes(v.unit) ? BigInt(1000) : BigInt(1);
    if (
      n % divisor ||
      n / divisor < BigInt(1) ||
      (n / divisor) * BigInt(v.count) > BigInt(1000000000)
    )
      throw Error("Unsupported pack precision/total");
    const digits = (n / divisor).toString().padStart(5, "0");
    return digits.slice(0, -4) + "." + digits.slice(-4);
  };
  return {
    unit: v.unit === "g" ? "kg" : v.unit === "ml" ? "l" : v.unit,
    min: convert(v.min),
    max: convert(v.max),
    count: v.count,
  };
}
const pairCommand = {
  pairId: comparisonUuid,
  revision: z.number().int().min(1).max(2147483646),
};
export const comparisonCommandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("reassign"),
      ...pairCommand,
      sourceUrl: z.url().max(2000),
      sourceId: comparisonUuid.nullable(),
      name: z.string().trim().min(1).max(500),
      competitorSku: z.string().trim().max(100),
      context: z.string().trim().min(1).max(1000),
      note: z.string().trim().min(10).max(900),
    })
    .strict(),
  z
    .object({
      operation: z.literal("review"),
      note: z.string().trim().min(10).max(900),
    })
    .strict(),
  z
    .object({
      operation: z.literal("settings"),
      ...pairCommand,
      name: z.string().trim().min(1).max(500),
      competitorSku: z.string().trim().max(100),
      context: z.string().trim().min(1).max(1000),
      collectionAllowed: z.boolean(),
      autoRefresh: z.boolean(),
    })
    .strict(),
  z.object({ operation: z.literal("refresh"), ...pairCommand }).strict(),
  z
    .object({
      operation: z.literal("create"),
      sourceUrl: z.url().max(2000),
      sourceId: comparisonUuid.nullable(),
      catalogItemId: comparisonUuid.nullable(),
      name: z.string().trim().min(1).max(500),
      competitorSku: z.string().trim().max(100),
      context: z.string().trim().min(1).max(1000),
      pack: comparisonPackSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("pack"),
      ...pairCommand,
      pack: comparisonPackSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("verify"),
      ...pairCommand,
      relationship: z.enum(["same_product", "uncertain", "substitute"]),
      note: z.string().trim().min(10).max(900),
    })
    .strict(),
  z
    .object({
      operation: z.literal("capture"),
      ...pairCommand,
      price: money,
      currency: z.string().regex(/^[A-Z]{3}$/),
      taxBasis: z.enum(["inclusive", "exclusive", "unverified"]),
      priceBasis: z.enum(["public", "member"]),
      observedAt: z.iso.datetime({ offset: true }),
      context: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      operation: z.literal("remove"),
      ...pairCommand,
      note: z.string().trim().min(10).max(900),
    })
    .strict(),
]);
export type ComparisonCommand = z.infer<typeof comparisonCommandSchema>;
export const comparisonPacketSchema = z
  .object({
    requestId: comparisonUuid,
    sku,
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    commands: z.array(comparisonCommandSchema).min(1).max(20),
  })
  .strict()
  .superRefine((v, c) => {
    const ids = v.commands.flatMap((x) => ("pairId" in x ? [x.pairId] : []));
    if (
      new Set(ids).size !== ids.length ||
      v.commands.filter((c) => c.operation === "review").length > 1
    )
      c.addIssue({
        code: "custom",
        path: ["commands"],
        message: "Each pair may appear once in a request",
      });
  });
export type ComparisonPacket = z.infer<typeof comparisonPacketSchema>;
const snapshot = z.record(z.string(), z.unknown());
export const comparisonReceiptSchema = z
  .object({
    kind: z.literal("competitor_action"),
    // Existing promotion receipt readers scope by scenario.kind; retain that shared-storage discriminator.
    scenario: z
      .object({ kind: z.literal("competitor_action") })
      .default({ kind: "competitor_action" }),
    id: comparisonUuid,
    requestId: comparisonUuid,
    packet: comparisonPacketSchema,
    status: z.enum(["committed", "partial", "failed"]),
    persisted: z.literal(true),
    sellingPriceWrites: z.literal(false),
    activationAllowed: z.literal(false),
    savedAt: z.iso.datetime({ offset: true }),
    results: z
      .array(
        z.object({
          index: z.number().int().min(0),
          pairId: comparisonUuid.nullable(),
          status: z.enum(["applied", "failed"]),
          message: z.string(),
          before: snapshot.nullable(),
          after: snapshot.nullable(),
        }),
      )
      .min(1)
      .max(20),
    replayed: z.boolean().optional(),
  })
  .superRefine((v, c) => {
    const n = v.results.filter((x) => x.status === "applied").length;
    if (
      v.requestId !== v.packet.requestId ||
      v.results.length !== v.packet.commands.length ||
      v.results.some((r, i) => r.index !== i) ||
      v.status !==
        (n === v.results.length ? "committed" : n ? "partial" : "failed")
    )
      c.addIssue({
        code: "custom",
        message: "Invalid action receipt identity or outcome",
      });
    v.results.forEach((r, i) => {
      const command = v.packet.commands[i];
      if ("pairId" in command && r.pairId !== command.pairId)
        c.addIssue({
          code: "custom",
          message: "Receipt pair identity mismatch",
        });
      if (
        r.status === "applied" &&
        command.operation !== "remove" &&
        command.operation !== "review" &&
        (!r.after || r.after.id !== r.pairId)
      )
        c.addIssue({
          code: "custom",
          message: "Missing persisted pair identity",
        });
      if (
        r.status === "applied" &&
        command.operation === "review" &&
        (!r.after ||
          !comparisonUuid.safeParse(r.after.productId).success ||
          !r.after.reviewedAt)
      )
        c.addIssue({
          code: "custom",
          message: "Missing persisted review marker",
        });
    });
  });
export type ComparisonReceipt = z.infer<typeof comparisonReceiptSchema>;
export function verifyComparisonReceipt(
  raw: unknown,
  packet?: ComparisonPacket,
) {
  const v = comparisonReceiptSchema.parse(raw);
  if (
    packet &&
    JSON.stringify(v.packet) !==
      JSON.stringify(comparisonPacketSchema.parse(packet))
  )
    throw Error("Receipt does not match original request");
  return v;
}

export function comparisonRows(
  inputs: PackInputs,
  metadata: {
    id: string;
    sourceId: string | null;
    sourceName: string;
    sourceUrl: string;
    context: string;
    ourProductVersion: string;
    relationship: string;
    observation?: Record<string, unknown> | null;
    packChanged?: boolean;
    identityChanged?: boolean;
  }[],
) {
  return inputs.observations.map((original) => {
    const m = metadata.find((x) => x.id === original.id);
    if (!m) throw Error("Missing source identity");
    const raw = m.observation;
    const parsed = raw
      ? observationSchema.parse({
          ...original,
          originalPack: raw.pack ?? {
            unit: null,
            min: null,
            max: null,
            count: 1,
          },
          priceIncVat: typeof raw.price === "string" ? raw.price : null,
          currency: typeof raw.currency === "string" ? raw.currency : null,
          taxBasis: raw.taxBasis === "inclusive" ? "inclusive" : "unverified",
          priceBasis: raw.priceBasis === "member" ? "member" : "public",
          observedAt:
            typeof raw.observedAt === "string" ? raw.observedAt : null,
        })
      : original;
    const basis = inspectObservation(parsed, inputs),
      reasons: string[] = [...basis.reasons];
    if (
      parsed.observedAt &&
      Date.parse(parsed.observedAt) > Date.parse(inputs.capturedAt) &&
      !reasons.includes("source_date_future")
    )
      reasons.push("source_date_future");
    if (m.relationship === "substitute") reasons.push("substitute");
    if (m.relationship === "uncertain") reasons.push("match_uncertain");
    if (m.packChanged) reasons.push("observation_pack_changed");
    if (m.identityChanged) reasons.push("observation_identity_changed");
    if (parsed.priceBasis !== original.priceBasis)
      reasons.push("price_basis_mismatch");
    if (parsed.priceBasis === "member")
      reasons.push("member_eligibility_unverified");
    const eligible = reasons.length === 0;
    let difference: string | null = null,
      percent: string | null = null;
    if (
      eligible &&
      inputs.product.basis &&
      inputs.product.currentPriceIncVat &&
      Number(inputs.product.currentPriceIncVat) > 0
    ) {
      const scenario = {
        kind: "pack_price",
        name: "Recorded catalog basis",
        sku: inputs.sku,
        sourceFingerprint: inputs.sourceFingerprint,
        observationIds: [original.id],
        proposals: [
          {
            label: "Recorded catalog price",
            pack: inputs.product.basis,
            salePriceIncVat: inputs.product.currentPriceIncVat,
            additionalCostExVat: "0",
            assumption: "",
          },
        ],
      };
      const compared = comparePacks(scenario, {
        ...inputs,
        observations: inputs.observations.map((o) =>
          o.id === original.id ? parsed : o,
        ),
      }).scenarios[0].comparisons[0];
      difference = compared.differencePerBaseIncVat;
      percent = compared.differencePercent;
    }
    return {
      id: original.id,
      revision: original.revision,
      sourceId: m.sourceId,
      sourceKey: m.sourceId
        ? `source:${m.sourceId}`
        : `manual:${new URL(m.sourceUrl).origin}`,
      vendor: m.sourceName,
      url: m.sourceUrl,
      context: m.context,
      ourProductVersion: m.ourProductVersion,
      relationship: m.relationship,
      observation: parsed,
      rawEvidence: raw ?? null,
      eligible,
      reasons,
      unit: basis.unit,
      totalQuantity: basis.quantity,
      pricePerBaseIncVat: eligible ? basis.pricePerBaseIncVat : null,
      differencePerBaseIncVat: difference,
      differencePercent: percent,
    };
  });
}
export const comparisonWorkspaceSchema = z
  .object({
    sku,
    inputs: packInputsSchema,
    rows: z.array(
      z.object({
        id: comparisonUuid,
        revision: z.number().int().positive(),
        sourceId: comparisonUuid.nullable(),
        sourceKey: z.string(),
        vendor: z.string(),
        url: z.string(),
        context: z.string(),
        ourProductVersion: z.string(),
        competitorSku: z.string().default(""),
        collectionAllowed: z.boolean().default(false),
        autoRefresh: z.boolean().default(false),
        canRefresh: z.boolean().default(false),
        refreshReason: z.string().nullable().default(null),
        relationship: z.string(),
        observation: z.record(z.string(), z.unknown()),
        rawEvidence: z.record(z.string(), z.unknown()).nullable().default(null),
        eligible: z.boolean(),
        reasons: z.array(z.string()),
        unit: z.string().nullable(),
        totalQuantity: z.string().nullable(),
        pricePerBaseIncVat: z.string().nullable(),
        differencePerBaseIncVat: z.string().nullable(),
        differencePercent: z.string().nullable(),
      }),
    ),
    sourceFingerprint: z.string(),
    capturedAt: z.string(),
    observationsTruncated: z.boolean(),
    upstreamFreshness: z.literal("unverified"),
    review: z
      .object({ at: z.string(), by: z.string() })
      .nullable()
      .default(null),
  })
  .superRefine((v, c) => {
    if (
      v.sku !== v.inputs.sku ||
      v.sourceFingerprint !== v.inputs.sourceFingerprint ||
      v.rows.length !== v.inputs.observations.length ||
      v.rows.some(
        (r, i) =>
          r.id !== v.inputs.observations[i].id ||
          r.revision !== v.inputs.observations[i].revision,
      ) ||
      new Set(v.rows.map((r) => r.id)).size !== v.rows.length
    )
      c.addIssue({
        code: "custom",
        message: "Invalid workspace source identity",
      });
  });
export type ComparisonWorkspace = z.infer<typeof comparisonWorkspaceSchema>;
export const comparisonHandoffSchema = z.object({
  sku,
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  packSourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  eligibleIds: z.array(comparisonUuid).max(200),
  productName: z.string(),
  capturedAt: z.iso.datetime({ offset: true }),
  activationAllowed: z.literal(false),
  sellingPriceWrites: z.literal(false),
});
export function parseComparisonHandoff(
  raw: unknown,
  expectedSku: string,
  fingerprint?: string,
  ids?: string[],
) {
  const v = comparisonHandoffSchema.parse(raw);
  if (
    v.sku !== expectedSku ||
    (fingerprint && v.sourceFingerprint !== fingerprint) ||
    (ids &&
      (ids.length > 20 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !v.eligibleIds.includes(id))))
  )
    throw Error(
      "Comparison handoff evidence changed. Review the current comparison.",
    );
  return v;
}
