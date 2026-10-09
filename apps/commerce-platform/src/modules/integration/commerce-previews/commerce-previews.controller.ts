import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CommercePreviewsService } from './commerce-previews.service';

const milliseconds = (max: number) => z.preprocess(v => typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v,
  z.number().int().min(0).max(max));
const policy = z.object({
  consistencyGraceMs: milliseconds(86_400_000).default(30_000),
  maxEvidenceAgeMs: milliseconds(86_400_000).default(300_000),
  maxCaptureSkewMs: milliseconds(86_400_000).default(30_000),
  pendingSyncAfterMs: milliseconds(31_536_000_000).optional(),
}).strict();

/** Existing StaffAuthGuard's admin-only default. No new MER/BA/Sales grant and no activation/repair endpoint. */
@Controller('reports/commerce-previews')
export class CommercePreviewsController {
  constructor(private readonly previews: CommercePreviewsService) {}

  @Post('promotions/rehearsal')
  @HttpCode(200)
  promotion(@Body() body: unknown) {
    try { return this.previews.promotion(body); }
    catch (e) { if (e instanceof z.ZodError) throw new BadRequestException({ code: 'INVALID_REHEARSAL', issues: e.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }); throw e; }
  }

  @Get('orders/:id/review')
  order(@Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    const parsed = policy.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid review policy');
    return this.previews.order(id, { ...parsed.data, pendingSyncAfterMs: parsed.data.pendingSyncAfterMs ?? null });
  }
}
