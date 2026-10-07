import { DomainEvent } from '../../../shared-kernel/domain/domain-event';

/** One aggregate for the whole tree: every category write sends all rows, latest wins. */
export const CATEGORY_TREE_AGGREGATE_ID = '4c000000-0000-4000-8000-00000000c47e';

/** `category.tree.snapshot` (stage 4c): every category row with josh's column names. */
export class CategoryTreeSnapshot extends DomainEvent<{ rows: Array<Record<string, unknown>>; version: string }> {
  readonly type = 'category.tree.snapshot';
  constructor(payload: { rows: Array<Record<string, unknown>>; version: string }) {
    super(CATEGORY_TREE_AGGREGATE_ID, payload, { snapshot: true });
  }
}

export interface BrandSnapshotPayload { id: string; brand_code: string; brand_name_th: string | null; brand_name_en: string | null; version: string }

/** `brand.snapshot` (stage 4c): one brand's names. */
export class BrandSnapshot extends DomainEvent<BrandSnapshotPayload> {
  readonly type = 'brand.snapshot';
  constructor(payload: BrandSnapshotPayload) {
    super(payload.id, payload, { snapshot: true });
  }
}
