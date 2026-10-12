import { NotFoundException } from "@nestjs/common";
import {
  planInputsSchema,
  planScenarioSchema,
  previewPlan,
  planReceiptSchema,
} from "./commercial-work";
import {
  sourceFixture,
  companyId,
  orderId,
  repId,
  planStaff,
  planScenario,
  fixturePlanInputs,
} from "./plan-fixtures";
describe("source-backed commercial planning", () => {
  it("uses native assignment identity and paid predicate; leaves cadence/unit/current price/ATP unknown", async () => {
    const f = sourceFixture();
    const scoped = jest.spyOn(f.customer, "planningSubject"),
      paid = jest.spyOn(f.order, "planningOrders");
    const i = await f.service.inputs("sales_work", companyId, orderId, {
      ...planStaff,
      role: "sale",
    });
    expect(scoped).toHaveBeenCalledWith(companyId, [repId]);
    expect(paid).toHaveBeenCalledWith(companyId, [repId]);
    expect(i).toMatchObject({
      scope: "own_assigned_company",
      followUpEligible: true,
      reorderEligible: true,
      historyCoverage: "returned_page_only",
      actualMargin: null,
      currentOrderTotal: null,
    });
    expect(i.historicalLines[0]).toEqual({
      sku: "SYNTHETIC-SKU",
      name: "Synthetic product",
      recordedQuantity: "2",
      historicalUnit: null,
      recordedUnitPrice: "107",
    });
    const p = previewPlan(planScenario(i, "reorder"), i);
    expect(p.preview).toMatchObject({
      executableCart: false,
      reorderCadence: null,
      currentOrderTotal: null,
      operationalWrites: false,
    });
    expect(JSON.stringify(p)).not.toMatch(/buying_price|reorder_quantity/);
  });
  it("never falls back from missing Sales identity to team scope", async () => {
    const f = sourceFixture();
    f.identities.repIdsFor = async () => [];
    const read = jest.spyOn(f.customer, "planningSubject");
    await expect(
      f.service.inputs("sales_work", companyId, null, {
        ...planStaff,
        role: "sale",
      }),
    ).rejects.toThrow("identity");
    expect(read).not.toHaveBeenCalled();
  });
  it("team reads use the same native company boundary without manufacturing my assignment", async () => {
    const f = sourceFixture(),
      spy = jest.spyOn(f.customer, "planningSubject");
    const i = await f.service.inputs("sales_work", companyId, null, planStaff);
    expect(spy).toHaveBeenCalledWith(companyId, undefined);
    expect(i.scope).toBe("authorized_team_company");
    expect(previewPlan(planScenario(i), i).preview.readiness).toBe(
      "needs_confirmation",
    );
  });
  it("null assignment blocks follow-up and reorder rather than defaulting owner", async () => {
    const f = sourceFixture();
    f.company.assigned_sales_user_id = null as never;
    const i = await f.service.inputs(
      "sales_work",
      companyId,
      orderId,
      planStaff,
    );
    expect(i.followUpEligible).toBe(false);
    expect(i.reorderEligible).toBe(false);
    await expect(f.service.preview(planScenario(i), planStaff)).rejects.toThrow(
      "ineligible",
    );
  });
  it.each([
    { paid: false, status: "paid", reason: "order_not_paid" },
    { paid: true, status: "cancelled", reason: "order_status_ineligible" },
  ])("status and paid authority both govern eligibility: %j", async (row) => {
    const f = sourceFixture();
    f.order.planningOrders = async () => ({
      items: [
        {
          orders_id: orderId,
          order_number: "SYNTHETIC-1",
          status: row.status,
          paid: row.paid,
          create_date: "2026-10-09T10:00:00Z",
        },
      ],
      hasMore: false,
    });
    const i = await f.service.inputs(
      "sales_work",
      companyId,
      orderId,
      planStaff,
    );
    expect(i.reorderEligible).toBe(false);
    expect(i.knownReasons).toContain(row.reason);
  });
  it("empty or incomplete returned history never claims cadence or reads an out-of-page order", async () => {
    const f = sourceFixture();
    f.order.planningOrders = async () => ({ items: [], hasMore: true });
    const spy = jest.spyOn(f.order, "detail");
    const i = await f.service.inputs(
      "sales_work",
      companyId,
      orderId,
      planStaff,
    );
    expect(i.knownReasons).toContain("order_not_in_page");
    expect(i.historyHasMore).toBe(true);
    expect(i.reorderEligible).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
  it("history outages permit a labeled follow-up review, never a reorder", async () => {
    const f = sourceFixture();
    f.order.planningOrders = async () => {
      throw Error("SQL secret");
    };
    const i = await f.service.inputs("sales_work", companyId, null, planStaff);
    expect(i.historyCoverage).toBe("unavailable");
    expect(i.knownReasons).toContain("history_unavailable");
    expect(previewPlan(planScenario(i), i).preview.persisted).toBe(false);
    expect(JSON.stringify(i)).not.toContain("secret");
  });
  it("validates selected order company identity before projecting its lines", async () => {
    const f = sourceFixture();
    f.order.detail = async () => ({
      orders_id: orderId,
      company_id: repId,
      items: [],
    });
    const i = await f.service.inputs(
      "sales_work",
      companyId,
      orderId,
      planStaff,
    );
    expect(i.knownReasons).toContain("order_company_mismatch");
    expect(i.historicalLines).toEqual([]);
  });
  it("duplicate SKU and invalid quantities are excluded, never merged or defaulted", async () => {
    const f = sourceFixture();
    f.order.detail = async () =>
      ({
        orders_id: orderId,
        company_id: companyId,
        items: [
          { sku: "SYNTHETIC-SKU", qty: 1 },
          { sku: "SYNTHETIC-SKU", qty: 2 },
          { sku: "INVALID", qty: 0 },
        ],
      }) as never;
    const i = await f.service.inputs(
      "sales_work",
      companyId,
      orderId,
      planStaff,
    );
    expect(i.historicalLines).toEqual([]);
    expect(i.knownReasons).toEqual(
      expect.arrayContaining([
        "ambiguous_sku",
        "invalid_historical_quantity",
        "no_unambiguous_lines",
      ]),
    );
    expect(i.reorderEligible).toBe(false);
  });
  it("orders over the review limit block rather than silently truncate valid lines", async () => {
    const f = sourceFixture();
    f.order.detail = async () =>
      ({
        orders_id: orderId,
        company_id: companyId,
        items: Array.from({ length: 51 }, (_, n) => ({
          sku: `SKU-${n}`,
          qty: 1,
        })),
      }) as never;
    const i = await f.service.inputs(
      "sales_work",
      companyId,
      orderId,
      planStaff,
    );
    expect(i.knownReasons).toContain("line_limit_exceeded");
    expect(i.reorderEligible).toBe(false);
  });
  it("stable evidence has a stable fingerprint across read timestamps; changes require review", async () => {
    const f = sourceFixture(),
      a = await f.service.inputs("sales_work", companyId, orderId, planStaff);
    expect(
      (await f.service.inputs("sales_work", companyId, orderId, planStaff))
        .sourceFingerprint,
    ).toBe(a.sourceFingerprint);
    f.company.name = "Changed company";
    await expect(f.service.preview(planScenario(a), planStaff)).rejects.toThrow(
      "evidence changed",
    );
  });
  it("catalog evidence projects no cost and cannot establish campaign activation, ROAS, ATP or stock age", async () => {
    const f = sourceFixture(),
      i = await f.service.inputs("marketing_readiness", "SYNTHETIC-SKU", null, {
        ...planStaff,
        role: "marketing",
      });
    const p = previewPlan(planScenario(i), i);
    expect(p.preview.readiness).toBe("needs_confirmation");
    expect(p.preview.activationAllowed).toBe(false);
    expect(i.missing).toEqual(
      expect.arrayContaining([
        "stock_age",
        "effective_internal_cost",
        "spend",
        "attribution",
        "upstream_freshness",
      ]),
    );
    expect(JSON.stringify(i)).not.toMatch(
      /buying_price|reorder_quantity|contacts/,
    );
  });
  it.each([
    "inactive",
    "missing-price",
    "missing-image",
    "missing-category",
    "empty-stock",
    "backorder",
  ])(
    "catalog blocker %s is recorded with no invented readiness",
    async (flag) => {
      const f = sourceFixture();
      if (flag === "inactive") f.product.product_status = "inactive";
      if (flag === "missing-price") f.product.selling_price = 0;
      if (flag === "missing-image") f.product.image_count = 0;
      if (flag === "missing-category") f.product.category_id = null as never;
      if (flag === "empty-stock" || flag === "backorder") {
        f.product.product_inventory_quantity = 0;
        (f.product as Record<string, unknown>).order_taking_flag =
          flag === "backorder" ? "Y" : "N";
      }
      const i = await f.service.inputs(
        "marketing_readiness",
        "SYNTHETIC-SKU",
        null,
        planStaff,
      );
      expect(i.knownReasons.length).toBeGreaterThan(0);
      expect(previewPlan(planScenario(i), i).preview.readiness).toBe("blocked");
    },
  );
  it("exact SKU identity never aliases case or a catalog UUID", async () => {
    const f = sourceFixture();
    await expect(
      f.service.inputs("marketing_readiness", "synthetic-sku", null, planStaff),
    ).rejects.toThrow("exact catalog SKU");
    const i = await fixturePlanInputs("marketing_readiness");
    expect(() =>
      previewPlan({ ...planScenario(i), subjectId: "synthetic-sku" }, i),
    ).toThrow("identity");
  });
  it("revoked assignment/source failure propagate on private authorization", async () => {
    const f = sourceFixture();
    f.customer.planningSubject = async () => {
      throw new NotFoundException("Current scope unavailable");
    };
    await expect(
      f.service.authorize("sales_work", companyId, {
        ...planStaff,
        role: "sale",
      }),
    ).rejects.toThrow("scope");
    f.customer.planningSubject = async () => {
      throw Error("SQL credential");
    };
    await expect(
      f.service.authorize("sales_work", companyId, planStaff),
    ).rejects.toThrow("source unavailable");
  });
  it.each(["2026-02-30", "2026-99-01", "not-a-date"])(
    "invalid date %s yields a validation issue instead of crashing",
    async (date) => {
      const i = await fixturePlanInputs();
      expect(
        planScenarioSchema.safeParse({ ...planScenario(i), dueDate: date })
          .success,
      ).toBe(false);
    },
  );
  it("rejects stale/past dates, unknown/duplicate lines, invented actuals and false persistence", async () => {
    const i = await fixturePlanInputs(),
      s = planScenario(i, "reorder");
    expect(() => previewPlan({ ...s, dueDate: "2025-01-01" }, i)).toThrow(
      "past",
    );
    expect(() =>
      previewPlan(
        { ...s, lines: [{ sku: "UNKNOWN", proposedQuantity: "1" }] },
        i,
      ),
    ).toThrow("absent");
    expect(
      planScenarioSchema.safeParse({ ...s, lines: [s.lines[0], s.lines[0]] })
        .success,
    ).toBe(false);
    expect(planInputsSchema.safeParse({ ...i, actualMargin: 99 }).success).toBe(
      false,
    );
    expect(
      planInputsSchema.safeParse({
        ...i,
        subject: { ...i.subject, assignedRepId: null },
      }).success,
    ).toBe(false);
    expect(
      planReceiptSchema.safeParse({ ...previewPlan(s, i), persisted: false })
        .success,
    ).toBe(false);
  });
});
