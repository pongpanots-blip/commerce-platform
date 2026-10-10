import {
  defaultFinanceQuery,
  fields,
  financePeriodSchema,
  financeQuerySchema,
  financeResponseSchema,
  financePeriodError,
  monthWindow,
  recordedVariance,
} from "./financial-analysis";
import { fixtureAnalysis, fixturePeriod } from "./finance-fixtures";
describe("recorded financial evidence, never invented accounting actuals", () => {
  it("uses exact half-open UTC and Bangkok calendar windows, leap years and year boundaries", () => {
    expect(monthWindow("2024-02", "UTC")).toEqual({
      month: "2024-02",
      timezone: "UTC",
      from: "2024-02-01T00:00:00.000Z",
      to: "2024-03-01T00:00:00.000Z",
      days: 29,
    });
    expect(monthWindow("2026-09", "Asia/Bangkok").from).toBe(
      "2026-08-31T17:00:00.000Z",
    );
    expect(defaultFinanceQuery(new Date("2026-01-01T00:00:00Z"))).toEqual({
      month: "2025-12",
      compare: "2025-11",
      timezone: "UTC",
    });
  });
  it.each([
    { month: "2026-13" },
    { compare: "2026-09" },
    { timezone: "GMT" },
    { source: "replica" },
    { actorId: "other" },
    { from: "2026-09-01" },
    { goalId: "bad" },
  ])("rejects invalid/override queries %j", (extra) =>
    expect(
      financeQuerySchema.safeParse({ ...fixtureAnalysis().query, ...extra })
        .success,
    ).toBe(false),
  );
  it("blocks future months but leaves the open current month explicitly partial", () => {
    expect(
      financePeriodError(
        { ...fixtureAnalysis().query, month: "2026-11" },
        Date.parse("2026-10-10T00:00:00Z"),
      ),
    ).toBe("future_period");
    expect(
      financePeriodError(
        { ...fixtureAnalysis().query, month: "2026-10" },
        Date.parse("2026-10-10T00:00:00Z"),
      ),
    ).toBeNull();
  });
  it("compares signed decimal cents without float loss, repeat VAT/discount subtraction or refund mixing", () => {
    const v = recordedVariance(
      fixturePeriod("2026-09", "9007199254740993.99"),
      fixturePeriod("2026-08", "9007199254740993.98"),
    );
    expect(v.fields[0].delta).toBe("0.01");
    expect(v.fields[0].percent).toBe("0.0000");
    expect(v).toMatchObject({
      actualNetSalesExVat: null,
      actualGrossProfitExVat: null,
      actualNetProfitExVat: null,
      actualGoalVariance: null,
      actualGoalAttainment: null,
      roas: null,
      causalExplanation: null,
      refundsSubtracted: false,
      discountsSubtractedAgain: false,
      unequalCalendarDays: true,
    });
  });
  it.each(["0.00", "-20.00"])(
    "keeps the difference but does not divide by reference %s",
    (reference) => {
      const v = recordedVariance(
        fixturePeriod("2026-09", "-3.50"),
        fixturePeriod("2026-08", reference),
      ).fields[0];
      expect(v.delta).toBe(reference === "0.00" ? "-3.50" : "16.50");
      expect(v.percent).toBeNull();
      expect(v.percentReason).toBe("non_positive_previous");
    },
  );
  it("rounds signed percentage to four decimal places", () => {
    expect(
      recordedVariance(
        fixturePeriod("2026-09", "2.00"),
        fixturePeriod("2026-08", "3.00"),
      ).fields[0].percent,
    ).toBe("-33.3333");
  });
  it.each([
    ["timezone", "incompatible_timezone"],
    ["source", "different_sources"],
    ["currency", "incompatible_currency"],
    ["unknown", "currency_unverified"],
    ["uom", "incompatible_uom"],
    ["month", "same_period"],
  ])("blocks incompatible %s", (kind, reason) => {
    const a = fixturePeriod(),
      b = fixturePeriod("2026-08");
    if (kind === "timezone") b.window = monthWindow("2026-08", "Asia/Bangkok");
    if (kind === "source") b.source = "replica";
    if (kind === "currency") b.declaredCurrency = "USD";
    if (kind === "unknown") b.currencyEvidence = "unavailable";
    if (kind === "uom") b.unitBasis = "unverified_uom";
    if (kind === "month") {
      b.window = a.window;
      b.orders!.items[0].createdAt = a.orders!.items[0].createdAt;
      b.refunds!.items[0].createdAt = a.refunds!.items[0].createdAt;
    }
    const v = recordedVariance(a, b).fields[0];
    expect(v).toMatchObject({ delta: null, percent: null, reason });
  });
  it("keeps partial known sum separate from missing field total", () => {
    const p = fixturePeriod();
    p.orders!.values.vat_amount = {
      knownSum: null,
      value: null,
      knownRows: 0,
      missingRows: 1,
      negativeRows: 0,
    };
    p.orders!.items[0].values.vat_amount = null;
    const v = recordedVariance(p, fixturePeriod("2026-08")).fields.find(
      (f) => f.field === "vat_amount",
    );
    expect(v).toMatchObject({
      current: null,
      delta: null,
      reason: "missing_field_coverage",
    });
    expect(recordedVariance(p, fixturePeriod("2026-08")).fields[0].delta).toBe(
      "0.00",
    );
  });
  it("distinguishes unavailable from a verified empty local query", () => {
    const p = fixturePeriod();
    p.orders = null;
    p.issues = ["orders_unavailable"];
    expect(
      recordedVariance(p, fixturePeriod("2026-08")).fields[0].current,
    ).toBeNull();
    const empty = fixturePeriod();
    empty.orders = {
      paidOrders: 0,
      excludedWithoutPayment: 0,
      legacyCopyOrders: 0,
      latestCopyWriteAt: null,
      values: Object.fromEntries(
        fields.map((f) => [
          f,
          {
            knownSum: null,
            value: "0.00",
            knownRows: 0,
            missingRows: 0,
            negativeRows: 0,
          },
        ]),
      ) as typeof empty.orders.values,
      items: [],
      hasMore: false,
    };
    empty.refunds = null;
    empty.issues = ["refunds_unavailable"];
    expect(
      financePeriodSchema.parse(empty).orders!.values.total_price.value,
    ).toBe("0.00");
  });
  it.each(["missing", "boundary", "duplicate", "fresh", "actual", "variance"])(
    "rejects fabricated %s evidence",
    (kind) => {
      const v = fixtureAnalysis();
      if (kind === "missing")
        v.current.orders!.values.total_price.missingRows = 1;
      if (kind === "boundary")
        v.current.orders!.items[0].createdAt = v.current.window.to;
      if (kind === "duplicate")
        v.current.orders!.items.push(v.current.orders!.items[0]);
      if (kind === "fresh") (v.current as any).upstreamFreshness = "verified";
      if (kind === "actual") (v.variance as any).actualNetProfitExVat = "1.00";
      if (kind === "variance") v.variance.fields[0].delta = "999.00";
      expect(financeResponseSchema.safeParse(v).success).toBe(false);
    },
  );
});
