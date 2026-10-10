import "reflect-metadata";
import {
  BadRequestException,
  INestApplication,
  NotFoundException,
} from "@nestjs/common";
import { ModuleRef, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { StaffAuthGuard } from "../../core/auth/presentation/staff-auth.guard";
import { AllExceptionsFilter } from "../../../shared-kernel/presentation/all-exceptions.filter";
import { ProductContentEditorController } from "./product-content-editor.controller";
import { ProductContentEditorService } from "./product-content-editor.service";
import { productContentUpdateSchema } from "./product-content-editor-contracts";
import { JoshActionsController } from "../../integration/connector/josh/josh-actions.controller";
import { JoshActions } from "../../integration/connector/josh/josh-actions";
import { JoshCatalogSyncService } from "../../integration/connector/josh/josh-catalog-sync.service";
import { MarketingTesters } from "../../integration/connector/josh/marketing-testers";

const productId = "00000000-0000-4000-8000-0000000000ab",
  requestId = "00000000-0000-4000-8000-0000000000cd";
const roles = [
  "admin",
  "merchandising",
  "graphic",
  "marketing",
  "business_analyst",
  "sale",
  "sales_manager",
  "cs",
];
type Account = {
  id: string;
  role: string;
  email: string;
  status: string;
  mustChangePassword?: boolean;
};
describe("content editor evidence and private recovery with actual StaffAuthGuard", () => {
  let app: INestApplication, base: string, updateUrl: string;
  const accounts = new Map<string, Account>(),
    jwt = new JwtService({ secret: "content-editor-owned-http-fixture-only" });
  const editor = {
    itemFor: jest.fn(async (id: string) => ({ productId: id })),
    review: jest.fn(async (body: unknown) => ({ body })),
    request: jest.fn(async (id: string, actor: string) => {
      if (actor !== "admin")
        throw new NotFoundException(
          "Committed content edit not found for this account",
        );
      return { requestId: id, updatedBy: actor };
    }),
    saveFromProductUpdate: jest.fn(
      async (id: string, body: unknown, actor: string) => {
        if (!productContentUpdateSchema.safeParse(body).success)
          throw new BadRequestException("Invalid content edit");
        return { productId: id, updatedBy: actor };
      },
    ),
  };
  const josh = { run: jest.fn(async () => ({ unexpectedRelay: true })) },
    catalog = { syncId: jest.fn(async () => undefined) },
    modules = {
      get: jest.fn((token: unknown) => {
        if (token === ProductContentEditorService) return editor;
        throw Error("Unexpected legacy dependency in reviewed content update");
      }),
    },
    updateBody = {
      fields: { ingredients: null },
      contentEdit: { requestId, sku: "S", version: "a".repeat(64) },
    };
  const headers = (sub: string, role = sub) => ({
    authorization: `Bearer ${jwt.sign({ sub, role })}`,
    "content-type": "application/json",
  });
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ProductContentEditorController, JoshActionsController],
      providers: [
        { provide: ProductContentEditorService, useValue: editor },
        { provide: JoshActions, useValue: josh },
        { provide: JoshCatalogSyncService, useValue: catalog },
        { provide: MarketingTesters, useValue: {} },
        { provide: ModuleRef, useValue: modules },
      ],
    }).compile();
    app = mod.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalGuards(
      new StaffAuthGuard(jwt, new Reflector(), {
        findOne: async ({ where }: { where: { id: string } }) =>
          accounts.get(where.id) ?? null,
      } as never),
    );
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/product-content-editor`;
    updateUrl = `http://127.0.0.1:${app.getHttpServer().address().port}/api/josh/products/${productId}/update`;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    accounts.clear();
    for (const role of roles)
      accounts.set(role, {
        id: role,
        role,
        email: role + "@example.invalid",
        status: "active",
      });
  });
  afterAll(async () => app.close());
  it.each(roles)(
    "%s uses the existing reviewed update route only under admin/MER/graphic authority",
    async (role) => {
      const allowed = ["admin", "merchandising", "graphic"].includes(role),
        response = await fetch(updateUrl, {
          method: "POST",
          headers: headers(role),
          body: JSON.stringify(updateBody),
        });
      expect(response.status).toBe(allowed ? 200 : 403);
      if (allowed) {
        expect(await response.json()).toEqual({ productId, updatedBy: role });
        expect(editor.saveFromProductUpdate).toHaveBeenCalledWith(
          productId,
          updateBody,
          role,
        );
        expect(modules.get).toHaveBeenCalledWith(ProductContentEditorService, {
          strict: false,
        });
      } else {
        expect(editor.saveFromProductUpdate).not.toHaveBeenCalled();
        expect(modules.get).not.toHaveBeenCalled();
      }
      expect(josh.run).not.toHaveBeenCalled();
      expect(catalog.syncId).not.toHaveBeenCalled();
    },
  );
  it.each(["admin", "merchandising", "graphic"])(
    "rejects body actor spoof without trusting it or relaying for %s",
    async (role) => {
      const spoofed = { ...updateBody, actor: "another-account" },
        response = await fetch(updateUrl, {
          method: "POST",
          headers: headers(role, "admin"),
          body: JSON.stringify(spoofed),
        });
      expect(response.status).toBe(400);
      expect(editor.saveFromProductUpdate).toHaveBeenCalledWith(
        productId,
        spoofed,
        role,
      );
      expect(josh.run).not.toHaveBeenCalled();
      expect(catalog.syncId).not.toHaveBeenCalled();
    },
  );
  it("rechecks current account write authority with an existing token and denies anonymous updates", async () => {
    const token = headers("merchandising", "admin");
    accounts.get("merchandising")!.role = "marketing";
    expect(
      (
        await fetch(updateUrl, {
          method: "POST",
          headers: token,
          body: JSON.stringify(updateBody),
        })
      ).status,
    ).toBe(403);
    accounts.get("merchandising")!.role = "merchandising";
    accounts.get("merchandising")!.status = "disabled";
    expect(
      (
        await fetch(updateUrl, {
          method: "POST",
          headers: token,
          body: JSON.stringify(updateBody),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(updateUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(updateBody),
        })
      ).status,
    ).toBe(401);
    expect(editor.saveFromProductUpdate).not.toHaveBeenCalled();
    expect(modules.get).not.toHaveBeenCalled();
  });
  it.each(roles)(
    "%s has exactly existing admin/MER/graphic content scope",
    async (role) => {
      const allowed = ["admin", "merchandising", "graphic"].includes(role);
      for (const [path, method] of [
        [`items/${productId}`, "GET"],
        ["review", "POST"],
        [`requests/${requestId}`, "GET"],
      ]) {
        const response = await fetch(`${base}/${path}`, {
          method,
          headers: headers(role),
          ...(method === "POST"
            ? {
                body: JSON.stringify({
                  productId,
                  sku: "S",
                  version: "a".repeat(64),
                  fields: { ingredients: null },
                }),
              }
            : {}),
        });
        expect(response.status).toBe(
          allowed
            ? path.startsWith("requests/") && role !== "admin"
              ? 404
              : method === "POST"
                ? 201
                : 200
            : 403,
        );
      }
      if (!allowed) {
        expect(editor.itemFor).not.toHaveBeenCalled();
        expect(editor.review).not.toHaveBeenCalled();
        expect(editor.request).not.toHaveBeenCalled();
      }
    },
  );
  it("uses the current account role with the same token and ignores spoofed token/query roles", async () => {
    const token = headers("graphic", "admin");
    expect(
      (await fetch(`${base}/items/${productId}`, { headers: token })).status,
    ).toBe(200);
    accounts.get("graphic")!.role = "marketing";
    editor.itemFor.mockClear();
    expect(
      (
        await fetch(`${base}/items/${productId}?role=admin&actor=admin`, {
          headers: token,
        })
      ).status,
    ).toBe(403);
    expect(editor.itemFor).not.toHaveBeenCalled();
    expect(
      (
        await fetch(`${base}/review`, {
          method: "POST",
          headers: headers("sale", "admin"),
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(editor.review).not.toHaveBeenCalled();
  });
  it.each(["disabled", "removed", "pending-password"])(
    "blocks %s before content evidence or recovery",
    async (state) => {
      const token = headers("admin");
      if (state === "removed") accounts.delete("admin");
      else if (state === "pending-password")
        accounts.get("admin")!.mustChangePassword = true;
      else accounts.get("admin")!.status = "disabled";
      for (const path of [`items/${productId}`, `requests/${requestId}`])
        expect(
          (await fetch(`${base}/${path}`, { headers: token })).status,
        ).toBe(state === "pending-password" ? 403 : 401);
      expect(editor.itemFor).not.toHaveBeenCalled();
      expect(editor.request).not.toHaveBeenCalled();
    },
  );
  it("keeps evidence and original outcome private and dispatches recovery only for the server actor", async () => {
    const item = await fetch(`${base}/items/${productId.toUpperCase()}`, {
      headers: headers("graphic"),
    });
    expect(item.status).toBe(200);
    expect(item.headers.get("cache-control")).toBe("private, no-store");
    expect(editor.itemFor).toHaveBeenCalledWith(productId.toUpperCase());
    const recovered = await fetch(`${base}/requests/${requestId}?actor=other`, {
      headers: headers("admin"),
    });
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("cache-control")).toBe("private, no-store");
    expect(editor.request).toHaveBeenCalledWith(requestId, "admin");
  });
  it.each(["actions", "save", `items/${productId}`])(
    "does not introduce a second POST mutation route at %s",
    async (path) => {
      expect(
        (
          await fetch(`${base}/${path}`, {
            method: "POST",
            headers: headers("admin"),
            body: JSON.stringify({ fields: { ingredients: "x" } }),
          })
        ).status,
      ).toBe(404);
      expect(editor.itemFor).not.toHaveBeenCalled();
      expect(editor.review).not.toHaveBeenCalled();
      expect(editor.request).not.toHaveBeenCalled();
    },
  );
  it("rejects anonymous and invalid tokens before evidence access", async () => {
    expect((await fetch(`${base}/items/${productId}`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/review`, {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic-invalid-token",
            "content-type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect(editor.itemFor).not.toHaveBeenCalled();
    expect(editor.review).not.toHaveBeenCalled();
  });
});
