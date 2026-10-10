import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { SalesRepIdentity } from "../../core/auth/application/sales-rep-identity.service";
import { StaffRequest } from "../../../shared-kernel/presentation/auth.decorators";
import { JoshCustomers } from "../connector/josh/josh-customers";
import { JoshOrders } from "../connector/josh/josh-orders";
import { JoshProducts, productsSource } from "../connector/josh/josh-products";
import {
  planInputsSchema,
  planScenarioSchema,
  planSubjectsSchema,
  planUuid,
  previewPlan,
  type PlanInputs,
  type PlanKind,
} from "./commercial-work";
export type PlanStaff = StaffRequest["staff"];
type Row = Record<string, unknown>;
const date = (v: unknown) => {
  const d = v instanceof Date ? v : typeof v === "string" ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const decimal = (v: unknown, places: number, positive = false) => {
  const s = typeof v === "number" || typeof v === "string" ? String(v) : "";
  return new RegExp(`^\\d{1,12}(\\.\\d{1,${places}})?$`).test(s) &&
    (!positive || Number(s) > 0)
    ? s
    : null;
};
const title = (v: unknown, fallback: string) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 160) : fallback;
@Injectable()
export class CommercialSourcesService {
  constructor(
    private readonly customers: JoshCustomers,
    private readonly orders: JoshOrders,
    private readonly products: JoshProducts,
    private readonly identities: SalesRepIdentity,
  ) {}
  private async scope(staff: PlanStaff) {
    if (staff.role !== "sale") return undefined;
    const ids = await this.identities.repIdsFor(staff);
    if (!ids.length)
      throw new ForbiddenException("Sales assignment identity is unavailable");
    return ids;
  }
  private async safe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException(
        "Planning source unavailable. Refresh the authorized source and retry.",
      );
    }
  }
  async authorize(kind: PlanKind, id: string, staff: PlanStaff) {
    if (kind !== "sales_work") return;
    return this.safe(async () => {
      if (!this.customers.available)
        throw new ServiceUnavailableException("Customer source unavailable");
      return this.customers.planningSubject(
        planUuid.parse(id),
        await this.scope(staff),
      );
    });
  }
  async subjects(kind: PlanKind, search: string, staff: PlanStaff) {
    return this.safe(async () => {
      if (kind === "sales_work") {
        if (!this.customers.available)
          throw new ServiceUnavailableException("Customer source unavailable");
        const r = await this.customers.planningSubjects(
          search,
          await this.scope(staff),
        );
        return planSubjectsSchema.parse({
          ...r,
          items: r.items.map((x) => ({
            id: x.id,
            name: title(x.name, String(x.id)),
          })),
          coverage: "returned_page_only",
        });
      }
      if (!this.products.available)
        throw new ServiceUnavailableException("Catalog source unavailable");
      const r = await this.products.list({ search }, 1, 21);
      return planSubjectsSchema.parse({
        items: r.items
          .slice(0, 20)
          .map((x: Row) => ({
            id: x.product_inventory_sku,
            name: title(
              x.name_th ?? x.name_en,
              String(x.product_inventory_sku),
            ),
          })),
        hasMore: r.items.length > 20,
        coverage: "returned_page_only",
      });
    });
  }
  async inputs(
    kind: PlanKind,
    id: string,
    orderId: string | null,
    staff: PlanStaff,
  ): Promise<PlanInputs> {
    return this.safe(async () => {
      const reasons: PlanInputs["knownReasons"] = [];
      const base = {
        schemaVersion: 1 as const,
        kind,
        capturedAt: new Date().toISOString(),
        upstreamFreshness: "unverified" as const,
        orders: [] as PlanInputs["orders"],
        historyCoverage: "unavailable" as const,
        historyHasMore: null,
        selectedOrderId: orderId,
        historicalLines: [] as PlanInputs["historicalLines"],
        product: null,
        followUpEligible: false,
        reorderEligible: false,
        knownReasons: reasons,
        actualMargin: null,
        roas: null,
        currentOrderTotal: null,
        operationalWrites: false as const,
        activationAllowed: false as const,
      };
      let value: Omit<PlanInputs, "sourceFingerprint">;
      if (kind === "sales_work") {
        id = planUuid.parse(id);
        const reps = await this.scope(staff);
        if (!this.customers.available)
          throw new ServiceUnavailableException("Customer source unavailable");
        const company = await this.customers.planningSubject(id, reps),
          assigned = planUuid.safeParse(company.assigned_sales_user_id);
        value = {
          ...base,
          subject: {
            id,
            name: title(company.name, id),
            assignedRepId: assigned.success ? assigned.data : null,
          },
          scope:
            staff.role === "sale"
              ? "own_assigned_company"
              : "authorized_team_company",
          source: this.orders.source === "copies" ? "mixed" : "replica",
          missing: [
            "complete_history",
            "reorder_cadence",
            "selling_unit_mapping",
            "current_customer_price",
            "available_to_promise",
            "upstream_freshness",
          ],
          followUpEligible: assigned.success,
        };
        if (!assigned.success) reasons.push("assignment_unavailable");
        try {
          if (!this.orders.available) throw Error("unavailable");
          const page = await this.orders.planningOrders(id, reps);
          value.orders = page.items.map((x) => ({
            id: planUuid.parse(x.orders_id),
            number: typeof x.order_number === "string" ? x.order_number : null,
            status: String(x.status ?? ""),
            paid: typeof x.paid === "boolean" ? x.paid : null,
            createdAt: date(x.create_date),
          }));
          value.historyCoverage = "returned_page_only";
          value.historyHasMore = page.hasMore;
        } catch {
          reasons.push("history_unavailable");
        }
        if (!orderId) reasons.push("no_selected_order");
        else {
          const selected = value.orders.find((o) => o.id === orderId);
          if (!selected) reasons.push("order_not_in_page");
          else if (selected.paid !== true) reasons.push("order_not_paid");
          else if (
            !["paid", "preparing", "shipped", "delivered"].includes(
              selected.status,
            )
          )
            reasons.push("order_status_ineligible");
          else {
            try {
              const detail = (await this.orders.detail(orderId, reps)) as Row;
              if (detail.company_id !== id || detail.orders_id !== orderId)
                reasons.push("order_company_mismatch");
              else {
                const rows = Array.isArray(detail.items)
                  ? (detail.items as Row[])
                  : [];
                if (rows.length > 50) reasons.push("line_limit_exceeded");
                else {
                  const counts = new Map<string, number>();
                  for (const r of rows) {
                    const sku = String(r.sku ?? "").trim();
                    counts.set(sku, (counts.get(sku) ?? 0) + 1);
                  }
                  for (const r of rows) {
                    const sku = typeof r.sku === "string" ? r.sku.trim() : "";
                    if (!sku || sku.length > 100 || /[\x00-\x1f\x7f]/.test(sku))
                      continue;
                    if ((counts.get(sku) ?? 0) > 1) {
                      reasons.push("ambiguous_sku");
                      continue;
                    }
                    const q = decimal(r.qty, 3, true);
                    if (!q || q.split(".")[0].length > 8) {
                      reasons.push("invalid_historical_quantity");
                      continue;
                    }
                    value.historicalLines.push({
                      sku,
                      name: title(r.name, sku),
                      recordedQuantity: q,
                      historicalUnit: null,
                      recordedUnitPrice: decimal(r.unit_price, 2),
                    });
                  }
                }
                if (!value.historicalLines.length)
                  reasons.push("no_unambiguous_lines");
                value.reorderEligible =
                  value.followUpEligible &&
                  value.historicalLines.length > 0 &&
                  !reasons.includes("line_limit_exceeded");
              }
            } catch {
              reasons.push("history_unavailable");
            }
          }
        }
      } else {
        if (orderId)
          throw new BadRequestException(
            "Campaign evidence cannot select an order",
          );
        if (!this.products.available)
          throw new ServiceUnavailableException("Catalog source unavailable");
        const p = (await this.products.detail(id)) as Row;
        // Exact SKU identity; catalog UUID aliases are not a second planning subject.
        if (p.product_inventory_sku !== id)
          throw new BadRequestException("Choose the exact catalog SKU");
        const price = decimal(p.selling_unit_price, 2),
          stock =
            typeof p.product_inventory_quantity === "number" &&
            Number.isFinite(p.product_inventory_quantity)
              ? p.product_inventory_quantity
              : null,
          category = planUuid.safeParse(p.category_id),
          images =
            typeof p.image_count === "number" &&
            Number.isInteger(p.image_count) &&
            p.image_count >= 0
              ? p.image_count
              : null;
        const product = {
          status:
            typeof p.product_status === "string" ? p.product_status : null,
          recordedPrice: price,
          recordedStock: stock,
          sellingUnit:
            typeof p.selling_unit === "string" ? p.selling_unit : null,
          imageCount: images,
          categoryId: category.success ? category.data : null,
          sourceChangedAt: date(p.updated_at),
        };
        if (product.status !== "active") reasons.push("inactive_product");
        if (!price || Number(price) <= 0) reasons.push("price_unavailable");
        if (!images) reasons.push("image_missing");
        if (!category.success) reasons.push("category_missing");
        if (stock === null) reasons.push("stock_unknown");
        else if (stock <= 0)
          reasons.push(
            p.order_taking_flag === "Y"
              ? "backorder_confirmation_required"
              : "recorded_stock_empty",
          );
        value = {
          ...base,
          subject: {
            id,
            name: title(p.name_th ?? p.name_en, id),
            assignedRepId: null,
          },
          scope: "marketing_catalog",
          source: productsSource(),
          product,
          missing: [
            "available_to_promise",
            "stock_age",
            "effective_internal_cost",
            "spend",
            "attribution",
            "upstream_freshness",
          ],
        };
      }
      value.knownReasons = [...new Set(reasons)];
      const { capturedAt, ...fingerprint } = value;
      return planInputsSchema.parse({
        ...value,
        sourceFingerprint: createHash("sha256")
          .update(JSON.stringify(fingerprint))
          .digest("hex"),
      });
    });
  }
  async preview(raw: unknown, staff: PlanStaff) {
    const s = planScenarioSchema.parse(raw),
      i = await this.inputs(s.kind, s.subjectId, s.orderId, staff);
    if (s.sourceFingerprint !== i.sourceFingerprint)
      throw new ConflictException(
        "Source evidence changed. Refresh and review before saving.",
      );
    try {
      return previewPlan(s, i);
    } catch {
      throw new BadRequestException(
        "This proposal is ineligible or does not match the selected source.",
      );
    }
  }
}
