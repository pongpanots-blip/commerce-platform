import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Commerce's copy of every josh order (checkout step 2): josh's columns and names, money as josh
 * stores it. Filled from josh's replica (backfill + refresh) and right after checkout when josh
 * tells commerce (ORDERS_COPY_TO_COMMERCE). Commerce's own record if josh is down.
 */
@Entity('josh_orders')
@Index('ix_josh_orders_create_date', ['createDate'])
@Index('ix_josh_orders_company', ['companyId', 'createDate'])
export class JoshOrderCopy {
  @PrimaryColumn({ name: 'orders_id', type: 'uuid' }) ordersId: string;
  @Column({ name: 'order_number', type: 'varchar', length: 100, nullable: true }) orderNumber: string | null;
  @Column({ type: 'varchar', length: 50 }) status: string;
  @Column({ name: 'payment_type', type: 'varchar', length: 50, nullable: true }) paymentType: string | null;
  /** A real (non-test) payment succeeded for this order (josh payment_transactions / links). */
  @Column({ default: false }) paid: boolean;
  @Column({ name: 'fulfillment_type', type: 'varchar', length: 50, nullable: true }) fulfillmentType: string | null;
  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId: string | null;
  @Column({ name: 'company_id', type: 'uuid', nullable: true }) companyId: string | null;
  @Column({ name: 'branch_id', type: 'uuid', nullable: true }) branchId: string | null;
  @Column({ name: 'customer_code', type: 'varchar', length: 100, nullable: true }) customerCode: string | null;
  @Column({ name: 'checkout_batch_id', type: 'uuid', nullable: true }) checkoutBatchId: string | null;
  @Column({ name: 'total_price', type: 'numeric', precision: 14, scale: 2, nullable: true }) totalPrice: string | null;
  @Column({ name: 'subtotal_ex_vat', type: 'numeric', precision: 14, scale: 2, nullable: true }) subtotalExVat: string | null;
  @Column({ name: 'vat_amount', type: 'numeric', precision: 14, scale: 2, nullable: true }) vatAmount: string | null;
  @Column({ name: 'delivery_fee', type: 'numeric', precision: 14, scale: 2, nullable: true }) deliveryFee: string | null;
  @Column({ name: 'discount_amount', type: 'numeric', precision: 14, scale: 2, nullable: true }) discountAmount: string | null;
  @Column({ name: 'discount_inc_vat', type: 'numeric', precision: 14, scale: 2, nullable: true }) discountIncVat: string | null;
  @Column({ name: 'product_discount_ex_vat', type: 'numeric', precision: 14, scale: 2, nullable: true }) productDiscountExVat: string | null;
  @Column({ name: 'gross_ex_vat', type: 'numeric', precision: 14, scale: 2, nullable: true }) grossExVat: string | null;
  @Column({ name: 'delivery_date', type: 'date', nullable: true }) deliveryDate: string | null;
  @Column({ name: 'po_number', type: 'varchar', length: 100, nullable: true }) poNumber: string | null;
  @Column({ name: 'document_no', type: 'varchar', length: 100, nullable: true }) documentNo: string | null;
  @Column({ type: 'text', nullable: true }) remark: string | null;
  @Column({ name: 'create_date', type: 'timestamptz' }) createDate: Date;
  @Column({ name: 'end_date', type: 'timestamptz', nullable: true }) endDate: Date | null;
  @Column({ name: 'copied_at', type: 'timestamptz', default: () => 'now()' }) copiedAt: Date;
}

/** Lines of a copied josh order (josh order_items + the SKU). */
@Entity('josh_order_lines')
@Index('ix_josh_order_lines_order', ['ordersId'])
export class JoshOrderLineCopy {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'orders_id', type: 'uuid' }) ordersId: string;
  @Column({ name: 'product_inventory_id', type: 'uuid', nullable: true }) productInventoryId: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) sku: string | null;
  @Column({ name: 'product_price', type: 'numeric', precision: 14, scale: 2 }) productPrice: string;
  @Column({ name: 'product_quantity', type: 'int' }) productQuantity: number;
  @Column({ type: 'varchar', length: 50, nullable: true }) status: string | null;
  @Column({ name: 'fulfillment_type', type: 'varchar', length: 50, nullable: true }) fulfillmentType: string | null;
  @Column({ name: 'price_source', type: 'varchar', length: 50, nullable: true }) priceSource: string | null;
  @Column({ name: 'promotion_mechanic_id', type: 'uuid', nullable: true }) promotionMechanicId: string | null;
  @Column({ name: 'unit_list_price_inc_vat', type: 'numeric', precision: 14, scale: 2, nullable: true }) unitListPriceIncVat: string | null;
  @Column({ name: 'line_revenue', type: 'numeric', precision: 14, scale: 2, nullable: true }) lineRevenue: string | null;
  @Column({ name: 'shipment_id', type: 'uuid', nullable: true }) shipmentId: string | null;
}
