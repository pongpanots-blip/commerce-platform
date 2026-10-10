/** Synthetic fixtures only. Application readers never import this file. */
import {
  financePeriodSchema,
  fields,
  monthWindow,
  recordedVariance,
  type FinancePeriod,
  type FinanceQuery,
} from "./financial-analysis";
export const orderId = "00000000-0000-4000-8000-000000000001",
  refundId = "00000000-0000-4000-8000-000000000099";
export const financeQuery: FinanceQuery = {
  month: "2026-09",
  compare: "2026-08",
  timezone: "UTC",
};
export function fixturePeriod(
  m = "2026-09",
  value = "107.00",
  timezone: FinanceQuery["timezone"] = "UTC",
): FinancePeriod {
  return financePeriodSchema.parse({
    window: monthWindow(m, timezone),
    source: "copies",
    declaredCurrency: "THB",
    currencyEvidence: "native_report_contract",
    unitBasis: "order_header_amount",
    orderTimeBasis: "order_create_date",
    refundTimeBasis: "refund_created_at",
    upstreamCompleteness: "unverified",
    upstreamFreshness: "unverified",
    capturedAt: "2026-10-10T00:00:00Z",
    orders: {
      paidOrders: 1,
      excludedWithoutPayment: 1,
      legacyCopyOrders: 1,
      latestCopyWriteAt: "2026-10-09T00:00:00Z",
      values: Object.fromEntries(
        fields.map((f) => [
          f,
          {
            knownSum: value,
            value,
            knownRows: 1,
            missingRows: 0,
            negativeRows: value.startsWith("-") ? 1 : 0,
          },
        ]),
      ),
      items: [
        {
          id: orderId,
          number: "SYNTHETIC-1",
          status: "paid",
          createdAt: m + "-15T00:00:00Z",
          values: Object.fromEntries(fields.map((f) => [f, value])),
          copiedAt: "2026-10-09T00:00:00Z",
          sourceVersion: "0",
        },
      ],
      hasMore: false,
    },
    refunds: {
      records: 1,
      knownAmount: "7.00",
      knownRows: 1,
      missingRows: 0,
      negativeRows: 0,
      unlinkedOrders: 0,
      outsideOrderPeriod: 1,
      items: [
        {
          id: refundId,
          orderId,
          amount: "7.00",
          createdAt: m + "-16T00:00:00Z",
          processedAt: null,
          orderCreatedAt: "2026-07-01T00:00:00Z",
        },
      ],
      hasMore: false,
    },
    issues: [],
    coverage: "partial",
  });
}
export const fixtureAnalysis = (q = financeQuery) => {
  const current = fixturePeriod(q.month, "107.00", q.timezone),
    previous = fixturePeriod(q.compare, "100.00", q.timezone);
  return {
    query: q,
    current,
    previous,
    variance: recordedVariance(current, previous),
    goalContext: null,
    goalContextIssue: "context_unavailable" as const,
    selectedGoal: null,
    readOnly: true as const,
    operationalWrites: false as const,
  };
};
