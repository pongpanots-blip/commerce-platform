/**
 * Stage 2a check: would commerce freeze the same members josh would, right now?
 *
 *   npm run segment-parity
 *
 * For every active segment that is frozen (not live), commerce counts its members over its own copies and asks josh
 * (signed POST /api/internal/commerce/segments/counts) for josh's count over josh's data. Live segments (guest,
 * member, staff, role, custype, has_company) are matched by josh per request and include staff, which commerce's
 * customer copy does not have — they are listed, not compared. Exit code 1 when any frozen segment differs.
 * Env: COMMERCE_DB_* / COMMERCE_DATABASE_URL, JOSH_API_URL, JOSH_EVENTS_SECRET.
 */
import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { postToJosh } from '../modules/integration/connector/josh/josh-api';
import { isLiveSegment } from '../modules/integration/segments/segment-base';
import { SegmentDefinitionCompiler } from '../modules/integration/segments/segment-definition.compiler';
import { Segment } from '../modules/integration/segments/segment.entity';
import { SegmentsService } from '../modules/integration/segments/segments.service';

async function main() {
  const db = await AppDataSource.initialize();
  try {
    const segments = await db.getRepository(Segment).find({ where: { is_active: true }, order: { slug: 'ASC' } });
    const frozen = segments.filter((s) => !isLiveSegment(s));
    const svc = new SegmentsService(db, { publish: async () => undefined }, new SegmentDefinitionCompiler());
    const { counts } = frozen.length
      ? await postToJosh<{ counts: Record<string, number> }>('/internal/commerce/segments/counts', { ids: frozen.map((s) => s.id) })
      : { counts: {} as Record<string, number> };
    const different: { id: string; slug: string; josh: number; commerce: number }[] = [];
    for (const s of frozen) {
      const commerce = await svc.countNow(s.id);
      if (counts[s.id] !== commerce) different.push({ id: s.id, slug: s.slug, josh: counts[s.id], commerce });
    }
    console.log(JSON.stringify({
      segments: segments.length, compared: frozen.length, same: frozen.length - different.length, different,
      liveInJosh: segments.filter((s) => isLiveSegment(s)).map((s) => s.slug),
    }, null, 2));
    if (different.length) process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
