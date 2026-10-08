/**
 * Catalog of domain events a portal account may subscribe a webhook to.
 *
 * This list is also the delivery allowlist for portal subscriptions
 * (`accountId` set): `WebhookSubscriptionService.matching` only fans an event
 * out to them when its type is listed here, and "*" means "everything listed
 * here". Customer events and raw ERP sale orders carry customer data from
 * every account, so they stay admin-only (`accountId` null) until there is a
 * real tenant model — do not add them back.
 */
export interface CatalogEvent {
  type: string;
  description: string;
  example: Record<string, unknown>;
}

export const EVENT_CATALOG: CatalogEvent[] = [
  { type: 'order.created', description: 'มีการสร้าง order ใหม่ในแพลตฟอร์ม', example: { id: 'uuid' } },
  {
    type: 'order.confirmed',
    description: 'order ชำระเงินสำเร็จและยืนยันแล้ว (จองสต๊อกสำเร็จ)',
    example: { id: 'uuid' },
  },
  { type: 'order.cancelled', description: 'order ถูกยกเลิก', example: { id: 'uuid' } },
  { type: 'product.updated', description: 'ข้อมูลสินค้าเปลี่ยน', example: { id: 'uuid' } },
  {
    type: 'inventory.updated',
    description: 'สต๊อกเปลี่ยน (จาก ERP หรือในแพลตฟอร์ม)',
    example: { id: 'uuid', quantity: 10, reserved: 2 },
  },
  {
    type: 'inventory.sellable.snapshot',
    description: 'stock ที่ขายได้ต่อ SKU (รวมทุกคลังที่ขายได้) หลังมีการเคลื่อนไหว — เก็บตัวที่ version ใหม่สุด',
    example: { sku: '1001876', sellableQty: 48, version: '2026-10-07T03:00:00.000Z', erp: { PRODUCT_CODE: '1001876', QUANTITY: 48, CHANGED_AT: '2026-10-07T03:00:00.000Z' } },
  },
  { type: 'product.promotion-rules.snapshot', description: 'Product quantity promotion rules (whole replacement; empty clears)', example: { sku: '1001876', rules: [], version: '1' } },
  { type: 'price.updated', description: 'ราคาเปลี่ยน', example: { id: 'uuid' } },
];

/** Event types a portal subscription may receive (see the note above). */
export const PORTAL_EVENT_TYPES: ReadonlySet<string> = new Set(EVENT_CATALOG.map((e) => e.type));
