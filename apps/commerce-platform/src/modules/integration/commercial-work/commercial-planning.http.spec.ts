import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { StaffAuthGuard } from "../../core/auth/presentation/staff-auth.guard";
import { AllExceptionsFilter } from "../../../shared-kernel/presentation/all-exceptions.filter";
import { CommercialSourcesService } from "./commercial-sources.service";
import { CommercialDraftsService } from "./commercial-drafts.service";
import {
  SalesWorkController,
  MarketingReadinessController,
} from "./commercial-planning.controller";
import {
  sourceFixture,
  companyId,
  planStaff,
  planScenario,
} from "./plan-fixtures";
import { planPreviewUrl } from "./commercial-work";
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
describe("commercial plans through original StaffAuthGuard", () => {
  let app: INestApplication, base: string, jwt: JwtService;
  const sources = sourceFixture(),
    query = jest.fn(async () => []),
    transaction = jest.fn(async () => {
      throw Error("Synthetic storage offline");
    });
  beforeAll(async () => {
    jwt = new JwtService({ secret: "commercial-http-synthetic-only" });
    const users = {
      findOne: async ({ where }: { where: { id: string } }) =>
        roles.includes(where.id)
          ? {
              id: where.id,
              email: `${where.id}@example.invalid`,
              role: where.id,
              status: "active",
            }
          : where.id === "pending"
            ? {
                id: "pending",
                role: "admin",
                status: "active",
                mustChangePassword: true,
              }
            : where.id === "disabled"
              ? { id: "disabled", role: "admin", status: "disabled" }
              : null,
    };
    const m = await Test.createTestingModule({
      controllers: [SalesWorkController, MarketingReadinessController],
      providers: [
        { provide: CommercialSourcesService, useValue: sources.service },
        {
          provide: CommercialDraftsService,
          useValue: new CommercialDraftsService(
            { query, transaction } as never,
            sources.service,
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
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/reports`;
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());
  const headers = async (role: string, claim = role) => ({
    authorization: `Bearer ${await jwt.signAsync({ sub: role, role: claim })}`,
    "content-type": "application/json",
  });
  it("requires active verified staff and blocks password-reset accounts before reads or writes", async () => {
    expect((await fetch(`${base}/sales-work/subjects`)).status).toBe(401);
    for (const [role, status] of [
      ["disabled", 401],
      ["pending", 403],
    ])
      for (const method of ["GET", "POST"])
        expect(
          (
            await fetch(`${base}/sales-work/drafts`, {
              method,
              headers: await headers(String(role), "admin"),
              ...(method === "POST" ? { body: "{}" } : {}),
            })
          ).status,
        ).toBe(status);
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(roles)(
    "%s retains the correct Sales source boundary",
    async (role) => {
      const res = await fetch(`${base}/sales-work/inputs/${companyId}`, {
        headers: await headers(role),
      });
      expect(res.status).toBe(
        ["admin", "sale", "sales_manager"].includes(role) ? 200 : 403,
      );
      if (res.ok) {
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(await res.json()).toMatchObject({
          scope:
            role === "sale"
              ? "own_assigned_company"
              : "authorized_team_company",
          currentOrderTotal: null,
        });
      }
    },
  );
  it.each(roles)(
    "%s retains the correct Marketing catalog boundary",
    async (role) => {
      const res = await fetch(
        `${base}/marketing-readiness/inputs/SYNTHETIC-SKU`,
        { headers: await headers(role) },
      );
      expect(res.status).toBe(
        ["admin", "marketing"].includes(role) ? 200 : 403,
      );
      if (res.ok)
        expect(await res.json()).toMatchObject({
          roas: null,
          activationAllowed: false,
        });
    },
  );
  it("Sales remains read-only and BA gets no new company/campaign planning grant", async () => {
    for (const role of ["sale", "business_analyst"])
      for (const prefix of ["sales-work", "marketing-readiness"])
        for (const [method, tail] of [
          ["POST", "drafts"],
          ["PATCH", `drafts/${companyId}`],
        ])
          expect(
            (
              await fetch(`${base}/${prefix}/${tail}`, {
                method,
                headers: await headers(role),
                body: "{}",
              })
            ).status,
          ).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("uses the live database account role rather than an admin JWT claim", async () => {
    expect(
      (
        await fetch(`${base}/sales-work/drafts`, {
          headers: await headers("marketing", "admin"),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/marketing-readiness/drafts`, {
          headers: await headers("sale", "admin"),
        })
      ).status,
    ).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects actor, scope, actual, cross-kind, malformed and oversized inputs before persistence", async () => {
    const i = await sources.service.inputs(
        "sales_work",
        companyId,
        null,
        planStaff,
      ),
      s = planScenario(i),
      h = await headers("sales_manager");
    for (const body of [
      { actorId: "other" },
      { requestId: companyId, scenario: { ...s, actualMargin: 1 } },
      { requestId: companyId, scenario: { ...s, kind: "marketing_readiness" } },
      { requestId: "invalid", scenario: s },
    ])
      expect(
        (
          await fetch(`${base}/sales-work/drafts`, {
            method: "POST",
            headers: h,
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(400);
    for (const path of [
      "subjects?repIds=other",
      `inputs/${companyId}?salesUserId=other`,
      "drafts?actorId=other",
      "drafts/invalid",
      "preview?scenario=bad!",
      `preview?scenario=${"a".repeat(7001)}`,
    ])
      expect(
        (await fetch(`${base}/sales-work/${path}`, { headers: h })).status,
      ).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("GET preview stays unpersisted and GET empty lists are owner/kind scoped", async () => {
    const i = await sources.service.inputs("sales_work", companyId, null, {
      ...planStaff,
      role: "sale",
    });
    const res = await fetch(
      base.replace("/reports", "") + planPreviewUrl(planScenario(i)),
      { headers: await headers("sale") },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      preview: { persisted: false, executableCart: false },
    });
    const list = await fetch(`${base}/marketing-readiness/drafts`, {
      headers: await headers("marketing"),
    });
    expect(await list.json()).toEqual({ items: [], next: null });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("scenario->>'kind'=$2"),
      ["marketing", "marketing_readiness", null],
    );
    expect(transaction).not.toHaveBeenCalled();
  });
  it("authorized retain attempts report storage failure without success; operational endpoints do not exist", async () => {
    const i = await sources.service.inputs(
      "marketing_readiness",
      "SYNTHETIC-SKU",
      null,
      planStaff,
    );
    const res = await fetch(`${base}/marketing-readiness/drafts`, {
      method: "POST",
      headers: await headers("marketing"),
      body: JSON.stringify({ requestId: companyId, scenario: planScenario(i) }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).not.toMatchObject({ persisted: true });
    for (const prefix of ["sales-work", "marketing-readiness"])
      for (const tail of ["send", "order", "activate", "stock", "reverse"])
        expect(
          (
            await fetch(`${base}/${prefix}/${tail}`, {
              method: "POST",
              headers: await headers("admin"),
              body: "{}",
            })
          ).status,
        ).toBe(404);
  });
  it("a confirmed missing receipt has a distinct code from inaccessible historical source", async () => {
    const r = await fetch(`${base}/sales-work/requests/${companyId}`, {
      headers: await headers("sale"),
    });
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({
      error: { code: "PLAN_REQUEST_ABSENT" },
    });
  });
});
