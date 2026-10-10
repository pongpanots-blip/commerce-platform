import "reflect-metadata";
import { INestApplication, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { StaffAuthGuard } from "../../core/auth/presentation/staff-auth.guard";
import { AllExceptionsFilter } from "../../../shared-kernel/presentation/all-exceptions.filter";
import { AssignmentWorkspaceController } from "./assignment-workspace.controller";
import { AssignmentWorkspaceService } from "./assignment-workspace.service";
const roles = [
  "admin",
  "marketing",
  "business_analyst",
  "sale",
  "sales_manager",
  "sale_manager",
  "merchandising",
  "cs",
  "graphic",
];
const id = "00000000-0000-4000-8000-000000000010";
describe("assignment workspace with the original active DB StaffAuthGuard", () => {
  let app: INestApplication, base: string, jwt: JwtService;
  const service = {
    search: jest.fn(async () => []),
    review: jest.fn(async () => ({})),
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
    save: jest.fn(async (_body: unknown, actor: string, email?: string) => ({
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
      controllers: [AssignmentWorkspaceController],
      providers: [{ provide: AssignmentWorkspaceService, useValue: service }],
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
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/cs-admin/assignment-workspace`;
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());
  it.each(roles)(
    "%s retains original admin/manager search, review, save and request scope",
    async (role) => {
      for (const [path, method] of [
        ["companies", "GET"],
        ["review", "POST"],
        ["actions", "POST"],
        [`requests/${id}`, "GET"],
      ]) {
        const r = await fetch(base + "/" + path, {
          method,
          headers: header(role),
          ...(method === "POST" ? { body: "{}" } : {}),
        });
        if (["admin", "sales_manager", "sale_manager"].includes(role))
          expect(r.status).toBe(
            path.startsWith("requests") && role !== "admin"
              ? 404
              : method === "POST"
                ? 201
                : 200,
          );
        else expect(r.status).toBe(403);
      }
      if (!["admin", "sales_manager", "sale_manager"].includes(role)) {
        expect(service.search).not.toHaveBeenCalled();
        expect(service.review).not.toHaveBeenCalled();
        expect(service.save).not.toHaveBeenCalled();
        expect(service.request).not.toHaveBeenCalled();
      }
    },
  );
  it("rejects elevated JWT claims using the active database role", async () => {
    for (const role of [
      "sale",
      "business_analyst",
      "merchandising",
      "marketing",
      "cs",
    ])
      expect(
        (
          await fetch(base + "/actions", {
            method: "POST",
            headers: header(role, "admin"),
            body: "{}",
          })
        ).status,
      ).toBe(403);
    expect(service.save).not.toHaveBeenCalled();
  });
  it.each(["disabled", "pending", "unknown"])(
    "blocks %s account before assignment readers/writers",
    async (sub) => {
      for (const [path, method] of [
        ["companies", "GET"],
        ["actions", "POST"],
      ])
        expect(
          (
            await fetch(base + "/" + path, {
              method,
              headers: header(sub, "admin"),
              ...(method === "POST" ? { body: "{}" } : {}),
            })
          ).status,
        ).toBeGreaterThanOrEqual(400);
      expect(service.search).not.toHaveBeenCalled();
      expect(service.save).not.toHaveBeenCalled();
    },
  );
  it("takes receipt ownership from authenticated staff and validates request UUID", async () => {
    await fetch(base + `/requests/${id}?actor=other`, {
      headers: header("admin"),
    });
    expect(service.request).toHaveBeenCalledWith(id, "admin");
    service.request.mockClear();
    expect(
      (await fetch(base + "/requests/not-a-uuid", { headers: header("admin") }))
        .status,
    ).toBe(400);
    expect(service.request).not.toHaveBeenCalled();
  });
  it("takes save actor from verified staff identity, while service rejects unsupported body fields", async () => {
    await fetch(base + "/actions", {
      method: "POST",
      headers: header("sales_manager"),
      body: '{"actor":"admin"}',
    });
    expect(service.save).toHaveBeenCalledWith(
      { actor: "admin" },
      "sales_manager",
    );
  });
});
