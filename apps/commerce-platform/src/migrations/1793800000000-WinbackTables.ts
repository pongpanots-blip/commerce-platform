import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Winback (sales win-back CRM, the saleactivity app) moves to commerce: josh's six winback tables,
 * column for column as josh has them (josh migrations up to 1791770000000-WinbackAccountProvince).
 * restaurant_place_id has no FK here — restaurant_place lives in josh (read from its replica).
 */
export class WinbackTables1793800000000 implements MigrationInterface {
  name = 'WinbackTables1793800000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE winback_account (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    customer_code character varying(50) NOT NULL,
    display_name character varying(255),
    phone character varying(50),
    register_number character varying(100),
    source character varying(20) DEFAULT 'josh'::character varying NOT NULL,
    josh_user_id uuid,
    josh_company_id uuid,
    last_order_at timestamp with time zone,
    lifetime_spend_hint numeric(12,2),
    inactive_days integer DEFAULT 0 NOT NULL,
    health character varying(20) DEFAULT 'dormant'::character varying NOT NULL,
    stage character varying(20) DEFAULT 'inactive_pool'::character varying NOT NULL,
    assigned_sales_user_id uuid,
    next_follow_up_at timestamp with time zone,
    reactivated_at timestamp with time zone,
    create_date timestamp with time zone DEFAULT now() NOT NULL,
    update_date timestamp with time zone DEFAULT now() NOT NULL,
    cuisine_id uuid,
    cuisine_name character varying(100),
    activity_count integer DEFAULT 0 NOT NULL,
    visit_count integer DEFAULT 0 NOT NULL,
    last_activity_at timestamp with time zone,
    created_by_sales_user_id uuid,
    customer_type character varying(20),
    lead_source character varying(20),
    location character varying(255),
    company_registration_num character varying(50),
    id_card_number character varying(30),
    company_name character varying(255),
    restaurant_name character varying(255),
    address text,
    cuisine_parent_id uuid,
    cuisine_parent_name character varying(100),
    business_size character varying(20),
    branch_count integer,
    email character varying(255),
    line_id character varying(100),
    operation_hours character varying(255),
    reject_reason character varying(30),
    reject_note text,
    lat numeric(10,7),
    lng numeric(10,7),
    lifecycle character varying(10) DEFAULT 'tmp'::character varying NOT NULL,
    promoted_to_lead_at timestamp with time zone,
    whatsapp character varying(50),
    wongnai_url character varying(500),
    consent_at timestamp with time zone,
    restaurant_place_id uuid,
    aging_notified_at timestamp with time zone,
    assigned_at timestamp with time zone,
    median_reorder_interval_days numeric(10,2),
    delay_ratio numeric(10,4),
    order_count_365d integer DEFAULT 0 NOT NULL,
    avg_monthly_revenue numeric(14,2),
    province character varying(64)
)`);
    await queryRunner.query(`CREATE TABLE winback_activity (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    account_id uuid NOT NULL,
    sales_user_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    outcome character varying(20),
    note text,
    activity_at timestamp with time zone DEFAULT now() NOT NULL,
    next_follow_up_at timestamp with time zone,
    stage_after character varying(20),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(20) DEFAULT 'done'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    photo_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    checkin_at timestamp with time zone,
    checkout_at timestamp with time zone,
    lat numeric(10,7),
    lng numeric(10,7),
    contact_id uuid,
    reminded_at timestamp with time zone
)`);
    await queryRunner.query(`CREATE TABLE winback_contact (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    account_id uuid NOT NULL,
    team character varying(20) NOT NULL,
    name character varying(255) NOT NULL,
    role_label character varying(100),
    mobile character varying(50),
    email character varying(255),
    line_id character varying(100),
    create_date timestamp with time zone DEFAULT now() NOT NULL,
    whatsapp character varying(50)
)`);
    await queryRunner.query(`CREATE TABLE winback_meeting_ack (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    account_id uuid NOT NULL,
    signal character varying(40) NOT NULL,
    subject_id character varying(64),
    discussed_at timestamp with time zone NOT NULL,
    discussed_by uuid,
    create_date timestamp with time zone DEFAULT now() NOT NULL,
    update_date timestamp with time zone DEFAULT now() NOT NULL
)`);
    await queryRunner.query(`CREATE TABLE winback_sales_target (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    sales_user_id uuid NOT NULL,
    period_month character varying(7) NOT NULL,
    gmv_target numeric(14,2) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
    await queryRunner.query(`CREATE TABLE winback_stage_history (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    account_id uuid NOT NULL,
    from_stage character varying(20),
    to_stage character varying(20) NOT NULL,
    changed_by uuid NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    note text
)`);
    await queryRunner.query(`ALTER TABLE ONLY winback_account ADD CONSTRAINT pk_winback_account PRIMARY KEY (id)`);
    await queryRunner.query(`ALTER TABLE ONLY winback_activity ADD CONSTRAINT pk_winback_activity PRIMARY KEY (id)`);
    await queryRunner.query(`ALTER TABLE ONLY winback_contact ADD CONSTRAINT pk_winback_contact PRIMARY KEY (id)`);
    await queryRunner.query(`ALTER TABLE ONLY winback_meeting_ack ADD CONSTRAINT pk_winback_meeting_ack PRIMARY KEY (id)`);
    await queryRunner.query(`ALTER TABLE ONLY winback_sales_target ADD CONSTRAINT pk_winback_sales_target PRIMARY KEY (id)`);
    await queryRunner.query(`ALTER TABLE ONLY winback_stage_history ADD CONSTRAINT pk_winback_stage_history PRIMARY KEY (id)`);
    await queryRunner.query(`CREATE INDEX ix_winback_activity_account ON winback_activity USING btree (account_id)`);
    await queryRunner.query(`CREATE INDEX ix_winback_activity_sales ON winback_activity USING btree (sales_user_id, activity_at)`);
    await queryRunner.query(`CREATE INDEX ix_winback_assigned ON winback_account USING btree (assigned_sales_user_id)`);
    await queryRunner.query(`CREATE INDEX ix_winback_contact_account ON winback_contact USING btree (account_id)`);
    await queryRunner.query(`CREATE INDEX ix_winback_delay_ratio ON winback_account USING btree (delay_ratio) WHERE (delay_ratio IS NOT NULL)`);
    await queryRunner.query(`CREATE INDEX ix_winback_health ON winback_account USING btree (health)`);
    await queryRunner.query(`CREATE INDEX ix_winback_lifecycle ON winback_account USING btree (lifecycle)`);
    await queryRunner.query(`CREATE INDEX ix_winback_meeting_ack_account ON winback_meeting_ack USING btree (account_id)`);
    await queryRunner.query(`CREATE INDEX ix_winback_meeting_ack_discussed_at ON winback_meeting_ack USING btree (discussed_at)`);
    await queryRunner.query(`CREATE INDEX ix_winback_province ON winback_account USING btree (province) WHERE (province IS NOT NULL)`);
    await queryRunner.query(`CREATE INDEX ix_winback_stage ON winback_account USING btree (stage)`);
    await queryRunner.query(`CREATE INDEX ix_winback_stage_history_account ON winback_stage_history USING btree (account_id, changed_at)`);
    await queryRunner.query(`CREATE INDEX ix_winback_stage_history_changed_at ON winback_stage_history USING btree (changed_at)`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_winback_customer_code ON winback_account USING btree (customer_code)`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_winback_meeting_ack ON winback_meeting_ack USING btree (account_id, signal, COALESCE(subject_id, ''::character varying))`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_winback_restaurant_place_id ON winback_account USING btree (restaurant_place_id) WHERE (restaurant_place_id IS NOT NULL)`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_winback_sales_target_period ON winback_sales_target USING btree (sales_user_id, period_month)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "winback_stage_history"`);
    await queryRunner.query(`DROP TABLE "winback_sales_target"`);
    await queryRunner.query(`DROP TABLE "winback_meeting_ack"`);
    await queryRunner.query(`DROP TABLE "winback_contact"`);
    await queryRunner.query(`DROP TABLE "winback_activity"`);
    await queryRunner.query(`DROP TABLE "winback_account"`);
  }
}
