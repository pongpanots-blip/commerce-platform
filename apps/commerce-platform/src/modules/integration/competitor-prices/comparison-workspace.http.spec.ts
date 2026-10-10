import "reflect-metadata";
import { INestApplication, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { StaffAuthGuard } from "../../core/auth/presentation/staff-auth.guard";
import { AllExceptionsFilter } from "../../../shared-kernel/presentation/all-exceptions.filter";
import { ComparisonWorkspaceController } from "./comparison-workspace.controller";
import { ComparisonWorkspaceService } from "./comparison-workspace.service";
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
      controllers: [ComparisonWorkspaceController],
      providers: [{ provide: ComparisonWorkspaceService, useValue: service }],
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
        ["admin", "marketing", "business_analyst"].includes(role) ? 200 : 403,
      );
      if (!r.ok) expect(service.workspace).not.toHaveBeenCalled();
    },
  );
  it.each(roles)(
    "%s preserves admin/Marketing writes and original BA/Sale read-only restriction",
    async (role) => {
      const r = await fetch(base + "/actions", {
        method: "POST",
        headers: header(role),
        body: "{}",
      });
      expect(r.status).toBe(["admin", "marketing"].includes(role) ? 201 : 403);
      if (r.ok)
        expect(service.save).toHaveBeenCalledWith(
          {},
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
  it("JWT admin claims cannot elevate Sale or MER database roles", async () => {
    for (const role of ["sale", "merchandising"]) {
      expect(
        (
          await fetch(base + "/actions", {
            method: "POST",
            headers: header(role, "admin"),
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect(
        (await fetch(base + "/sources", { headers: header(role, "admin") }))
          .status,
      ).toBe(403);
    }
    expect(service.save).not.toHaveBeenCalled();
    expect(service.sources).not.toHaveBeenCalled();
  });
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
