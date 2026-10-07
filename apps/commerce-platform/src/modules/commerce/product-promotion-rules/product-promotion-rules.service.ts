import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';
import { PromotionRule, validatePromotionRules } from './promotion-rules';
import { ProductPromotionRulesSnapshot } from './product-promotion-rules.event';
export const ownsPromotions = () => process.env.COMMERCE_OWNS_PROMOTIONS === 'true';
@Injectable()
export class ProductPromotionRulesService {
  constructor(@InjectDataSource() private readonly db: DataSource, @Inject(EVENT_BUS) private readonly events: IEventBus) {}
  async get(sku: string) {
    const [row] = await this.db.query(`SELECT sku, rules AS promotion_rules, lock AS promotion_rules_locked_by, version FROM product_promotion_rules WHERE sku = $1`, [sku]);
    if (!row) throw new NotFoundException('promotion rules not backfilled for this SKU');
    return row;
  }
  private async lock(m: EntityManager, sku: string) { await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`promotion-rules:${sku}`]); }
  async edit(sku: string, raw: unknown, staffId: string, source: 'staff' | 'create' = 'staff') {
    if (!ownsPromotions()) throw new ConflictException('COMMERCE_OWNS_PROMOTIONS is not true');
    if (typeof sku !== 'string' || !sku.trim() || sku.length > 64) throw new BadRequestException('invalid SKU');
    const rules = validatePromotionRules(raw);
    return this.db.transaction(async m => {
      await this.lock(m, sku);
      const [row] = await m.query('SELECT lock, lock_version, rules_reset_version FROM product_promotion_rules WHERE sku = $1', [sku]);
      // Fail closed until the mechanic ownership snapshot is known. New products have no assignment yet.
      if (source !== 'create' && !row?.lock_version) throw new ConflictException('promotion lock not backfilled');
      if (row?.lock) throw new ConflictException({ error_code: 'promotion_rules_locked_by_mechanic', message: `Promotion rules owned by ${row.lock.mechanic_name}`, ...row.lock });
      const [known] = source === 'create' ? [true] : await m.query('SELECT 1 FROM josh_catalog_products WHERE sku = $1 AND removed_at IS NULL', [sku]);
      if (!known) throw new NotFoundException('unknown SKU');
      const [{ version }] = await m.query(`SELECT nextval('product_promotion_rules_seq')::text AS version`);
      await m.query(`INSERT INTO product_promotion_rules (sku, rules, version, source, updated_by) VALUES ($1,$2,$3,'commerce',$4)
        ON CONFLICT (sku) DO UPDATE SET rules=EXCLUDED.rules, version=EXCLUDED.version, source='commerce', updated_by=EXCLUDED.updated_by`, [sku, JSON.stringify(rules), version, staffId]);
      const snapshot = { sku, rules, version, rules_reset_version: row?.rules_reset_version ?? '0' };
      await this.events.publish(new ProductPromotionRulesSnapshot(snapshot), m);
      return snapshot;
    });
  }
  /** Signed Josh events are both the shadow/parity copy and the bootstrap while Josh owns rules. */
  async inbound(e: { type: string; aggregateId: string; version: string; data: { sku?: string; rules?: PromotionRule[]; lock?: unknown; rules_reset_version?: string } }): Promise<'applied' | 'stale'> {
    const { sku } = e.data ?? {};
    if (typeof sku !== 'string' || !sku.trim() || sku.length > 64 ||
        typeof e.version !== 'string' || !/^[0-9]{1,19}$/.test(e.version) || BigInt(e.version) > BigInt('9223372036854775807')) {
      throw new BadRequestException('sku and decimal bigint version required');
    }
    const isLock = e.type === 'promotion-lock.snapshot';
    const resetVersion = e.data.rules_reset_version === undefined ? '0' : e.data.rules_reset_version;
    if (isLock && (typeof resetVersion !== 'string' || !/^[0-9]{1,19}$/.test(resetVersion) || BigInt(resetVersion) > BigInt(e.version))) {
      throw new BadRequestException('rules_reset_version must be a decimal bigint no newer than the lock snapshot');
    }
    const rules = isLock ? undefined : validatePromotionRules(e.data.rules);
    const lock = e.data.lock;
    if (isLock && lock !== null && (!lock || typeof lock !== 'object' || typeof (lock as any).mechanic_id !== 'string' || typeof (lock as any).mechanic_name !== 'string')) throw new BadRequestException('lock must be null or mechanic identity');
    return this.db.transaction(async m => {
      await this.lock(m, sku);
      await m.query('INSERT INTO product_promotion_rules (sku) VALUES ($1) ON CONFLICT DO NOTHING', [sku]);
      const [row] = await m.query('SELECT shadow_version, lock_version, rules_reset_version FROM product_promotion_rules WHERE sku=$1', [sku]);
      const previous = isLock ? row.lock_version : row.shadow_version;
      if (previous != null && BigInt(previous) >= BigInt(e.version)) return 'stale';
      if (isLock) {
        // Assignment discards undated tiers; removing the assignment cannot resurrect them.
        const discard = lock !== null || BigInt(resetVersion) > BigInt(row.rules_reset_version);
        const observedReset = BigInt(resetVersion) > BigInt(row.rules_reset_version) ? resetVersion : row.rules_reset_version;
        await m.query(`UPDATE product_promotion_rules SET lock=$2, lock_version=$3,
          rules=CASE WHEN $4 THEN '[]'::jsonb ELSE rules END,
          rules_reset_version=GREATEST(rules_reset_version,$5::bigint) WHERE sku=$1`, [sku, lock === null ? null : JSON.stringify(lock), e.version, discard, resetVersion]);
        if (discard && ownsPromotions()) {
          const [{ version }] = await m.query(`SELECT nextval('product_promotion_rules_seq')::text AS version`);
          await m.query(`UPDATE product_promotion_rules SET version=$2, source='commerce' WHERE sku=$1`, [sku, version]);
          await this.events.publish(new ProductPromotionRulesSnapshot({ sku, rules: [], version, rules_reset_version: observedReset }), m);
        }
      } else {
        await m.query(`UPDATE product_promotion_rules SET shadow_rules=$2, shadow_version=$3,
          rules=CASE WHEN $4 AND lock IS NULL THEN $2::jsonb ELSE rules END WHERE sku=$1`, [sku, JSON.stringify(rules), e.version, !ownsPromotions() && BigInt(e.version) >= BigInt(row.rules_reset_version)]);
      }
      return 'applied';
    });
  }
  async parity() {
    return this.db.query(`SELECT sku, rules, shadow_rules, version, shadow_version, lock_version FROM product_promotion_rules
      WHERE shadow_version IS NULL OR lock_version IS NULL OR (lock IS NULL AND rules IS DISTINCT FROM shadow_rules)
      UNION ALL SELECT c.sku, NULL, NULL, NULL, NULL, NULL FROM josh_catalog_products c WHERE c.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM product_promotion_rules p WHERE p.sku=c.sku) ORDER BY sku`);
  }
}
