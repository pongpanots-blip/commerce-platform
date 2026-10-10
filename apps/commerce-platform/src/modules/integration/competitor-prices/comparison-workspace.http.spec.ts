import "reflect-metadata";
import { INestApplication, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { StaffAuthGuard } from "../../core/auth/presentation/staff-auth.guard";
import { AllExceptionsFilter } from "../../../shared-kernel/presentation/all-exceptions.filter";
import { ComparisonWorkspaceController } from "./comparison-workspace.controller";
import { ComparisonWorkspaceService } from "./comparison-workspace.service";
import { CompetitorPricesController } from "./competitor-prices.controller";
import { CompetitorPricesService } from "./competitor-prices.service";
import { CompetitorReviewService } from "./competitor-review.service";
import {
  COMPARISON_OPERATIONS,
  type ComparisonCommand,
} from "./comparison-contracts";
const roles = [
  "admin",
  "marketing",
  "business_analyst",
  "sale",
  "sales_manager",
  "merchandising",
  "cs",
  "graphic",
];
const id = "00000000-0000-4000-8000-000000000010";
function command(
  operation: ComparisonCommand["operation"],
  pairId = id,
): ComparisonCommand {
  const pair = { pairId, revision: 1 };
  const identity = {
    name: "Synthetic competitor",
    competitorSku: "OTHER-SKU",
    context: "Recorded public product terms",
  };
  const note = "Reviewed actual synthetic source evidence";
  const pack = { unit: "piece" as const, min: "1", max: "1", count: 1 };
  switch (operation) {
    case "verify":
      return { operation, ...pair, relationship: "same_product", note };
    case "capture":
      return {
        operation,
        ...pair,
        price: "125.00",
        currency: "THB",
        taxBasis: "inclusive",
        priceBasis: "public",
        observedAt: "2026-10-10T00:00:00Z",
        context: identity.context,
      };
    case "remove":
      return { operation, ...pair, note };
    case "review":
      return { operation, note };
    case "pack":
      return { operation, ...pair, pack };
    case "refresh":
      return { operation, ...pair };
    case "settings":
      return {
        operation,
        ...pair,
        ...identity,
        collectionAllowed: false,
        autoRefresh: false,
      };
    case "reassign":
      return {
        operation,
        ...pair,
        ...identity,
        sourceUrl: "https://vendor.example.invalid/product",
        sourceId: null,
        note,
      };
    case "create":
      return {
        operation,
        ...identity,
        sourceUrl: "https://vendor.example.invalid/product",
        sourceId: null,
        catalogItemId: null,
        pack,
      };
  }
}
const packet = (...commands: ComparisonCommand[]) => ({
  requestId: id,
  sku: "SYNTHETIC-SKU",
  sourceFingerprint: "a".repeat(64),
  commands,
});
describe("comparison workspace with the original active DB StaffAuthGuard", () => {
  let app: INestApplication, base: string, jwt: JwtService;
  const service = {
    workspace: jest.fn(async () => ({ sku: "SYNTHETIC-SKU" })),
    sources: jest.fn(async () => []),
    candidates: jest.fn(async () => ({ sites: [] })),
    item: jest.fn(async () => ({ id })),
    history: jest.fn(async () => ({ pairId: id, items: [] })),
    handoff: jest.fn(async () => ({
      sku: "SYNTHETIC-SKU",
      activationAllowed: false,
    })),
    request: jest.fn(async (_id: string, actor: string) => {
      if (actor !== "admin")
        throw new NotFoundException("Private request unavailable");
      return { requestId: id };
    }),
    save: jest.fn(async (_body: unknown, actor: string, email: string) => ({
      actor,
      email,
      persisted: true,
    })),
  };
  const legacy = {
    list: jest.fn(async () => []),
    overview: jest.fn(async () => ({ rows: [] })),
    overviewXlsx: jest.fn(async () => Buffer.from("synthetic-report")),
    matchQueue: jest.fn(async () => []),
    siteCandidates: jest.fn(async () => []),
    catalog: jest.fn(async () => []),
    suggestions: jest.fn(async () => ({
      catalogItem: { id },
      suggestions: [],
    })),
    catalogItem: jest.fn(async () => ({ id })),
    save: jest.fn(),
    match: jest.fn(),
    confirm: jest.fn(),
    verify: jest.fn(),
    capture: jest.fn(),
    refresh: jest.fn(async () => ({ id })),
    remove: jest.fn(),
  };
  const legacyReview = {
    grid: jest.fn(async () => ({ rows: [] })),
    search: jest.fn(async () => []),
    setCell: jest.fn(),
    finish: jest.fn(),
  };
  const header = (sub: string, role = sub) => ({
    authorization: `Bearer ${jwt.sign({ sub, role }, { secret: "comparison-auth-fixture-only" })}`,
    "content-type": "application/json",
  });
  beforeAll(async () => {
    jwt = new JwtService();
    const users = {
      findOne: async ({ where }: { where: { id: string } }) =>
        roles.includes(where.id)
          ? {
              id: where.id,
              role: where.id,
              email: `${where.id}@example.invalid`,
              status: "active",
            }
          : where.id === "disabled"
            ? { id: where.id, role: "admin", status: "disabled" }
            : where.id === "pending"
              ? {
                  id: where.id,
                  role: "admin",
                  email: "pending@example.invalid",
                  status: "active",
                  mustChangePassword: true,
                }
              : null,
    };
    const m = await Test.createTestingModule({
      controllers: [ComparisonWorkspaceController, CompetitorPricesController],
      providers: [
        { provide: ComparisonWorkspaceService, useValue: service },
        { provide: CompetitorPricesService, useValue: legacy },
        { provide: CompetitorReviewService, useValue: legacyReview },
      ],
    }).compile();
    app = m.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalGuards(
      new StaffAuthGuard(
        new JwtService({ secret: "comparison-auth-fixture-only" }),
        new Reflector(),
        users as never,
      ),
    );
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/competitor-prices/workspace`;
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());
  it.each(roles)(
    "%s preserves competitor-reader ACL and denies broader roles before source reads",
    async (role) => {
      const r = await fetch(base + "/products/SYNTHETIC-SKU", {
        headers: header(role),
      });
      expect(r.status).toBe(
        ["admin", "marketing", "business_analyst", "merchandising"].includes(
          role,
        )
          ? 200
          : 403,
      );
      if (!r.ok) expect(service.workspace).not.toHaveBeenCalled();
    },
  );
  it.each(roles)(
    "%s allows verified reference/match writers and keeps BA/Sale read-only",
    async (role) => {
      const r = await fetch(base + "/actions", {
        method: "POST",
        headers: header(role),
        body: JSON.stringify(packet(command("verify"))),
      });
      expect(r.status).toBe(
        ["admin", "marketing", "merchandising"].includes(role) ? 201 : 403,
      );
      if (r.ok)
        expect(service.save).toHaveBeenCalledWith(
          packet(command("verify")),
          role,
          `${role}@example.invalid`,
        );
      else expect(service.save).not.toHaveBeenCalled();
    },
  );
  it.each([
    "sources",
    "products/SYNTHETIC-SKU/candidates",
    `items/${id}`,
    `pairs/${id}/history`,
    "handoff/SYNTHETIC-SKU",
  ])("BA can GET %s without any mutation call", async (path) => {
    expect(
      (await fetch(base + "/" + path, { headers: header("business_analyst") }))
        .status,
    ).toBe(200);
    expect(service.save).not.toHaveBeenCalled();
  });
  it("JWT admin claims cannot expand Sale or MER database operations", async () => {
    for (const role of ["sale", "merchandising"]) {
      expect(
        (
          await fetch(base + "/actions", {
            method: "POST",
            headers: header(role, "admin"),
            body: JSON.stringify(packet(command("refresh"))),
          })
        ).status,
      ).toBe(403);
      expect(
        (await fetch(base + "/sources", { headers: header(role, "admin") }))
          .status,
      ).toBe(role === "merchandising" ? 200 : 403);
    }
    expect(service.save).not.toHaveBeenCalled();
    expect(service.sources).toHaveBeenCalledTimes(1);
  });
  it.each(["capture", "verify"] as const)(
    "MER can persist only a valid %s packet under the verified DB actor",
    async (operation) => {
      const value = packet(command(operation));
      expect(
        (
          await fetch(base + "/actions", {
            method: "POST",
            headers: header("merchandising", "admin"),
            body: JSON.stringify(value),
          })
        ).status,
      ).toBe(201);
      expect(service.save).toHaveBeenCalledWith(
        value,
        "merchandising",
        "merchandising@example.invalid",
      );
    },
  );
  it.each(
    COMPARISON_OPERATIONS.filter((op) => !["capture", "verify"].includes(op)),
  )(
    "MER denies an entire packet containing %s before any service/source/vendor call",
    async (operation) => {
      const value = packet(
        command("capture"),
        command(operation, "00000000-0000-4000-8000-000000000011"),
      );
      const r = await fetch(base + "/actions", {
        method: "POST",
        headers: header("merchandising"),
        body: JSON.stringify(value),
      });
      expect(r.status).toBe(403);
      for (const action of Object.values(service))
        expect(action).not.toHaveBeenCalled();
    },
  );
  it.each(["admin", "marketing"])(
    "%s retains every original workspace operation",
    async (role) => {
      for (const operation of COMPARISON_OPERATIONS) {
        const value = packet(command(operation));
        expect(
          (
            await fetch(base + "/actions", {
              method: "POST",
              headers: header(role),
              body: JSON.stringify(value),
            })
          ).status,
        ).toBe(201);
        expect(service.save).toHaveBeenLastCalledWith(
          value,
          role,
          `${role}@example.invalid`,
        );
      }
    },
  );
  it.each([
    {},
    { ...packet(command("capture")), actor: "admin" },
    {
      ...packet(command("verify")),
      commands: [{ ...command("verify"), role: "admin" }],
    },
    packet(command("capture"), command("verify")),
    {
      ...packet(command("verify")),
      commands: [{ operation: "activate", pairId: id, revision: 1 }],
    },
    packet({ ...command("capture"), price: "0" } as ComparisonCommand),
  ])(
    "rejects malformed or identity-overridden MER requests before services: %j",
    async (value) => {
      expect(
        (
          await fetch(base + "/actions", {
            method: "POST",
            headers: header("merchandising"),
            body: JSON.stringify(value),
          })
        ).status,
      ).toBe(400);
      for (const action of Object.values(service))
        expect(action).not.toHaveBeenCalled();
    },
  );
  it.each([
    "sources",
    "products/SYNTHETIC-SKU/candidates",
    `items/${id}`,
    `pairs/${id}/history`,
    "handoff/SYNTHETIC-SKU",
  ])("MER can read %s without a mutation", async (path) => {
    expect(
      (await fetch(base + "/" + path, { headers: header("merchandising") }))
        .status,
    ).toBe(200);
    expect(service.save).not.toHaveBeenCalled();
  });
  it.each(["review", "overview", "overview/export", `suggestions/${id}`])(
    "MER canonical comparison can GET the selected legacy read %s",
    async (path) => {
      const r = await fetch(base.replace(/\/workspace$/, "") + "/" + path, {
        headers: header("merchandising"),
      });
      expect(r.status).toBe(200);
      await r.arrayBuffer();
      expect(legacy.save).not.toHaveBeenCalled();
      expect(legacyReview.setCell).not.toHaveBeenCalled();
      expect(legacyReview.finish).not.toHaveBeenCalled();
    },
  );
  it.each([
    "",
    "review/search?site=x&q=x&sku=x",
    "match-queue",
    "sku/SYNTHETIC-SKU/candidates",
    "catalog/SYNTHETIC-SKU",
    `catalog-items/${id}`,
  ])("MER does not gain unrelated legacy read %s", async (path) => {
    expect(
      (
        await fetch(base.replace(/\/workspace$/, "") + "/" + path, {
          headers: header("merchandising"),
        })
      ).status,
    ).toBe(403);
    for (const action of [
      ...Object.values(legacy),
      ...Object.values(legacyReview),
    ])
      expect(action).not.toHaveBeenCalled();
  });
  it.each([
    ["POST", ""],
    ["PUT", id],
    ["DELETE", id],
    ["POST", "review/cell"],
    ["POST", "review/finish"],
    ["POST", "match"],
    ["POST", `${id}/confirm`],
    ["POST", `${id}/verify`],
    ["POST", `${id}/price`],
    ["POST", `${id}/refresh`],
  ])(
    "MER cannot use legacy %s %s to bypass the canonical allowlist",
    async (method, path) => {
      expect(
        (
          await fetch(base.replace(/\/workspace$/, "") + "/" + path, {
            method,
            headers: header("merchandising", "admin"),
            body: "{}",
          })
        ).status,
      ).toBe(403);
      for (const action of [
        ...Object.values(legacy),
        ...Object.values(legacyReview),
      ])
        expect(action).not.toHaveBeenCalled();
    },
  );
  it.each(["admin", "marketing"])(
    "%s keeps existing legacy refresh permission",
    async (role) => {
      expect(
        (
          await fetch(base.replace(/\/workspace$/, "") + `/${id}/refresh`, {
            method: "POST",
            headers: header(role),
            body: "{}",
          })
        ).status,
      ).toBe(200);
      expect(legacy.refresh).toHaveBeenCalledWith(id);
    },
  );
  it.each(["disabled", "pending", "unknown"])(
    "rejects %s account before read/write service calls",
    async (sub) => {
      for (const method of ["GET", "POST"]) {
        const r = await fetch(
          base + (method === "GET" ? "/sources" : "/actions"),
          {
            method,
            headers: header(sub, "admin"),
            ...(method === "POST" ? { body: "{}" } : {}),
          },
        );
        expect(r.status).toBeGreaterThanOrEqual(400);
      }
      expect(service.sources).not.toHaveBeenCalled();
      expect(service.save).not.toHaveBeenCalled();
    },
  );
  it("private request lookup derives owner from verified staff identity", async () => {
    expect(
      (await fetch(base + `/requests/${id}`, { headers: header("admin") }))
        .status,
    ).toBe(200);
    expect(service.request).toHaveBeenCalledWith(id, "admin");
    expect(
      (await fetch(base + `/requests/${id}`, { headers: header("marketing") }))
        .status,
    ).toBe(404);
  });
  it("malformed request or pair identity fails before repository calls", async () => {
    expect(
      (await fetch(base + "/requests/not-a-uuid", { headers: header("admin") }))
        .status,
    ).toBe(400);
    expect(
      (
        await fetch(base + "/pairs/not-a-uuid/history", {
          headers: header("admin"),
        })
      ).status,
    ).toBe(400);
    expect(service.request).not.toHaveBeenCalled();
    expect(service.history).not.toHaveBeenCalled();
  });
  it("unauthenticated and developer identities cannot read competitor evidence", async () => {
    expect((await fetch(base + "/sources")).status).toBe(401);
    expect(
      (
        await fetch(base + "/sources", {
          headers: header("unknown", "developer"),
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(service.sources).not.toHaveBeenCalled();
  });
});
