import "reflect-metadata";
import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { StaffAuthGuard } from "../../core/auth/presentation/staff-auth.guard";
import { AllExceptionsFilter } from "../../../shared-kernel/presentation/all-exceptions.filter";
import { ManualPriceController } from "./manual-price.controller";
import { ManualPriceService } from "./manual-price.service";
import { ProductPricesController } from "./product-prices.controller";
import { ProductPricesService } from "./product-prices.service";
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
  ],
  id = "00000000-0000-4000-8000-0000000000ab";
describe("manual price edits with original active DB StaffAuthGuard", () => {
  let app: INestApplication, base: string;
  const jwt = new JwtService({ secret: "price-approval-local-fixture-only" });
  const approval = {
    pending: jest.fn(async () => ({ items: [] })),
    itemFor: jest.fn(async () => ({})),
    review: jest.fn(async () => ({})),
    save: jest.fn(async (_b: unknown, actor: string) => ({ actor })),
    request: jest.fn(async (_id: string, actor: string) => {
      if (actor !== "admin") throw new NotFoundException();
      return { requestId: id };
    }),
  };
  const legacy = {
    list: jest.fn(async () => []),
    pending: jest.fn(async () => []),
    approve: jest.fn(async () => ({ approved: 1 })),
    reject: jest.fn(async () => ({ rejected: 1 })),
    edit: jest.fn(async () => ({})),
  };
  const headers = (sub: string, role = sub) => ({
    authorization: `Bearer ${jwt.sign({ sub, role })}`,
    "content-type": "application/json",
  });
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ProductPricesController, ManualPriceController],
      providers: [
        { provide: ProductPricesService, useValue: legacy },
        { provide: ManualPriceService, useValue: approval },
      ],
    }).compile();
    app = mod.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalGuards(
      new StaffAuthGuard(jwt, new Reflector(), {
        findOne: async ({ where }: { where: { id: string } }) =>
          roles.includes(where.id)
            ? {
                id: where.id,
                role: where.id,
                status: "active",
                email: `${where.id}@example.invalid`,
              }
            : where.id === "disabled"
              ? { id: "disabled", role: "admin", status: "disabled" }
              : where.id === "pending"
                ? {
                    id: "pending",
                    role: "admin",
                    status: "active",
                    mustChangePassword: true,
                  }
                : null,
      } as never),
    );
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/product-prices`;
  });
  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());
  it.each(roles)(
    "%s has exactly original admin/MER access to old and new routes",
    async (role) => {
      for (const [path, method] of [
        ["editor/items/S", "GET"],
        ["", "GET"],
        ["editor/review", "POST"],
        ["editor/actions", "POST"],
        [`editor/requests/${id}`, "GET"],
        ["pending/approve", "POST"],
        ["pending/reject", "POST"],
        ["S", "PATCH"],
      ]) {
        const res = await fetch(`${base}/${path}`, {
          method,
          headers: headers(role),
          ...(method !== "GET"
            ? {
                body: JSON.stringify(
                  method === "PATCH"
                    ? { sellingUnitPrice: 1 }
                    : { skus: ["S"] },
                ),
              }
            : {}),
        });
        expect(res.status).toBe(
          ["admin", "merchandising"].includes(role)
            ? path.includes("requests/") && role !== "admin"
              ? 404
              : method === "POST"
                ? 201
                : 200
            : 403,
        );
      }
      if (!["admin", "merchandising"].includes(role)) {
        expect(approval.save).not.toHaveBeenCalled();
        expect(legacy.approve).not.toHaveBeenCalled();
      }
    },
  );
  it("uses the current account role and server actor, ignoring token role and body actor", async () => {
    const r = await fetch(`${base}/editor/actions`, {
      method: "POST",
      headers: headers("merchandising", "admin"),
      body: JSON.stringify({ actor: "other" }),
    });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ actor: "merchandising" });
    expect(
      (
        await fetch(`${base}/editor/actions`, {
          method: "POST",
          headers: headers("sale", "admin"),
          body: "{}",
        })
      ).status,
    ).toBe(403);
  });
  it.each(["disabled", "pending", "missing"])(
    "blocks %s accounts before reading or saving",
    async (role) => {
      expect(
        (
          await fetch(`${base}/editor/items/S`, {
            headers: headers(role, "admin"),
          })
        ).status,
      ).toBe(role === "pending" ? 403 : 401);
      expect(approval.itemFor).not.toHaveBeenCalled();
    },
  );
  it("rejects anonymous and invalid paging before the source read", async () => {
    expect((await fetch(`${base}/editor/items/S`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/pending?limit=101`, {
          headers: headers("admin"),
        })
      ).status,
    ).toBe(400);
    expect(approval.itemFor).not.toHaveBeenCalled();
  });
  it.each(["S/1", "S%2", " SKU ", "สินค้า-😀"])(
    "decodes an item deep link exactly once and preserves exact SKU %p",
    async (sku) => {
      const res = await fetch(
        `${base}/editor/items/${encodeURIComponent(sku)}`,
        {
          headers: headers("admin"),
        },
      );
      expect(res.status).toBe(200);
      expect(approval.itemFor).toHaveBeenCalledWith(sku);
    },
  );
  it("dispatches private recovery with the exact request ID and authenticated account", async () => {
    const res = await fetch(`${base}/editor/requests/${id.toUpperCase()}`, {
      headers: headers("admin"),
    });
    expect(res.status).toBe(200);
    expect(approval.request).toHaveBeenCalledWith(id.toUpperCase(), "admin");
  });
});
