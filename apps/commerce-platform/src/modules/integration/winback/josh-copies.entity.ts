/**
 * The josh rows winback reads, as commerce's own copies (stage 2c — no josh replica): users = josh_users (view over
 * customer.snapshot ∪ staff.snapshot), orders = josh_orders (order.snapshot), companies / restaurant places = josh
 * events, ERP sales history = one-off import. Read-only: josh owns these rows. Only the columns the copies hold —
 * column names as in josh, so winback's queries (ported from josh) run unchanged. Class names JoshX keep their
 * repository tokens apart from commerce's own entities.
 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

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

@Entity({ name: 'josh_users', synchronize: false })
export class JoshUser {
  @PrimaryColumn('uuid') id: string;
  @Column({ type: 'varchar', nullable: true }) email: string;
  @Column({ type: 'varchar', nullable: true }) first_name: string;
  @Column({ type: 'varchar', nullable: true }) last_name: string;
  @Column({ type: 'varchar', nullable: true }) role: string;
  @Column({ type: 'boolean' }) is_active: boolean;
  @Column({ type: 'uuid', nullable: true }) company_id: string;
  @Column({ type: 'varchar', nullable: true }) custcode: string;
  @Column({ type: 'varchar', nullable: true }) legacy_custcode: string;
  @Column({ type: 'timestamptz', nullable: true }) created_at: Date;
  @Column({ type: 'timestamptz', nullable: true }) last_app_login_at: Date | null;
  @Column({ type: 'boolean' }) onboarding_completed: boolean;
  /** josh app_roles.user_type = 'internal' (staff only). */
  @Column({ type: 'boolean' }) internal: boolean;
}

@Entity({ name: 'josh_orders', synchronize: false })
export class JoshOrder {
  @PrimaryColumn('uuid') orders_id: string;
  @Column({ type: 'varchar', nullable: true }) customer_code: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) total_price: number;
  @Column({ type: 'varchar' }) status: OrderStatusEnum;
  @Column({ type: 'timestamptz' }) create_date: Date;
  @Column({ type: 'uuid', nullable: true }) user_id: string;
  @Column({ type: 'uuid', nullable: true }) company_id: string | null;
}

@Entity({ name: 'josh_companies', synchronize: false })
export class JoshCompany {
  @PrimaryColumn('uuid') id: string;
  @Column({ type: 'varchar', nullable: true }) name: string;
  @Column({ type: 'varchar', nullable: true }) register_number: string | null;
}

@Entity({ name: 'josh_restaurant_places', synchronize: false })
export class JoshRestaurantPlace {
  @PrimaryColumn('uuid') id: string;
  @Column({ type: 'varchar', nullable: true }) name_th: string | null;
  @Column({ type: 'varchar', nullable: true }) name_en: string | null;
  @Column({ type: 'numeric', precision: 10, scale: 7 }) lat: number;
  @Column({ type: 'numeric', precision: 10, scale: 7 }) lng: number;
  @Column({ type: 'varchar', nullable: true }) district: string | null;
  @Column({ type: 'varchar', nullable: true }) raw_category: string | null;
  @Column({ type: 'varchar', nullable: true }) fsq_id: string | null;
  @Column({ type: 'varchar', nullable: true }) osm_id: string | null;
  @Column({ type: 'varchar', nullable: true }) google_place_id: string | null;
  @Column({ type: 'varchar' }) source: string;
  @Column({ type: 'numeric', precision: 3, scale: 2, nullable: true }) rating: number | null;
  @Column({ type: 'int', nullable: true }) review_count: number | null;
  @Column({ type: 'varchar', nullable: true }) price_range: string | null;
  @Column({ type: 'jsonb', nullable: true }) popular_times: Record<string, unknown> | null;
  @Column({ type: 'jsonb', nullable: true }) opening_hours: Record<string, unknown> | null;
  @Column({ type: 'boolean', nullable: true }) dine_in: boolean | null;
  @Column({ type: 'boolean', nullable: true }) takeaway: boolean | null;
  @Column({ type: 'boolean', nullable: true }) delivery: boolean | null;
  @Column({ type: 'timestamptz', nullable: true }) enriched_at: Date | null;
  @Column({ type: 'timestamptz' }) created_at: Date;
  @Column({ type: 'timestamptz' }) updated_at: Date;
}

@Entity({ name: 'josh_erp_sales_history', synchronize: false })
export class JoshErpSalesHistory {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ type: 'varchar' }) cust_code: string;
  @Column({ type: 'date' }) inv_date: string;
  @Column({ type: 'numeric', precision: 16, scale: 4, nullable: true }) total: string | null;
  @Column({ type: 'varchar', nullable: true }) del_province: string | null;
}

export const JOSH_COPY_TABLES = [JoshUser, JoshOrder, JoshCompany, JoshRestaurantPlace, JoshErpSalesHistory];
