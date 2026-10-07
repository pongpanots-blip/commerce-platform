import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StaffRequest, StaffRole, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { JoshActions, UploadFile } from './josh-actions';

const M: StaffRole[] = ['marketing'];
const MER: StaffRole[] = ['marketing', 'merchandising'];
const CS: StaffRole[] = ['cs'];
const ADMIN: StaffRole[] = [];
/**
 * josh admin routes commerce-admin calls through josh's admin-call relay — same list as josh RELAY_ROUTES, plus who
 * may call here besides admin. Stage 6: MER (`merchandising`) gets the product / category / brand / supplier areas,
 * CS the order / shipment / CS-desk / credit areas; customer PII, KYC, staff access and payment testing stay admin.
 */
const AREAS: { path: RegExp; roles: StaffRole[] }[] = [
  { path: /^\/(product\/|admin\/promotion-product-sets)/, roles: MER },
  { path: /^\/promotion-pages/, roles: M },
  { path: /^\/coupon(\/|$)/, roles: M },
  { path: /^\/(campaigns|user-segments)(\/|$)/, roles: M },
  { path: /^\/(marketing-workflows|marketing-notify-templates|marketing-trigger-presets|marketing-settings)(\/|$)/, roles: M },
  { path: /^\/admin\/bot\//, roles: M },
  { path: /^\/(banner|popup-definitions)$/, roles: M },
  { path: /^\/(product-category|brands|cuisine)(\/|$)/, roles: MER },
  { path: /^\/(marketing-notify-templates|marketing-settings|smart-links|marketing-offers|marketing\/deeplink)(\/|$)/, roles: M },
  { path: /^\/upload\/image(\/|$)/, roles: MER },
  { path: /^\/(membership-tiers|users|analytics\/(funnel|users)|pii\/reveal|company\/|branch\/)/, roles: ADMIN },
  { path: /^\/(orders|shipments)(\/|$)/, roles: CS },
  { path: /^\/payment\/kbank\/testing(\/|$)/, roles: ADMIN },
  { path: /^\/(cs-admin\/|admin\/cart-move-allowed-categories$)/, roles: CS },
  { path: /^\/(credit-notes|credit-backs)(\/|$)/, roles: CS },
  { path: /^\/(supplier|promotion-mechanics)(\/|$)/, roles: MER },
  { path: /^\/product$/, roles: MER },
  { path: /^\/admin\/(push-campaigns|notifications|product-notify-funnel|audit-logs)(\/|$)/, roles: M },
  { path: /^\/(company|admin-access|admin\/kyc|erp\/testing|payment\/jagota\/testing)(\/|$)/, roles: ADMIN },
];
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
/** josh takes JSON bodies up to 5 MB; base64 adds a third — keep all files of one call under 3.5 MB. */
export const MAX_RELAY_FILES_BYTES = 3.5 * 1024 * 1024;
/** `/upload` (real multipart): same caps as josh's `/admin-call/upload`. */
export const MAX_UPLOAD_FILES = 100;
export const MAX_UPLOAD_FILE_BYTES = 60 * 1024 * 1024;
/** The part of multer's file this door reads (no @types/multer here). */
interface UploadedPart { fieldname: string; originalname: string; mimetype: string; buffer: Buffer }

export interface AdminCallBody {
  method?: string; path?: string; query?: Record<string, string | number | boolean>; body?: unknown;
  files?: { field: string; filename: string; contentType?: string; base64: string }[];
}

/**
 * One door for commerce-admin pages that drive josh admin features (coupons, product sets, promotion
 * pages, campaigns, segments, bot, workflow editor, CS orders / samples, account merge). josh checks
 * its own allowlist, runs its own route as the same staff member and answers `{ status, data }`;
 * a josh 4xx comes back as the same error here. Admin; marketing / MER / CS for their areas (AREAS).
 */
@Controller('josh/admin-call')
@StaffRoles('marketing', 'merchandising', 'cs')
export class JoshAdminCallController {
  constructor(private readonly josh: JoshActions) {}

  @Post() @HttpCode(HttpStatus.OK)
  call(@Body() b: AdminCallBody, @Req() req: StaffRequest) {
    return joshAdminCall(this.josh, { userId: req.staff.userId, email: req.staff.email, role: req.staff.role }, b, 'admin');
  }

  /** Large files (videos, bulk images): multipart with a `request` field = `{ method, path, query, body }` and the files as josh names them. */
  @Post('upload') @HttpCode(HttpStatus.OK)
  @UseInterceptors(AnyFilesInterceptor({ storage: memoryStorage(), limits: { files: MAX_UPLOAD_FILES, fileSize: MAX_UPLOAD_FILE_BYTES } }))
  upload(@Body('request') request: string | undefined, @UploadedFiles() parts: UploadedPart[] = [], @Req() req: StaffRequest) {
    let b: AdminCallBody;
    try { b = JSON.parse(request ?? ''); } catch { throw new BadRequestException('request: JSON { method, path, query, body }'); }
    if (!parts.length) throw new BadRequestException('no files — use POST /josh/admin-call');
    const files: UploadFile[] = parts.map((p) => ({ field: p.fieldname, filename: p.originalname, contentType: p.mimetype || undefined, bytes: p.buffer }));
    return joshAdminCall(this.josh, { userId: req.staff.userId, email: req.staff.email, role: req.staff.role }, { ...b, files: undefined }, 'admin', files);
  }
}

/** Shared by commerce-admin and MCP: check the path and role, call josh, unwrap josh's answer (a josh 4xx becomes the same error). */
export async function joshAdminCall(josh: JoshActions, actor: { userId: string; email: string; role: string }, b: AdminCallBody, via: string, uploads?: UploadFile[]): Promise<unknown> {
  const method = String(b?.method ?? '').toUpperCase();
  const path = String(b?.path ?? '');
  if (!METHODS.includes(method) || !path.startsWith('/') || path.includes('..') || path.length > 300) throw new BadRequestException('method and a josh path (/coupon, …) required');
  const area = AREAS.find((a) => a.path.test(path));
  if (!area) throw new ForbiddenException(`${path} is not a josh admin route commerce drives`);
  if (actor.role !== 'admin' && !area.roles.includes(actor.role as StaffRole)) throw new ForbiddenException('admin only');
  const files = (b.files ?? []).slice(0, 10);
  for (const f of files) if (!f?.field || !f.filename || typeof f.base64 !== 'string') throw new BadRequestException('files: { field, filename, base64 }');
  if (files.reduce((n, f) => n + f.base64.length * 0.75, 0) > MAX_RELAY_FILES_BYTES) throw new BadRequestException('files: 3.5 MB per save at most');
  const who = { userId: actor.userId, email: actor.email };
  const r = uploads?.length
    ? await josh.upload<{ status: number; data?: unknown; file?: unknown }>({ method, path, query: b.query, body: b.body }, uploads, who, via)
    : await josh.run<{ status: number; data?: unknown; file?: unknown }>('admin-call', 'call', { method, path, query: b.query, body: b.body, files: files.length ? files : undefined }, who, via);
  if (r.status >= 400) {
    const d = r.data as { message?: unknown; error?: { message?: unknown } } | string | null;
    const m = typeof d === 'string' ? d : d?.message ?? d?.error?.message ?? r.status;
    const message = `josh: ${Array.isArray(m) ? m.join(', ') : String(m)}`;
    throw r.status === 403 ? new ForbiddenException(message) : new BadRequestException(message);
  }
  // A binary answer (CSV / PDF export) comes back as { file: { contentType, filename, base64 } }.
  return r.file ? { file: r.file } : r.data;
}
