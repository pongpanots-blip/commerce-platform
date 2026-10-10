import { z } from "zod";
export const planKind = z.enum(["sales_work", "marketing_readiness"]);
export type PlanKind = z.infer<typeof planKind>;
export const planUuid = z.uuid().transform((v) => v.toLowerCase());
const label = z.string().trim().min(1).max(160),
  sku = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\x00-\x1f\x7f]+$/),
  instant = z.iso.datetime({ offset: true });
const quantity = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,3})?$/)
  .refine((v) => Number(v) > 0);
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
export const planScenarioSchema = z
  .object({
    kind: planKind,
    task: z.enum(["follow_up", "reorder", "campaign_brief"]),
    name: label,
    subjectId: sku,
    orderId: planUuid.nullable(),
    note: z.string().trim().min(1).max(1200),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    lines: z
      .array(z.object({ sku, proposedQuantity: quantity }).strict())
      .max(50),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.kind === "sales_work"
        ? !planUuid.safeParse(v.subjectId).success ||
          v.task === "campaign_brief"
        : v.task !== "campaign_brief" ||
          v.orderId !== null ||
          v.lines.length > 0
    )
      c.addIssue({
        code: "custom",
        message: "Invalid planning task or subject",
      });
    if (
      v.task === "reorder" ? !v.orderId || !v.lines.length : v.lines.length > 0
    )
      c.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Choose verified historical lines for a reorder draft only",
      });
    if (new Set(v.lines.map((i) => i.sku)).size !== v.lines.length)
      c.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Duplicate proposed SKU",
      });
    if (
      v.dueDate &&
      (!Number.isFinite(Date.parse(v.dueDate + "T00:00:00Z")) ||
        new Date(v.dueDate + "T00:00:00Z").toISOString().slice(0, 10) !==
          v.dueDate)
    )
      c.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Invalid review date",
      });
  });
export type PlanScenario = z.infer<typeof planScenarioSchema>;
const reason = z.enum([
  "assignment_unavailable",
  "history_unavailable",
  "no_selected_order",
  "order_not_in_page",
  "order_not_paid",
  "order_status_ineligible",
  "order_company_mismatch",
  "no_unambiguous_lines",
  "ambiguous_sku",
  "invalid_historical_quantity",
  "inactive_product",
  "price_unavailable",
  "image_missing",
  "category_missing",
  "recorded_stock_empty",
  "stock_unknown",
  "backorder_confirmation_required",
  "line_limit_exceeded",
]);
export const planInputsSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: planKind,
    capturedAt: instant,
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    scope: z.enum([
      "own_assigned_company",
      "authorized_team_company",
      "marketing_catalog",
    ]),
    source: z.enum(["replica", "copies", "mixed"]),
    upstreamFreshness: z.literal("unverified"),
    subject: z
      .object({ id: sku, name: label, assignedRepId: planUuid.nullable() })
      .strict(),
    orders: z
      .array(
        z
          .object({
            id: planUuid,
            number: z.string().nullable(),
            status: z.string(),
            paid: z.boolean().nullable(),
            createdAt: instant.nullable(),
          })
          .strict(),
      )
      .max(20),
    historyCoverage: z.enum(["returned_page_only", "unavailable"]),
    historyHasMore: z.boolean().nullable(),
    selectedOrderId: planUuid.nullable(),
    historicalLines: z
      .array(
        z
          .object({
            sku,
            name: label,
            recordedQuantity: quantity,
            historicalUnit: z.null(),
            recordedUnitPrice: money.nullable(),
          })
          .strict(),
      )
      .max(50),
    product: z
      .object({
        status: z.string().nullable(),
        recordedPrice: money.nullable(),
        recordedStock: z.number().finite().nullable(),
        sellingUnit: z.string().nullable(),
        imageCount: z.number().int().nonnegative().nullable(),
        categoryId: planUuid.nullable(),
        sourceChangedAt: instant.nullable(),
      })
      .strict()
      .nullable(),
    followUpEligible: z.boolean(),
    reorderEligible: z.boolean(),
    knownReasons: z.array(reason),
    missing: z.array(
      z.enum([
        "complete_history",
        "reorder_cadence",
        "selling_unit_mapping",
        "current_customer_price",
        "available_to_promise",
        "stock_age",
        "effective_internal_cost",
        "spend",
        "attribution",
        "upstream_freshness",
      ]),
    ),
    actualMargin: z.null(),
    roas: z.null(),
    currentOrderTotal: z.null(),
    operationalWrites: z.literal(false),
    activationAllowed: z.literal(false),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.kind === "sales_work"
        ? !planUuid.safeParse(v.subject.id).success ||
          v.product !== null ||
          v.scope === "marketing_catalog"
        : v.product === null ||
          v.scope !== "marketing_catalog" ||
          v.orders.length > 0 ||
          v.historicalLines.length > 0 ||
          v.selectedOrderId !== null ||
          v.followUpEligible ||
          v.reorderEligible
    )
      c.addIssue({ code: "custom", message: "Invalid source scope" });
    if (
      new Set(v.orders.map((i) => i.id)).size !== v.orders.length ||
      new Set(v.historicalLines.map((i) => i.sku)).size !==
        v.historicalLines.length
    )
      c.addIssue({ code: "custom", message: "Ambiguous source identities" });
    if (v.followUpEligible && !v.subject.assignedRepId)
      c.addIssue({
        code: "custom",
        message: "Unverified assignment cannot be eligible",
      });
    if (
      v.reorderEligible &&
      (!v.followUpEligible ||
        !v.selectedOrderId ||
        !v.historicalLines.length ||
        !v.orders.some(
          (o) =>
            o.id === v.selectedOrderId &&
            o.paid === true &&
            ["paid", "preparing", "shipped", "delivered"].includes(o.status),
        ))
    )
      c.addIssue({ code: "custom", message: "Invalid reorder eligibility" });
  });
export type PlanInputs = z.infer<typeof planInputsSchema>;
export function previewPlan(raw: unknown, source: unknown) {
  const scenario = planScenarioSchema.parse(raw),
    inputs = planInputsSchema.parse(source);
  if (
    scenario.kind !== inputs.kind ||
    (scenario.kind === "sales_work"
      ? scenario.subjectId.toLowerCase() !== inputs.subject.id.toLowerCase()
      : scenario.subjectId !== inputs.subject.id) ||
    scenario.orderId !== inputs.selectedOrderId ||
    scenario.sourceFingerprint !== inputs.sourceFingerprint
  )
    throw Error("Planning source identity changed");
  if (
    (scenario.task === "follow_up" && !inputs.followUpEligible) ||
    (scenario.task === "reorder" && !inputs.reorderEligible)
  )
    throw Error("Selected source is ineligible for this draft");
  if (scenario.dueDate && scenario.dueDate < inputs.capturedAt.slice(0, 10))
    throw Error("Review date is in the past");
  if (
    scenario.lines.some(
      (l) => !inputs.historicalLines.some((s) => s.sku === l.sku),
    )
  )
    throw Error("Proposed SKU is absent from the selected order");
  return {
    scenario,
    inputs,
    preview: {
      mode: "human_review" as const,
      persisted: false as const,
      operationalWrites: false as const,
      activationAllowed: false as const,
      readiness: inputs.knownReasons.filter(
        (r) => scenario.task !== "follow_up" || r === "assignment_unavailable",
      ).length
        ? ("blocked" as const)
        : ("needs_confirmation" as const),
      actualMargin: null,
      roas: null,
      currentOrderTotal: null,
      reorderCadence: null,
      executableCart: false as const,
    },
  };
}
const previewSchema = z
  .object({
    mode: z.literal("human_review"),
    persisted: z.literal(false),
    operationalWrites: z.literal(false),
    activationAllowed: z.literal(false),
    readiness: z.enum(["blocked", "needs_confirmation"]),
    actualMargin: z.null(),
    roas: z.null(),
    currentOrderTotal: z.null(),
    reorderCadence: z.null(),
    executableCart: z.literal(false),
  })
  .strict();
export const planPreviewSchema = z
  .object({
    scenario: planScenarioSchema,
    inputs: planInputsSchema,
    preview: previewSchema,
  })
  .superRefine((v, c) => {
    try {
      if (
        JSON.stringify(previewPlan(v.scenario, v.inputs).preview) !==
        JSON.stringify(v.preview)
      )
        throw Error();
    } catch {
      c.addIssue({ code: "custom", message: "Invalid planning evidence" });
    }
  });
export const planReceiptSchema = planPreviewSchema
  .safeExtend({
    id: planUuid,
    revision: z.number().int().positive(),
    status: z.literal("draft"),
    saved: z.literal(true),
    persisted: z.literal(true),
    operationalWrites: z.literal(false),
    activationAllowed: z.literal(false),
    createdAt: instant,
    updatedAt: instant,
    replayed: z.boolean().optional(),
  })
  .superRefine((v, c) => {
    if (Date.parse(v.updatedAt) < Date.parse(v.createdAt))
      c.addIssue({ code: "custom", message: "Invalid saved time" });
  });
export type PlanPreview = z.infer<typeof planPreviewSchema>;
export type PlanReceipt = z.infer<typeof planReceiptSchema>;
export const planPageSchema = z
  .object({
    items: z.array(planReceiptSchema).max(20),
    next: planUuid.nullable(),
  })
  .superRefine((v, c) => {
    if (
      new Set(v.items.map((i) => i.id)).size !== v.items.length ||
      (v.next !== null && v.next !== v.items[v.items.length - 1]?.id)
    )
      c.addIssue({ code: "custom", message: "Invalid draft page" });
  });
export const createPlanSchema = z
  .object({ requestId: planUuid, scenario: planScenarioSchema })
  .strict();
export const updatePlanSchema = createPlanSchema
  .extend({ revision: z.number().int().positive().max(2147483646) })
  .strict();
export const planHome = (kind: PlanKind) =>
  kind === "sales_work"
    ? "/planning/sales-work"
    : "/planning/marketing-readiness";
export const planApi = (kind: PlanKind) =>
  kind === "sales_work"
    ? "/reports/sales-work"
    : "/reports/marketing-readiness";
export const planRoles = (kind: PlanKind) =>
  kind === "sales_work"
    ? ["admin", "sale", "sales_manager"]
    : ["admin", "marketing"];
export function planPreviewUrl(s: PlanScenario) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(planScenarioSchema.parse(s)),
  );
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const encoded = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (encoded.length > 7000) throw Error("Planning request too large");
  return `${planApi(s.kind)}/preview?scenario=${encoded}`;
}

export const canSavePlan = (kind: PlanKind, role: string) =>
  kind === "sales_work"
    ? ["admin", "sales_manager"].includes(role)
    : ["admin", "marketing"].includes(role);
export const planSubjectsSchema = z
  .object({
    items: z.array(z.object({ id: sku, name: label }).strict()).max(20),
    hasMore: z.boolean(),
    coverage: z.literal("returned_page_only"),
  })
  .strict();
