import {
  CommercialSourcesService,
  PlanStaff,
} from "./commercial-sources.service";
import {
  planScenarioSchema,
  type PlanKind,
  type PlanInputs,
} from "./commercial-work";
export const companyId = "00000000-0000-4000-8000-000000000001",
  orderId = "00000000-0000-4000-8000-000000000002",
  repId = "00000000-0000-4000-8000-000000000003",
  categoryId = "00000000-0000-4000-8000-000000000004";
export const planStaff: PlanStaff = {
  userId: repId,
  email: "commercial-fixture@example.invalid",
  role: "sales_manager",
};
export function sourceFixture() {
  const company = {
    id: companyId,
    name: "Synthetic assigned company",
    assigned_sales_user_id: repId,
  };
  const customer = {
    available: true,
    planningSubject: async () => company,
    planningSubjects: async () => ({ items: [company], hasMore: false }),
  };
  const order = {
    available: true,
    source: "copies",
    planningOrders: async () => ({
      items: [
        {
          orders_id: orderId,
          order_number: "SYNTHETIC-1",
          status: "paid",
          paid: true,
          create_date: "2026-10-09T10:00:00Z",
        },
      ],
      hasMore: false,
    }),
    detail: async () => ({
      orders_id: orderId,
      company_id: companyId,
      items: [
        {
          sku: "SYNTHETIC-SKU",
          name: "Synthetic product",
          qty: 2,
          unit_price: 107,
          buying_price: 1,
        },
      ],
    }),
  };
  const product = {
    product_inventory_sku: "SYNTHETIC-SKU",
    name_en: "Synthetic product",
    product_status: "active",
    selling_price: 107,
    product_inventory_quantity: 9,
    selling_unit: "PK",
    image_count: 2,
    category_id: categoryId,
    updated_at: "2026-10-09T09:00:00Z",
    buying_price: 1,
    reorder_quantity: 99,
  };
  const products = {
    available: true,
    list: async () => ({ items: [product] }),
    detail: async () => product,
  };
  const identities = { repIdsFor: async () => [repId] };
  const service = new CommercialSourcesService(
    customer as never,
    order as never,
    products as never,
    identities as never,
  );
  return { service, customer, order, products, company, product, identities };
}
export function planScenario(
  i: PlanInputs,
  task = i.kind === "sales_work" ? "follow_up" : "campaign_brief",
) {
  return planScenarioSchema.parse({
    kind: i.kind,
    task,
    name: "Synthetic private work plan",
    subjectId: i.subject.id,
    orderId: i.selectedOrderId,
    note: "Review recorded evidence with a person; confirm missing source contracts.",
    dueDate: null,
    sourceFingerprint: i.sourceFingerprint,
    lines:
      task === "reorder"
        ? [{ sku: "SYNTHETIC-SKU", proposedQuantity: "3" }]
        : [],
  });
}
export async function fixturePlanInputs(kind: PlanKind = "sales_work") {
  return sourceFixture().service.inputs(
    kind,
    kind === "sales_work" ? companyId : "SYNTHETIC-SKU",
    kind === "sales_work" ? orderId : null,
    planStaff,
  );
}
