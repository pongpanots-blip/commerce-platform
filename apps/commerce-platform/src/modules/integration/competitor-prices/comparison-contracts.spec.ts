import { fixtureInputs } from "../pack-price-planning/pack-fixtures";
import {
  comparisonCommandSchema,
  comparisonPacketSchema,
  comparisonRows,
  normalizedComparisonPack,
  parseComparisonHandoff,
  verifyComparisonReceipt,
} from "./comparison-contracts";
const id = "00000000-0000-4000-8000-000000000010";
function metadata(inputs = fixtureInputs()) {
  return inputs.observations.map((o, i) => ({
    id: o.id,
    sourceId: i ? id : null,
    sourceName: "Same Vendor",
    sourceUrl: `https://vendor-${i}.example.invalid/p`,
    context: "Full pack, no delivery normalization",
    ourProductVersion: "a".repeat(64),
    relationship: "same_product",
  }));
}
describe("typed multi-vendor comparison eligibility and strict action contracts", () => {
  it("normalizes six 500g pieces exactly, with no midpoint or binary price arithmetic", () => {
    expect(
      normalizedComparisonPack({ unit: "g", min: "500", max: "500", count: 6 }),
    ).toEqual({ unit: "kg", min: "0.5000", max: "0.5000", count: 6 });
  });
  it("keeps vendors with duplicate names and different source identities as separate offers", () => {
    const rows = comparisonRows(fixtureInputs(), metadata());
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.sourceKey)).size).toBe(2);
    expect(rows[0]).toMatchObject({
      eligible: true,
      pricePerBaseIncVat: "100.000000",
      differencePerBaseIncVat: "7.000000",
    });
  });
  it("keeps member offers separate and suppresses member/public savings without eligibility", () => {
    const r = comparisonRows(fixtureInputs(), metadata())[1];
    expect(r.reasons).toContain("member_eligibility_unverified");
    expect(r.differencePercent).toBeNull();
  });
  it.each(["l", "piece"])(
    "excludes %s versus kg, never weight-to-volume or count-to-weight conversion",
    (unit) => {
      const i = fixtureInputs();
      i.observations[0].originalPack = { unit, min: "1", max: "1", count: 1 };
      const r = comparisonRows(i, metadata(i))[0];
      expect(r.eligible).toBe(false);
      expect(r.reasons).toContain("unit_mismatch");
      expect(r.pricePerBaseIncVat).toBeNull();
    },
  );
  it.each([
    ["currency", "USD", "currency_fx_unsupported"],
    ["taxBasis", "unverified", "tax_unverified"],
    ["mapped", false, "mapping_unverified"],
    ["sourceCurrent", false, "source_changed"],
    ["sourceFailed", true, "source_failed"],
    ["observedAt", null, "source_date_unavailable"],
    ["observedAt", "2027-01-01T00:00:00Z", "source_date_future"],
    ["validUntil", "2026-10-09T11:30:00Z", "observation_stale"],
    ["priceIncVat", "-1", "price_unavailable"],
  ] as const)(
    "excludes %s=%s and never emits a price delta",
    (key, value, reason) => {
      const i = fixtureInputs();
      Object.assign(i.observations[0], { [key]: value });
      const r = comparisonRows(i, metadata(i))[0];
      expect(r.reasons).toContain(reason);
      expect(r.differencePercent).toBeNull();
    },
  );
  it("excludes variable pack ranges instead of replacing them with an average", () => {
    const i = fixtureInputs();
    i.observations[0].originalPack.max = "350";
    expect(comparisonRows(i, metadata(i))[0].reasons).toContain("pack_range");
  });
  it.each(["uncertain", "substitute"])(
    "retains %s matches with explicit exclusions",
    (relationship) => {
      const m = metadata();
      m[0].relationship = relationship;
      const r = comparisonRows(fixtureInputs(), m)[0];
      expect(r.eligible).toBe(false);
      expect(r.reasons).toContain(
        relationship === "substitute" ? "substitute" : "match_uncertain",
      );
    },
  );
  it("does not reinterpret a prior observation after a pack change", () => {
    const m = metadata();
    const r = comparisonRows(
      fixtureInputs(),
      m.map((x, i) => ({ ...x, packChanged: i === 0 })),
    )[0];
    expect(r.reasons).toContain("observation_pack_changed");
  });
  it("retains original raw foreign currency instead of substituting the native legacy THB alias", () => {
    const m = metadata();
    const r = comparisonRows(
      fixtureInputs(),
      m.map((x, i) => ({
        ...x,
        observation:
          i === 0
            ? {
                price: "100.00",
                currency: "USD",
                taxBasis: "inclusive",
                priceBasis: "public",
                observedAt: "2026-10-09T11:00:00Z",
                pack: { unit: "g", min: "250", max: "250", count: 4 },
              }
            : null,
      })),
    )[0];
    expect(r.observation.currency).toBe("USD");
    expect(r.reasons).toContain("currency_fx_unsupported");
  });
  it.each([
    { unit: "g", min: "0.0001", max: "0.0001", count: 1 },
    { unit: "piece", min: "0.5", max: "0.5", count: 1 },
    { unit: "kg", min: "2", max: "1", count: 1 },
    { unit: "kg", min: "100000", max: "100000", count: 1000 },
  ])(
    "rejects invalid precision, fractional pieces, reversed range or overflowing pack %j",
    (pack) => {
      expect(
        comparisonCommandSchema.safeParse({
          operation: "pack",
          pairId: id,
          revision: 1,
          pack,
        }).success,
      ).toBe(false);
    },
  );
  it("rejects actor/role overrides, duplicate pair commands and stale revision-shaped values", () => {
    const command = {
      operation: "verify",
      pairId: id,
      revision: 1,
      relationship: "same_product",
      note: "Reviewed actual product evidence",
    };
    const p = {
      requestId: id,
      sku: "SYNTHETIC-SKU",
      sourceFingerprint: "a".repeat(64),
      commands: [command],
    };
    expect(
      comparisonPacketSchema.safeParse({ ...p, actor: "admin" }).success,
    ).toBe(false);
    expect(
      comparisonPacketSchema.safeParse({ ...p, commands: [command, command] })
        .success,
    ).toBe(false);
    expect(
      comparisonCommandSchema.safeParse({ ...command, revision: 0 }).success,
    ).toBe(false);
  });
  it("rejects fabricated all-success, changed request bodies and mismatched persisted pair receipts", () => {
    const packet = comparisonPacketSchema.parse({
      requestId: id,
      sku: "SYNTHETIC-SKU",
      sourceFingerprint: "a".repeat(64),
      commands: [
        {
          operation: "verify",
          pairId: id,
          revision: 1,
          relationship: "same_product",
          note: "Reviewed actual product evidence",
        },
      ],
    });
    const receipt = {
      kind: "competitor_action",
      id,
      requestId: id,
      packet,
      status: "committed",
      persisted: true,
      sellingPriceWrites: false,
      activationAllowed: false,
      savedAt: "2026-10-10T00:00:00Z",
      results: [
        {
          index: 0,
          pairId: id,
          status: "applied",
          message: "",
          before: null,
          after: { id, revision: 2 },
        },
      ],
    };
    expect(verifyComparisonReceipt(receipt, packet).persisted).toBe(true);
    expect(() =>
      verifyComparisonReceipt({
        ...receipt,
        results: [{ ...receipt.results[0], status: "failed" }],
      }),
    ).toThrow();
    expect(() =>
      verifyComparisonReceipt(receipt, { ...packet, sku: "OTHER" }),
    ).toThrow();
    expect(() =>
      verifyComparisonReceipt({
        ...receipt,
        results: [
          {
            ...receipt.results[0],
            pairId: "00000000-0000-4000-8000-000000000011",
          },
        ],
      }),
    ).toThrow();
  });
  it("handoff requires recaptured SKU/fingerprint and selected eligible identities with bounded unique selection", () => {
    const value = {
      sku: "SYNTHETIC-SKU",
      sourceFingerprint: "a".repeat(64),
      packSourceFingerprint: "b".repeat(64),
      eligibleIds: [id],
      productName: "Synthetic",
      capturedAt: "2026-10-10T00:00:00Z",
      activationAllowed: false,
      sellingPriceWrites: false,
    };
    expect(
      parseComparisonHandoff(value, "SYNTHETIC-SKU", "a".repeat(64), [id]).sku,
    ).toBe("SYNTHETIC-SKU");
    expect(() => parseComparisonHandoff(value, "OTHER")).toThrow();
    expect(() =>
      parseComparisonHandoff(value, "SYNTHETIC-SKU", "b".repeat(64), [id]),
    ).toThrow();
    expect(() =>
      parseComparisonHandoff(value, "SYNTHETIC-SKU", "a".repeat(64), [id, id]),
    ).toThrow();
  });
});
