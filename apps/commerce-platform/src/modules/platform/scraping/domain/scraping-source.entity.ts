import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

export type ScrapingField = { key: string; label: string; selector: string; attribute?: string };
export type ScrapingConfig = {
  startUrls: string[]; pathPrefixes: string[]; mode: 'html' | 'browser'; itemSelector: string;
  fields: ScrapingField[]; currency: string; vatIncluded: boolean; priceContext: string;
  selectedFields?: string[];
  /** Detect repeated product cards from links instead of CSS field selectors. */
  autoCards?: boolean;
  /** 'browser' = keep one browser session and follow next link / next button / load more / scroll. */
  pagination?: 'none' | 'browser';
  /** Run only inside the night window (SCRAPING_NIGHT_*); long runs pause at its end and resume next night. */
  nightOnly?: boolean;
  /** Pages the site itself reported at discovery (e.g. Makro 3,978) — shown as progress 'X of ~Y'. */
  expectedPages?: number;
  collectionAllowed: boolean; intervalHours: number; maxPages: number; delayMs: number;
};
export type ScrapingProgress = {
  pending: string[]; visited: string[]; successful: number; failed: number; items: number;
  /** Drops in a row on the current listing; reset by any page read. */
  retries?: number;
  /** A person asked to collect now (first look / "เก็บต่อเลยตอนนี้"): keeps going outside the night window, even after a restart. */
  now?: 'first_look' | 'all';
  /** Resuming re-clicks "next" from page 1: the page it has reached so far, until it is back where it stopped. */
  catchUp?: number;
};

@Entity('scraping_sources')
@Unique('uq_scraping_source_origin', ['origin'])
export class ScrapingSource {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 100 }) name: string;
  @Column({ length: 500 }) origin: string;
  @Column({ type: 'jsonb' }) config: ScrapingConfig;
  @Column({ default: 1 }) revision: number;
  @Column({ default: false }) enabled: boolean;
  @Column({ length: 20, default: 'idle' }) status: 'idle' | 'running' | 'paused' | 'completed' | 'limited';
  @Column({ type: 'jsonb', default: () => "'{\"pending\":[],\"visited\":[],\"successful\":0,\"failed\":0,\"items\":0}'::jsonb" }) progress: ScrapingProgress;
  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true }) leaseUntil: Date | null;
  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true }) lastError: string | null;
  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true }) lastRunAt: Date | null;
  /** Our own member account on this site. Prices read while logged in are member prices, kept apart from public ones. */
  @Column({ name: 'login_url', type: 'varchar', length: 2000, nullable: true }) loginUrl: string | null;
  @Column({ name: 'login_username', type: 'varchar', length: 200, nullable: true }) loginUsername: string | null;
  /** AES-256-GCM with SCRAPING_CREDENTIALS_KEY (see credential-cipher.ts). Never returned by the API. */
  @Column({ name: 'login_password_enc', type: 'text', nullable: true }) loginPasswordEnc: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('scraped_items')
@Unique('uq_scraped_item_source_url', ['sourceId', 'url'])
@Index('ix_scraped_item_source_observed', ['sourceId', 'observedAt'])
export class ScrapedItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'source_id', type: 'uuid' }) sourceId: string;
  @ManyToOne(() => ScrapingSource, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'source_id' }) source: ScrapingSource;
  @Column({ length: 2000 }) url: string;
  @Column({ name: 'page_url', length: 2000 }) pageUrl: string;
  @Column({ type: 'varchar', length: 500 }) name: string;
  @Column({ length: 100, default: '' }) sku: string;
  @Column({ type: 'jsonb' }) fields: Record<string, string>;
  @Column({ name: 'price_inc_vat', type: 'numeric', precision: 12, scale: 2, nullable: true }) priceIncVat: number | null;
  @Column({ name: 'weight_kg', type: 'numeric', precision: 12, scale: 4, nullable: true }) weightKg: number | null;
  @Column({ length: 3 }) currency: string;
  @Column({ name: 'config_version', length: 64 }) configVersion: string;
  @Column({ name: 'observed_at', type: 'timestamptz' }) observedAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
