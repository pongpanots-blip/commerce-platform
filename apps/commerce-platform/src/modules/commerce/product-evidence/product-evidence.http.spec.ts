import "reflect-metadata";
import { INestApplication, ServiceUnavailableException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { StaffAuthGuard } from "../../core/auth/presentation/staff-auth.guard";
import { AllExceptionsFilter } from "../../../shared-kernel/presentation/all-exceptions.filter";
import { ProductEvidenceController } from "./product-evidence.controller";
import { ProductEvidenceService } from "./product-evidence.service";

const roles = [
  "admin",
  "merchandising",
  "business_analyst",
  "marketing",
  "graphic",
  "cs",
  "sale",
  "sales_manager",
  "sale_manager",
];
type Account = {
  id: string;
  email: string;
  role: string;
  status: string;
  mustChangePassword?: boolean;
};
const resultFor = (sku: string) => ({
  sku,
  capturedAt: "2026-10-10T00:00:00.000Z",
  freshness: "unverified",
  prices: {
    source: "unavailable",
    recordedAt: null,
    sellingUnitPrice: null,
    orderingPrice: null,
    moq: null,
    currency: null,
    taxBasis: null,
  },
  cost: {
    source: "unavailable",
    recordedAt: null,
    amount: null,
    currency: null,
    unit: null,
    taxBasis: null,
    observedAt: null,
  },
  units: {
    source: "unavailable",
    recordedAt: null,
    selling: null,
    ordering: null,
    packSize: null,
  },
  stock: {
    status: "unavailable",
    unit: null,
    observedAt: null,
    warehouses: [],
  },
});

describe("product evidence HTTP least privilege with active StaffAuthGuard", () => {
  let app: INestApplication, base: string;
  const accounts = new Map<string, Account>(),
    jwt = new JwtService({
      secret: "product-evidence-owned-http-fixture-only",
    }),
    evidence = { item: jest.fn(async (sku: string) => resultFor(sku)) },
    users = {
      findOne: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          accounts.get(where.id) ?? null,
      ),
    };
  const headers = (sub: string, role = sub) => ({
    authorization: `Bearer ${jwt.sign({ sub, role })}`,
    "content-type": "application/json",
  });
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ProductEvidenceController],
      providers: [{ provide: ProductEvidenceService, useValue: evidence }],
    }).compile();
    app = mod.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalGuards(
      new StaffAuthGuard(jwt, new Reflector(), users as never),
    );
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/product-evidence`;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    evidence.item.mockImplementation(async (sku: string) => resultFor(sku));
    accounts.clear();
    for (const role of roles)
      accounts.set(role, {
        id: role,
        role,
        email: `${role}@example.invalid`,
        status: "active",
      });
  });
  afterAll(async () => app.close());

  it.each(roles)(
    "%s can read only under existing admin/MER evidence ACL",
    async (role) => {
      const response = await fetch(`${base}/S`, { headers: headers(role) });
      const allowed = ["admin", "merchandising"].includes(role);
      expect(response.status).toBe(allowed ? 200 : 403);
      if (allowed) {
        expect(await response.json()).toEqual(resultFor("S"));
        expect(evidence.item).toHaveBeenCalledWith("S");
      } else expect(evidence.item).not.toHaveBeenCalled();
    },
  );

  it("uses the current account role on every request rather than the signed or supplied role", async () => {
    const token = headers("merchandising", "admin");
    expect((await fetch(`${base}/S`, { headers: token })).status).toBe(200);
    accounts.get("merchandising")!.role = "business_analyst";
    evidence.item.mockClear();
    expect(
      (await fetch(`${base}/S?role=admin&actor=admin`, { headers: token }))
        .status,
    ).toBe(403);
    expect(evidence.item).not.toHaveBeenCalled();
    accounts.get("merchandising")!.role = "admin";
    expect((await fetch(`${base}/S`, { headers: token })).status).toBe(200);
    evidence.item.mockClear();
    expect(
      (await fetch(`${base}/S`, { headers: headers("graphic", "admin") }))
        .status,
    ).toBe(403);
    expect(evidence.item).not.toHaveBeenCalled();
  });

  it.each(["disabled", "removed", "pending-password"])(
    "blocks an account becoming %s before reading evidence",
    async (state) => {
      const token = headers("admin");
      expect((await fetch(`${base}/S`, { headers: token })).status).toBe(200);
      evidence.item.mockClear();
      if (state === "removed") accounts.delete("admin");
      else if (state === "pending-password")
        accounts.get("admin")!.mustChangePassword = true;
      else accounts.get("admin")!.status = "disabled";
      expect((await fetch(`${base}/S`, { headers: token })).status).toBe(
        state === "pending-password" ? 403 : 401,
      );
      expect(evidence.item).not.toHaveBeenCalled();
    },
  );

  it("rejects anonymous, expired and invalid tokens before evidence access", async () => {
    expect((await fetch(`${base}/S`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/S`, {
          headers: { authorization: "Bearer invalid-synthetic-token" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/S`, {
          headers: {
            authorization: `Bearer ${jwt.sign({ sub: "admin", role: "admin" }, { expiresIn: -1 })}`,
          },
        })
      ).status,
    ).toBe(401);
    expect(evidence.item).not.toHaveBeenCalled();
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"])(
    "%s has no product-evidence mutation route even for admin",
    async (method) => {
      expect(
        (
          await fetch(`${base}/S`, {
            method,
            headers: headers("admin"),
            body: JSON.stringify({ sellingUnitPrice: 1, quantity: 1 }),
          })
        ).status,
      ).toBe(404);
      expect(evidence.item).not.toHaveBeenCalled();
    },
  );

  it.each(["S/1", "S%2", " SKU ", "สินค้า-😀", "literal%2Fsku"])(
    "decodes exact SKU %p once and marks product evidence private/no-store",
    async (sku) => {
      const response = await fetch(`${base}/${encodeURIComponent(sku)}`, {
        headers: headers("merchandising"),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual(resultFor(sku));
      expect(evidence.item).toHaveBeenCalledWith(sku);
      expect(evidence.item).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps an unavailable evidence response private and retryable without a fabricated result", async () => {
    evidence.item.mockRejectedValueOnce(
      new ServiceUnavailableException(
        "Product evidence temporarily unavailable",
      ),
    );
    const failed = await fetch(`${base}/S`, { headers: headers("admin") });
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("private, no-store");
    expect(await failed.json()).not.toHaveProperty("prices");
    const retried = await fetch(`${base}/S`, { headers: headers("admin") });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(resultFor("S"));
    expect(evidence.item).toHaveBeenCalledTimes(2);
  });
});
