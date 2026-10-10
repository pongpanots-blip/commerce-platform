import { z } from "zod";
import {
  goalInputsSchema,
  goalScenarioSchema,
} from "../financial-goals/financial-goals";
export const FINANCE_HOME = "/analysis/financial",
  FINANCE_API = "/reports/financial-analysis";
export const financeRoles = ["admin", "sales_manager", "business_analyst"];
export const month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
  uuid = z.uuid().transform((v) => v.toLowerCase());
const instant = z.iso.datetime({ offset: true }),
  amount = z.string().regex(/^-?\d{1,20}(\.\d{1,2})?$/),
  count = z.number().int().nonnegative();
export const financeQuerySchema = z
  .object({
    month,
    compare: month,
    timezone: z.enum(["UTC", "Asia/Bangkok"]),
    goalId: uuid.optional(),
  })
  .strict()
  .refine((v) => v.month !== v.compare, {
    path: ["compare"],
    message: "Choose a different comparison month",
  });
export type FinanceQuery = z.infer<typeof financeQuerySchema>;
export function monthWindow(raw: string, timezone: "UTC" | "Asia/Bangkok") {
  const [y, m] = month.parse(raw).split("-").map(Number),
    offset = timezone === "UTC" ? 0 : 7 * 3600000;
  return {
    month: raw,
    timezone,
    from: new Date(Date.UTC(y, m - 1, 1) - offset).toISOString(),
    to: new Date(Date.UTC(y, m, 1) - offset).toISOString(),
    days: (Date.UTC(y, m, 1) - Date.UTC(y, m - 1, 1)) / 86400000,
  };
}
const windowSchema = z
  .object({
    month,
    timezone: z.enum(["UTC", "Asia/Bangkok"]),
    from: instant,
    to: instant,
    days: count,
  })
  .strict()
  .refine(
    (v) =>
      JSON.stringify(v) === JSON.stringify(monthWindow(v.month, v.timezone)),
    "Invalid calendar window",
  );
export const fields = [
  "total_price",
  "subtotal_ex_vat",
  "vat_amount",
  "discount_inc_vat",
  "delivery_fee",
] as const;
export type FinanceField = (typeof fields)[number];
const valueSchema = z
  .object({
    knownSum: amount.nullable(),
    value: amount.nullable(),
    knownRows: count,
    missingRows: count,
    negativeRows: count,
  })
  .strict();
export const orderEvidenceSchema = z
  .object({
    id: uuid,
    number: z.string().nullable(),
    status: z.enum(["paid", "preparing", "shipped", "delivered"]),
    createdAt: instant,
    values: z.record(z.enum(fields), amount.nullable()),
    copiedAt: instant.nullable(),
    sourceVersion: z.string().regex(/^\d+$/).nullable(),
  })
  .strict();
export const refundEvidenceSchema = z
  .object({
    id: uuid,
    orderId: uuid,
    amount: amount.nullable(),
    createdAt: instant,
    processedAt: instant.nullable(),
    orderCreatedAt: instant.nullable(),
  })
  .strict();
const ordersSchema = z
  .object({
    paidOrders: count,
    excludedWithoutPayment: count,
    legacyCopyOrders: count.nullable(),
    latestCopyWriteAt: instant.nullable(),
    values: z.record(z.enum(fields), valueSchema),
    items: z.array(orderEvidenceSchema).max(20),
    hasMore: z.boolean(),
  })
  .strict()
  .superRefine((v, c) => {
    for (const f of fields) {
      const x = v.values[f];
      if (
        x.knownRows + x.missingRows !== v.paidOrders ||
        x.negativeRows > x.knownRows ||
        x.value !==
          (v.paidOrders === 0
            ? "0.00"
            : x.missingRows === 0
              ? x.knownSum
              : null) ||
        (x.knownRows === 0) !== (x.knownSum === null)
      )
        c.addIssue({
          code: "custom",
          message: "Invalid recorded field coverage",
        });
    }
    if (
      v.items.length > v.paidOrders ||
      (v.legacyCopyOrders !== null && v.legacyCopyOrders > v.paidOrders) ||
      new Set(v.items.map((i) => i.id)).size !== v.items.length ||
      v.hasMore !== v.paidOrders > v.items.length
    )
      c.addIssue({ code: "custom", message: "Invalid order sample coverage" });
  });
const refundsSchema = z
  .object({
    records: count,
    knownAmount: amount.nullable(),
    knownRows: count,
    missingRows: count,
    negativeRows: count,
    unlinkedOrders: count,
    outsideOrderPeriod: count,
    items: z.array(refundEvidenceSchema).max(20),
    hasMore: z.boolean(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.knownRows + v.missingRows !== v.records ||
      v.negativeRows > v.knownRows ||
      v.unlinkedOrders + v.outsideOrderPeriod > v.records ||
      v.items.length > v.records ||
      v.hasMore !== v.records > v.items.length ||
      new Set(v.items.map((i) => i.orderId + ":" + i.id)).size !==
        v.items.length ||
      (v.knownRows === 0) !== (v.knownAmount === null)
    )
      c.addIssue({ code: "custom", message: "Invalid refund coverage" });
  });
export const financePeriodSchema = z
  .object({
    window: windowSchema,
    source: z.enum(["copies", "replica"]),
    declaredCurrency: z.enum(["THB", "USD", "unknown"]),
    currencyEvidence: z.enum(["native_report_contract", "unavailable"]),
    unitBasis: z.enum(["order_header_amount", "unverified_uom"]),
    orderTimeBasis: z.literal("order_create_date"),
    refundTimeBasis: z.literal("refund_created_at"),
    upstreamCompleteness: z.literal("unverified"),
    upstreamFreshness: z.literal("unverified"),
    capturedAt: instant,
    orders: ordersSchema.nullable(),
    refunds: refundsSchema.nullable(),
    issues: z.array(z.enum(["orders_unavailable", "refunds_unavailable"])),
    coverage: z.enum(["partial", "unavailable"]),
  })
  .strict()
  .superRefine((v, c) => {
    const within = (date: string) =>
      Date.parse(date) >= Date.parse(v.window.from) &&
      Date.parse(date) < Date.parse(v.window.to);
    if (
      v.orders?.items.some((i) => !within(i.createdAt)) ||
      v.refunds?.items.some((i) => !within(i.createdAt)) ||
      new Set(v.issues).size !== v.issues.length
    )
      c.addIssue({
        code: "custom",
        message: "Invalid evidence period boundary",
      });
    if (
      v.coverage !== (!v.orders && !v.refunds ? "unavailable" : "partial") ||
      v.issues.includes("orders_unavailable") !== (v.orders === null) ||
      v.issues.includes("refunds_unavailable") !== (v.refunds === null)
    )
      c.addIssue({ code: "custom", message: "Invalid source availability" });
  });
export type FinancePeriod = z.infer<typeof financePeriodSchema>;
export type OrderEvidence = z.infer<typeof orderEvidenceSchema>;
export type RefundEvidence = z.infer<typeof refundEvidenceSchema>;
const cents = (v: string) => {
  const negative = v.startsWith("-"),
    [w, f = ""] = (negative ? v.slice(1) : v).split(".");
  return BigInt(w + f.padEnd(2, "0")) * (negative ? -BigInt(1) : BigInt(1));
};
const money = (v: bigint) => {
  const s = (v < BigInt(0) ? -v : v).toString().padStart(3, "0");
  return `${v < BigInt(0) ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
};
const percent = (difference: bigint, base: bigint) => {
  const n =
      (difference < BigInt(0) ? -difference : difference) * BigInt(1000000),
    r = (n * BigInt(2) + base) / (base * BigInt(2)),
    s = r.toString().padStart(5, "0");
  return `${difference < BigInt(0) && r !== BigInt(0) ? "-" : ""}${s.slice(0, -4)}.${s.slice(-4)}`;
};
export function recordedVariance(aRaw: unknown, bRaw: unknown) {
  const a = financePeriodSchema.parse(aRaw),
    b = financePeriodSchema.parse(bRaw);
  const incompatible =
    a.window.timezone !== b.window.timezone
      ? "incompatible_timezone"
      : a.source !== b.source
        ? "different_sources"
        : a.declaredCurrency !== b.declaredCurrency
          ? "incompatible_currency"
          : a.declaredCurrency === "unknown" ||
              a.currencyEvidence !== "native_report_contract" ||
              b.currencyEvidence !== "native_report_contract"
            ? "currency_unverified"
            : a.unitBasis !== b.unitBasis ||
                a.unitBasis !== "order_header_amount"
              ? "incompatible_uom"
              : a.window.month === b.window.month
                ? "same_period"
                : null;
  return {
    kind: "recorded_month_totals_only" as const,
    unequalCalendarDays: a.window.days !== b.window.days,
    upstreamCompleteness: "unverified" as const,
    fields: fields.map((field) => {
      const current = a.orders?.values[field].value ?? null,
        previous = b.orders?.values[field].value ?? null,
        reason =
          incompatible ??
          (current === null || previous === null
            ? "missing_field_coverage"
            : null);
      const delta = reason ? null : money(cents(current!) - cents(previous!)),
        base = previous === null ? null : cents(previous),
        pct =
          delta !== null && base !== null && base > BigInt(0)
            ? percent(cents(delta), base)
            : null;
      return {
        field,
        current,
        previous,
        delta,
        percent: pct,
        reason,
        percentReason:
          reason ??
          (base === null
            ? "missing_field_coverage"
            : base <= BigInt(0)
              ? "non_positive_previous"
              : null),
      };
    }),
    actualNetSalesExVat: null,
    actualGrossProfitExVat: null,
    actualNetProfitExVat: null,
    actualMarginPercent: null,
    actualGoalVariance: null,
    actualGoalAttainment: null,
    roas: null,
    causalExplanation: null,
    refundsSubtracted: false as const,
    discountsSubtractedAgain: false as const,
  };
}
const selectedGoalSchema = z
  .object({
    id: uuid,
    revision: z.number().int().positive(),
    name: z.string(),
    period: month,
    metric: z.enum([
      "gross_profit_ex_vat",
      "gross_margin_percent",
      "total_cost_ceiling_ex_vat",
      "net_profit_ex_vat",
    ]),
    target: z.string(),
    actual: z.null(),
    variance: z.null(),
    attainment: z.null(),
    compatiblePeriod: z.boolean(),
    reason: z.literal("actual_financial_basis_unavailable"),
  })
  .strict();
export const financeResponseSchema = z
  .object({
    query: financeQuerySchema,
    current: financePeriodSchema,
    previous: financePeriodSchema,
    variance: z.unknown(),
    goalContext: goalInputsSchema.nullable(),
    goalContextIssue: z
      .enum(["context_unavailable", "private_goal_unavailable"])
      .nullable(),
    selectedGoal: selectedGoalSchema.nullable(),
    readOnly: z.literal(true),
    operationalWrites: z.literal(false),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.query.month !== v.current.window.month ||
      v.query.compare !== v.previous.window.month ||
      v.query.timezone !== v.current.window.timezone ||
      v.query.timezone !== v.previous.window.timezone ||
      (financePeriodSchema.safeParse(v.current).success &&
        financePeriodSchema.safeParse(v.previous).success &&
        JSON.stringify(recordedVariance(v.current, v.previous)) !==
          JSON.stringify(v.variance))
    )
      c.addIssue({
        code: "custom",
        message: "Analysis identity or variance mismatch",
      });
    if (
      (v.goalContext && v.goalContext.period !== v.query.month) ||
      (v.selectedGoal &&
        (v.selectedGoal.id !== v.query.goalId ||
          v.selectedGoal.compatiblePeriod !==
            (v.query.timezone === "UTC" &&
              v.selectedGoal.period === v.query.month) ||
          !goalScenarioSchema.safeParse({
            kind: "financial_goal",
            name: v.selectedGoal.name,
            period: v.selectedGoal.period,
            metric: v.selectedGoal.metric,
            target: v.selectedGoal.target,
            sourceFingerprint: "a".repeat(64),
            hypothetical: null,
          }).success))
    )
      c.addIssue({ code: "custom", message: "Goal identity mismatch" });
  });
export type FinanceResponse = Omit<
  z.infer<typeof financeResponseSchema>,
  "variance" | "goalContext"
> & {
  variance: ReturnType<typeof recordedVariance>;
  goalContext: import("../financial-goals/financial-goals").GoalInputs | null;
};
export function financeSearch(q: FinanceQuery) {
  return (
    "?" +
    new URLSearchParams(
      financeQuerySchema.parse(q) as Record<string, string>,
    ).toString()
  );
}
export function defaultFinanceQuery(now = new Date()): FinanceQuery {
  const m = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
      .toISOString()
      .slice(0, 7);
  return { month: m(-1), compare: m(-2), timezone: "UTC" };
}

export const financeDetailSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("orders"),
        window: windowSchema,
        source: z.enum(["copies", "replica"]),
        capturedAt: instant,
        upstreamFreshness: z.literal("unverified"),
        record: orderEvidenceSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("refunds"),
        window: windowSchema,
        source: z.enum(["copies", "replica"]),
        capturedAt: instant,
        upstreamFreshness: z.literal("unverified"),
        record: refundEvidenceSchema,
      })
      .strict(),
  ])
  .superRefine((v, c) => {
    if (
      Date.parse(v.record.createdAt) < Date.parse(v.window.from) ||
      Date.parse(v.record.createdAt) >= Date.parse(v.window.to)
    )
      c.addIssue({
        code: "custom",
        message: "Evidence is outside the requested period",
      });
  });

export function financePeriodError(q: FinanceQuery, now = Date.now()) {
  return [q.month, q.compare].some(
    (m) => Date.parse(monthWindow(m, q.timezone).from) > now,
  )
    ? "future_period"
    : null;
}
