/**
 * Read-only, column-only copies of the josh tables winback reads (josh `apps/backend/src/entities/`,
 * generated: relations dropped, every column kept as josh declares it). Registered ONLY on the josh
 * replica DataSource (JoshReplica) — not *.entity.ts, so commerce's own DataSource never loads them.
 * Class names are JoshX so their repository tokens never clash with commerce's own entities.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum OrderStatusEnum {
  PAYMENT_PENDING = 'payment_pending',
  PAID = 'paid',
  PREPARING = 'preparing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}
export enum FulfillmentTypeEnum {
  STANDARD = 'standard',
  PREORDER = 'preorder',
}


@Entity('users')
export class JoshUser {
     @PrimaryGeneratedColumn('uuid')

  id: string;

  @Column({ type: 'varchar', length: 100 })
  first_name: string;

  @Column({ type: 'varchar', length: 100 })
  last_name: string;

  @Column({ type: 'uuid', nullable: true })
  company_id: string;


  @Column({ type: 'varchar', length: 50, default: 'user' })
  role: string;

  /** Display-only title; not used for permissions. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  job_title: string | null;

  /** Set at signup: `home` | `business`. Null for legacy rows. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  account_type: 'home' | 'business' | null;

  /** Staff-join delivery contact; does not overwrite branch.recipient_name. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  recipient_name: string | null;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  /**
   * bcrypt hash. `select: false` keeps it out of every ORM read — including
   * `relations: ['user']` / `leftJoinAndSelect(... 'user')` that feed API
   * responses. The only readers (login, change password, delete account, and
   * the Basic-auth middleware for /api/docs) load it through
   * `findUserWithPassword` (shared/common/utils/find-user-with-password.ts) —
   * a new reader must use it too, or it compares against `undefined`.
   */
  @Column({ type: 'varchar', length: 255, select: false })
  password: string;

  /** Incremented on password reset so previously issued JWTs fail the auth guard. */
  @Column({ type: 'int', default: 0 })
  token_version: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  custype: string;

  /** ERP CUST_CODE — company-level, shared by every staff member of the same
   *  Company (see JagotaCustomerSyncService.backfillReturningCustomer). NOT
   *  unique: multiple users legitimately carry the same value. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  custcode: string;

  @Column({ type: 'varchar', length: 50, unique: true, nullable: true })
  legacy_custcode: string;

  @Column({ type: 'uuid', nullable: true })
  commerce_platform_customer_id: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  mobile_phone: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  nickname: string | null;

  @Column({ type: 'text', nullable: true })
  delivery_address: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'boolean', default: false })
  marketing_consent: boolean;

  /** Required PDPA / privacy-policy acceptance at signup. */
  @Column({ type: 'boolean', default: false })
  pdpa_consent: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  pdpa_consented_at: Date | null;

  @Column({ type: 'boolean', default: false })
  onboarding_completed: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  last_app_login_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  first_app_login_at: Date | null;

  /** Preferred content language (`languages.lang_code`). Null means not stated — treated as 'th'. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  preferred_language!: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;



}





@Entity('orders')
export class JoshOrder {
  @PrimaryGeneratedColumn('uuid')
  orders_id: string;

  @Column({ type: 'varchar', length: 50, unique: true, nullable: true })
  order_number: string; // เลขที่ออเดอร์ (เดาไม่ได้เพราะใช้สืบค้นแทน UUID หลังบ้าน)

  /**
   * Numeric `YYYYMMDD#####` identity for the order. Clients send it back as
   * `orderDocumentNo` to mint or resume a QR. Jagota `P_DOCUMENT` is the
   * shipment numbers of this order (comma-joined when split), not this column.
   * Shares the daily sequence with `shipments.shipment_number`, so the two
   * can never collide. Null on orders created before this existed.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  document_no: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  customer_code: string;

  @Column({ type: 'uuid', nullable: true })
  quotations_id: string;



  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0.0 })
  total_price: number;

  @Column({
    type: 'enum',
    enum: OrderStatusEnum,
    default: OrderStatusEnum.PAYMENT_PENDING,
  })
  status: OrderStatusEnum;

  @Column({ type: 'date', nullable: true })
  delivery_date: Date;

  @Column({ type: 'uuid', nullable: true })
  time_slot_id: string;


  @Column({ type: 'timestamp with time zone', nullable: true })
  sending_date: Date;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  create_date: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  end_date: Date;

  @Column({ type: 'uuid' })
  user_id: string;




  // 🌟 เพิ่มฟิลด์ Flag แจ้ง Jagota ERP ว่าออเดอร์นี้ซื้อผ่านระบบ Josh 
  @Column({ type: 'boolean', default: true })
  is_josh_order: boolean;

  // 🌟 1 Credit Note สามารถอยู่ได้หลาย Order (Many-to-One)
  @Column({ type: 'uuid', nullable: true })
  credit_note_id: string;

  @Column({ type: 'uuid', nullable: true })
  credit_back_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;


  @Column({ type: 'uuid', nullable: true })
  company_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  shop_id: string | null;

  @Column({ type: 'text', nullable: true })
  delivery_address_snapshot: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  subtotal_ex_vat: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  vat_amount: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  delivery_fee: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  discount_amount: number;

  /**
   * ส่วนลดคูปองฐาน inc VAT — ยอดที่ลูกค้าเห็นตอนกดใช้คูปองและเป็นยอดที่ `total_price`
   * ลดลงจริง ๆ (ดู docs/api-naming-glossary.md §2.1) เก็บแยกเพราะคูณกลับจาก
   * `discount_amount` ทีหลังคลาดไปหลักสตางค์
   * null = ออเดอร์ที่เกิดก่อนเก็บคอลัมน์นี้และหา usage row ไม่เจอตอน backfill
   */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  discount_inc_vat: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  product_discount_ex_vat: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  gross_ex_vat: number | null;

  @Column({ type: 'uuid', nullable: true })
  checkout_batch_id: string | null;


  @Column({
    type: 'enum',
    enum: FulfillmentTypeEnum,
    nullable: true,
  })
  fulfillment_type: FulfillmentTypeEnum | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  delivery_working_date: string | null;

  /** Customer's own Purchase Order reference — display/reporting only, not sent to ERP NARATION (future work). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  po_number: string | null;

  @Column({ type: 'text', nullable: true })
  remark: string | null;


  @Column({ type: 'varchar', length: 64, nullable: true })
  analytics_individual_id: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  analytics_session_id: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  analytics_platform: string | null;
}

// 🌟 ปรับแก้ประเภทไอดีจาก number เป็น string (เพื่อรองรับ UUID) และเพิ่มตัวเลือก CN / Invoice




@Entity('company') // 👈 ธุรกรรมนี้ห้ามหายเด็ดขาด! ต้องสะกดแบบนี้
export class JoshCompany {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  register_number: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string;

  @Column({ type: 'text', nullable: true })
  address: string;

  @Column({ type: 'text', nullable: true })
  billing_address: string | null;

  @Column({ type: 'varchar', length: 20, default: 'juristic' })
  business_type: string;

  // 💳 🌟 ส่วนที่เพิ่มขึ้นมาสำหรับ Credit Term 🌟
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  credit_limit: number; // วงเงินเครดิตสูงสุดที่บริษัทนี้ได้รับ เช่น 100000.00

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  credit_used: number; // วงเงินที่ใช้งานไปแล้ว (ยังไม่ชำระเงิน) เช่น 40000.00

  @Column({ type: 'int', default: 0 })
  credit_term_days: number; // จำนวนวันเครดิตเทอม เช่น 30 (ต้องจ่ายใน 30 วัน), 0 คือสด/COD

  /** วันที่รอบเครดิตเทอมต่ออายุอัตโนมัติ (จอ My Credit "Auto-renews") — null = ไม่แสดง */
  @Column({ type: 'date', nullable: true })
  credit_term_renews_at: string | null;

  @Column({ type: 'uuid', nullable: true })
  assigned_sales_user_id: string | null;

  @Column({ type: 'varchar', length: 20, default: 'thai' })
  document_language: string;

  /** ERP customer identity (CUSTOMER_CODE) — links this Company to ERP's /erpcompany
   *  push. Nullable — most companies today were created via Josh onboarding, not ERP.
   *  NOT unique: duplicate Josh companies may share one CUST_CODE (same as users.custcode). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  erp_customer_code: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;




}

// 🌟 อัปเดต DTO เพื่อให้รองรับการตั้งค่าจากแอดมิน


@Entity('restaurant_place')
@Index('uq_restaurant_place_fsq_id', ['fsq_id'], {
  unique: true,
  where: '"fsq_id" IS NOT NULL',
})
@Index('ix_restaurant_place_district', ['district'])
export class JoshRestaurantPlace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** At least one of name_th / name_en must be present (enforced at ingest). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  name_th: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name_en: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 7 })
  lat: number;

  @Column({ type: 'numeric', precision: 10, scale: 7 })
  lng: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  district: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  raw_category: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  fsq_id: string | null;

  /** Reserved for a v2 OSM coverage fill — see the implementation plan. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  osm_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  google_place_id: string | null;

  @Column({ type: 'varchar', length: 20 })
  source: string;

  // --- Enrichment (best-effort, all nullable) ---

  @Column({ type: 'numeric', precision: 3, scale: 2, nullable: true })
  rating: number | null;

  @Column({ type: 'int', nullable: true })
  review_count: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  price_range: string | null;

  @Column({ type: 'jsonb', nullable: true })
  popular_times: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  opening_hours: Record<string, unknown> | null;

  @Column({ type: 'boolean', nullable: true })
  dine_in: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  takeaway: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  delivery: boolean | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  enriched_at: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}

@Entity({ name: 'erp_sales_history', synchronize: false })
@Index('idx_esh_cust_date', ['cust_code', 'inv_date'])
export class JoshErpSalesHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** ERP customer code, e.g. `GNA47789`. Not the same code space as `orders.customer_code`. */
  @Column({ type: 'varchar', length: 16 })
  cust_code: string;

  /** Invoice date. A `date`, so several invoices on one day are 0 days apart. */
  @Column({ type: 'date' })
  inv_date: string;

  @Column({ type: 'varchar', length: 8 })
  inv_book: string;

  @Column({ type: 'int' })
  inv_no: number;

  /** Line amount. Sum per invoice-day for revenue. */
  @Column({ type: 'numeric', precision: 16, scale: 4, nullable: true })
  total: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  name_e: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  trade_name: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  del_province: string | null;
}

export const JOSH_REPLICA_TABLES = [JoshUser, JoshOrder, JoshCompany, JoshRestaurantPlace, JoshErpSalesHistory];
