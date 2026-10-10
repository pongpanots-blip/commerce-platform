import "reflect-metadata";
import { INestApplication, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { StaffAuthGuard } from "../../core/auth/presentation/staff-auth.guard";
import { AllExceptionsFilter } from "../../../shared-kernel/presentation/all-exceptions.filter";
import { FinancialAnalysisController } from "./financial-analysis.controller";
import { FinancialAnalysisService } from "./financial-analysis.service";
import { FinancialReaderService } from "./financial-reader.service";
import {
  fixturePeriod,
  financeQuery,
  orderId,
  refundId,
} from "./finance-fixtures";
import { financeSearch } from "./financial-analysis";
import {
  fixtureGoalInputs,
  fixtureGoalScenario,
} from "../financial-goals/goal-fixtures";
import { goalRange } from "../financial-goals/financial-goals";
const roles = [
  "admin",
  "sale",
  "sales_manager",
  "marketing",
  "business_analyst",
  "merchandising",
  "cs",
  "graphic",
];
describe("financial analysis under the original active StaffAuthGuard", () => {
  let app: INestApplication, base: string, jwt: JwtService;
  const reader = {
    period: jest.fn(async (m: string, t: "UTC" | "Asia/Bangkok") =>
      fixturePeriod(m, "107.00", t),
    ),
    detail: jest.fn(
      async (
        kind: "orders" | "refunds",
        m: string,
        t: "UTC" | "Asia/Bangkok",
        id: string,
        owner?: string,
      ) => {
        const p = fixturePeriod(m, "107.00", t);
        return {
          kind,
          window: p.window,
          source: p.source,
          capturedAt: p.capturedAt,
          upstreamFreshness: "unverified",
          record: kind === "orders" ? p.orders!.items[0] : p.refunds!.items[0],
        };
      },
    ),
  };
  const context = {
    inputs: jest.fn(async (m: string) => ({
      ...fixtureGoalInputs(),
      period: m,
      range: goalRange(m),
    })),
  };
  const goals = {
    get: jest.fn(async (id: string, actor: string) => {
      if (actor !== "admin")
        throw new NotFoundException("Private goal not found");
      return {
        id,
        revision: 2,
        scenario: fixtureGoalScenario({
          ...fixtureGoalInputs(),
          period: "2026-09",
          range: goalRange("2026-09"),
        }),
      };
    }),
  };
  const h = async (role: string, claim = role) => ({
    authorization: `Bearer ${await jwt.signAsync({ sub: role, role: claim })}`,
    "content-type": "application/json",
  });
  beforeAll(async () => {
    jwt = new JwtService({ secret: "financial-http-owned-synthetic-only" });
    const users = {
      findOne: async ({ where }: { where: { id: string } }) =>
        roles.includes(where.id)
          ? {
              id: where.id,
              role: where.id,
              email: where.id + "@example.invalid",
              status: "active",
            }
          : where.id === "disabled"
            ? { id: where.id, role: "admin", status: "disabled" }
            : where.id === "pending"
              ? {
                  id: where.id,
                  role: "admin",
                  status: "active",
                  mustChangePassword: true,
                }
              : null,
    };
    const m = await Test.createTestingModule({
      controllers: [FinancialAnalysisController],
      providers: [
        { provide: FinancialReaderService, useValue: reader },
        {
          provide: FinancialAnalysisService,
          useValue: new FinancialAnalysisService(
            reader as never,
            context as never,
            goals as never,
          ),
        },
      ],
    }).compile();
    app = m.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalGuards(
      new StaffAuthGuard(jwt, new Reflector(), users as never),
    );
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/reports/financial-analysis`;
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());
  it.each(roles)(
    "%s retains the existing team-read boundary, not a new scope grant",
    async (role) => {
      const r = await fetch(base + financeSearch(financeQuery), {
        headers: await h(role),
      });
      expect(r.status).toBe(
        ["admin", "sales_manager", "business_analyst"].includes(role)
          ? 200
          : 403,
      );
      if (r.ok) {
        expect(r.headers.get("cache-control")).toBe("private, no-store");
        expect(await r.json()).toMatchObject({
          readOnly: true,
          operationalWrites: false,
          variance: { actualNetProfitExVat: null, actualGoalAttainment: null },
        });
      } else expect(reader.period).not.toHaveBeenCalled();
    },
  );
  it("uses verified database roles, never elevated JWT claims", async () => {
    expect(
      (
        await fetch(base + financeSearch(financeQuery), {
          headers: await h("sale", "admin"),
        })
      ).status,
    ).toBe(403);
    expect(reader.period).not.toHaveBeenCalled();
  });
  it("requires active staff and completed password reset before source calls", async () => {
    expect((await fetch(base + financeSearch(financeQuery))).status).toBe(401);
    for (const [role, status] of [
      ["disabled", 401],
      ["pending", 403],
    ] as const)
      expect(
        (
          await fetch(base + financeSearch(financeQuery), {
            headers: await h(role, "admin"),
          })
        ).status,
      ).toBe(status);
    expect(reader.period).not.toHaveBeenCalled();
  });
  it.each([
    "source=replica",
    "salesUserId=other",
    "actorId=other",
    "month=2026-09",
    "timezone=GMT",
    "goalId=bad",
  ])("rejects query overrides/duplicates %s before reads", async (extra) => {
    const r = await fetch(base + financeSearch(financeQuery) + "&" + extra, {
      headers: await h("business_analyst"),
    });
    expect(r.status).toBe(400);
    expect(reader.period).not.toHaveBeenCalled();
    expect(goals.get).not.toHaveBeenCalled();
  });
  it("rejects same/future months before any native read", async () => {
    for (const month of ["2026-08", "2099-01"])
      expect(
        (
          await fetch(
            base + "?" + new URLSearchParams({ ...financeQuery, month }),
            {
              headers: await h("admin"),
            },
          )
        ).status,
      ).toBe(400);
    expect(reader.period).not.toHaveBeenCalled();
  });
  it("resolves a selected private goal only with the verified actor, never hypothetical actuals", async () => {
    const q = { ...financeQuery, goalId: orderId };
    const r = await fetch(base + financeSearch(q), {
      headers: await h("admin"),
    });
    expect(r.status).toBe(200);
    expect(goals.get).toHaveBeenCalledWith(orderId, "admin");
    expect(await r.json()).toMatchObject({
      selectedGoal: {
        revision: 2,
        compatiblePeriod: true,
        actual: null,
        variance: null,
        attainment: null,
      },
      variance: { actualGoalVariance: null, actualGoalAttainment: null },
    });
  });
  it("another goal owner yields a useful unavailable context without revealing it or hiding source evidence", async () => {
    const r = await fetch(
      base + financeSearch({ ...financeQuery, goalId: orderId }),
      { headers: await h("business_analyst", "admin") },
    );
    expect(r.status).toBe(200);
    expect(goals.get).toHaveBeenCalledWith(orderId, "business_analyst");
    expect(await r.json()).toMatchObject({
      selectedGoal: null,
      goalContextIssue: "private_goal_unavailable",
      current: { coverage: "partial" },
    });
  });
  it("Bangkok boundaries are incompatible with existing UTC goal actual comparison", async () => {
    const r = await fetch(
      base +
        financeSearch({
          ...financeQuery,
          timezone: "Asia/Bangkok",
          goalId: orderId,
        }),
      { headers: await h("admin") },
    );
    expect(await r.json()).toMatchObject({
      selectedGoal: { compatiblePeriod: false, actual: null, variance: null },
      variance: { actualGoalAttainment: null },
    });
  });
  it("context failure leaves recorded financial coverage available", async () => {
    context.inputs.mockRejectedValueOnce(
      Error("Synthetic context unavailable"),
    );
    const r = await fetch(base + financeSearch(financeQuery), {
      headers: await h("admin"),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      goalContext: null,
      goalContextIssue: "context_unavailable",
      current: { coverage: "partial" },
    });
  });
  it("both evidence drilldowns keep bound UUID, month/timezone and original role rules", async () => {
    for (const role of roles)
      for (const path of [
        `orders/${orderId}`,
        `refunds/${orderId}/${refundId}`,
      ]) {
        const r = await fetch(
          base + "/" + path + "?month=2026-09&timezone=UTC",
          { headers: await h(role) },
        );
        expect(r.status).toBe(
          ["admin", "sales_manager", "business_analyst"].includes(role)
            ? 200
            : 403,
        );
      }
    expect(reader.detail).toHaveBeenCalledWith(
      "refunds",
      "2026-09",
      "UTC",
      refundId,
      orderId,
    );
  });
  it("no financial mutation route or BA read-only exception exists", async () => {
    for (const role of ["admin", "business_analyst"])
      for (const method of ["POST", "PATCH", "DELETE"])
        expect([403, 404]).toContain(
          (
            await fetch(base + financeSearch(financeQuery), {
              method,
              headers: await h(role),
              body: "{}",
            })
          ).status,
        );
    expect(reader.period).not.toHaveBeenCalled();
    expect(goals.get).not.toHaveBeenCalled();
  });
});
