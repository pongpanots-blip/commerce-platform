/** Catalog of domain events a portal account may subscribe a webhook to. */
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
  { type: 'customer.created', description: 'ลูกค้าใหม่ถูกสร้าง', example: { id: 'uuid' } },
  {
    type: 'customer.updated',
    description: 'ข้อมูลลูกค้าเปลี่ยน (รวม customer code จาก ERP)',
    example: { id: 'uuid' },
  },
  { type: 'product.updated', description: 'ข้อมูลสินค้าเปลี่ยน', example: { id: 'uuid' } },
  {
    type: 'inventory.updated',
    description: 'สต๊อกเปลี่ยน (จาก ERP หรือในแพลตฟอร์ม)',
    example: { id: 'uuid', quantity: 10, reserved: 2 },
  },
  { type: 'price.updated', description: 'ราคาเปลี่ยน', example: { id: 'uuid' } },
  {
    type: 'erp.sale-order.created',
    description: 'sale ฝั่ง ERP สร้าง order ตรง (demand visibility)',
    example: { webhookEventId: 'uuid', order: { ORDER_NUMBER: 'SO-...' } },
  },
];
