import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { JoshActions } from './josh-actions';

/** josh admin routes commerce-admin calls through josh's admin-call relay — same list as josh RELAY_ROUTES, plus who may call here. */
const AREAS: { path: RegExp; marketing: boolean }[] = [
  { path: /^\/(product\/|admin\/promotion-product-sets)/, marketing: true },
  { path: /^\/promotion-pages/, marketing: true },
  { path: /^\/coupon(\/|$)/, marketing: true },
  { path: /^\/(campaigns|user-segments)(\/|$)/, marketing: true },
  { path: /^\/(marketing-workflows|marketing-notify-templates|marketing-trigger-presets|marketing-settings)(\/|$)/, marketing: true },
  { path: /^\/admin\/bot\//, marketing: true },
  { path: /^\/cs-admin\//, marketing: false },
];
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
/** josh takes JSON bodies up to 5 MB; base64 adds a third — keep all files of one call under 3.5 MB. */
export const MAX_RELAY_FILES_BYTES = 3.5 * 1024 * 1024;

export interface AdminCallBody {
  method?: string; path?: string; query?: Record<string, string | number | boolean>; body?: unknown;
  files?: { field: string; filename: string; contentType?: string; base64: string }[];
}

/**
 * One door for commerce-admin pages that drive josh admin features (coupons, product sets, promotion
 * pages, campaigns, segments, bot, workflow editor, CS orders / samples, account merge). josh checks
 * its own allowlist, runs its own route as the same staff member and answers `{ status, data }`;
 * a josh 4xx comes back as the same error here. Admin; marketing for the marketing areas.
 */
@Controller('josh/admin-call')
@StaffRoles('marketing')
export class JoshAdminCallController {
  constructor(private readonly josh: JoshActions) {}

  @Post() @HttpCode(HttpStatus.OK)
  call(@Body() b: AdminCallBody, @Req() req: StaffRequest) {
    return joshAdminCall(this.josh, { userId: req.staff.userId, email: req.staff.email, role: req.staff.role }, b, 'admin');
  }
}

/** Shared by commerce-admin and MCP: check the path and role, call josh, unwrap josh's answer (a josh 4xx becomes the same error). */
export async function joshAdminCall(josh: JoshActions, actor: { userId: string; email: string; role: string }, b: AdminCallBody, via: string): Promise<unknown> {
  const method = String(b?.method ?? '').toUpperCase();
  const path = String(b?.path ?? '');
  if (!METHODS.includes(method) || !path.startsWith('/') || path.includes('..') || path.length > 300) throw new BadRequestException('method and a josh path (/coupon, …) required');
  const area = AREAS.find((a) => a.path.test(path));
  if (!area) throw new ForbiddenException(`${path} is not a josh admin route commerce drives`);
  if (!area.marketing && actor.role !== 'admin') throw new ForbiddenException('admin only');
  const files = (b.files ?? []).slice(0, 10);
  for (const f of files) if (!f?.field || !f.filename || typeof f.base64 !== 'string') throw new BadRequestException('files: { field, filename, base64 }');
  if (files.reduce((n, f) => n + f.base64.length * 0.75, 0) > MAX_RELAY_FILES_BYTES) throw new BadRequestException('files: 3.5 MB per save at most');
  const r = await josh.run<{ status: number; data: unknown }>('admin-call', 'call', { method, path, query: b.query, body: b.body, files: files.length ? files : undefined },
    { userId: actor.userId, email: actor.email }, via);
  if (r.status >= 400) {
    const d = r.data as { message?: unknown; error?: { message?: unknown } } | string | null;
    const m = typeof d === 'string' ? d : d?.message ?? d?.error?.message ?? r.status;
    const message = `josh: ${Array.isArray(m) ? m.join(', ') : String(m)}`;
    throw r.status === 403 ? new ForbiddenException(message) : new BadRequestException(message);
  }
  return r.data;
}
