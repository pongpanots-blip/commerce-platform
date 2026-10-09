import { z } from 'zod';

/**
 * What MCP may create / edit on josh through the admin-call relay, with the fields josh's DTOs take
 * (josh origin/main 89ab0ef: coupon.dto, campaign.dto, user-segment.dto, promotion-product-set-input.dto,
 * promotion-page.dto, update-banner.dto + banner.service create, marketing-workflow.dto, create-smart-link.dto).
 * josh still validates; these schemas give the AI the shape up front and a field-level error before a preview.
 */
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'ISO date, e.g. 2026-11-01T00:00:00+07:00');
const url = z.url();
const optText = (max: number) => z.string().max(max).nullable().optional();

const coupon = z.object({
  coupon_code: z.string().trim().min(1).max(8),
  title: z.string().min(1),
  title_th: z.string().optional(), title_en: z.string().nullable().optional(),
  description: z.string().optional(), description_th: z.string().optional(), description_en: z.string().nullable().optional(),
  applicable_products_th: z.string().min(1).describe('which products the coupon covers, as shown to customers (Thai)'),
  applicable_products_en: z.string().min(1),
  image_url: z.string().nullable().optional(),
  coupon_type: z.enum(['discount', 'cashback']).optional(),
  distribution_type: z.enum(['public', 'assigned', 'unique_per_user']).optional(),
  code_generation: z.enum(['shared', 'unique_suffix']).optional(),
  discount_type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
  discount_scope: z.enum(['all', 'product', 'brand', 'category']).optional(),
  discount_value: z.number().min(0),
  minimum_order_amount: z.number().min(0).optional(),
  maximum_discount_amount: z.number().min(0).nullable().optional(),
  usage_type: z.enum(['SINGLE_USE', 'PER_USER_LIMIT', 'GLOBAL_LIMIT']).optional(),
  user_limit: z.number().int().min(1).nullable().optional(),
  global_limit: z.number().int().min(1),
  start_date: isoDate, end_date: isoDate,
  is_active: z.boolean().optional(),
  audience_segment_id: z.uuid().nullable().optional(),
  enforce_audience_at_redemption: z.boolean().optional(),
  auto_grant_on_signup: z.boolean().optional(),
  auto_apply: z.boolean().optional().describe('public distribution only'),
});

const campaign = z.object({
  name: z.string().min(1).max(200), start_at: isoDate, end_at: isoDate,
  is_active: z.boolean().optional(),
});

const segment = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80),
  name: z.string().min(1).max(155),
  description: z.string().optional(),
  rule_type: z.enum(['guest', 'member', 'staff', 'role', 'custype', 'has_company', 'min_order_count', 'no_order_days', 'min_order_value',
    'max_order_value', 'cuisine', 'cuisine_parent', 'registered_between', 'manual_user_list', 'first_visit']),
  rule_config: z.record(z.string(), z.unknown()).optional(),
  definition: z.record(z.string(), z.unknown()).optional().describe('{ field, operator, value } or { op: "AND" | "OR", children: [...] } — check with segment_preview first'),
  priority: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

const productSet = z.object({
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  skus: z.array(z.string().min(1)).max(5000).describe('SKUs from catalog_products'),
  categoryIds: z.array(z.uuid()),
  brandIds: z.array(z.uuid()).max(5000),
});

const promotionPage = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,80}$/).describe('cannot be changed after creation'),
  name: z.string().min(1).max(200),
  campaign_id: z.uuid().describe('the campaign whose promotions this page shows (one page per campaign)'),
  image_url_desktop: z.string().min(1).max(2048), image_url_mobile: z.string().min(1).max(2048),
  image_url_desktop_en: optText(2048), image_url_mobile_en: optText(2048),
  mobile_deeplink: z.string().max(500).optional(),
  show_on_home: z.boolean().optional(),
  home_banner_sort_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

const banner = z.object({
  title: z.string().min(1).max(200),
  title_th: z.string().optional(), title_en: z.string().optional(),
  link_url: z.string().optional().describe('where a tap goes, e.g. the promotion page link'),
  placement: z.enum(['HERO', 'POPUP_GUEST', 'POPUP_MEMBER']).describe('HERO = home carousel'),
  target_id: z.uuid().optional(),
  image_url_desktop: z.string().min(1).describe('an image already uploaded to josh, e.g. the promotion page image — MCP cannot upload files'),
  image_url_mobile: z.string().optional(),
  sort_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
  start_date: isoDate.optional(), end_date: isoDate.optional(),
});

const notifyTemplate = z.object({
  name: z.string().min(1).max(200),
  template_type: z.enum(['notify', 'popup']).optional().describe('create only; default notify'),
  title: z.string().max(300).optional().describe('required unless popup'),
  body: z.string().optional().describe('required unless popup'),
  title_en: z.string().max(300).optional(), body_en: z.string().optional(),
  image_url: z.string().max(1000).optional(),
  blocks: z.array(z.unknown()).optional(), variants: z.array(z.unknown()).optional(),
  channels: z.record(z.string(), z.unknown()).optional(),
});

const smartLink = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).max(120),
  title: z.string().max(200).optional(), description: z.string().max(2000).optional(),
  image_url: url.optional(),
  destination_web: url, destination_ios: url.optional(), destination_android: url.optional(), fallback_url: url.optional(),
  show_landing: z.boolean().optional(),
  active: z.boolean().optional(),
  expires_at: isoDate.optional(),
});

const welcomeCopy = z.object({
  taglineTop: z.string().max(2000), taglineBottom: z.string().max(2000), headlineTop: z.string().max(2000), headlineBottom: z.string().max(2000),
  body: z.string().max(20000), cta: z.string().max(2000), footerLegal: z.string().max(2000),
  terms: z.string().max(2000), termsUrl: z.string().max(2048), privacy: z.string().max(2000), privacyUrl: z.string().max(2048),
}).partial();
const welcomeEmail = z.object({
  ctaUrl: optText(2048), socialInstagramUrl: optText(2048), socialTiktokUrl: optText(2048), socialFacebookUrl: optText(2048), socialLinkedinUrl: optText(2048),
  copy: z.object({ th: welcomeCopy, en: welcomeCopy }).partial(),
  style: z.object({ th: z.record(z.string(), z.number().min(8).max(64)), en: z.record(z.string(), z.number().min(8).max(64)) }).partial()
    .describe('{ th?: { <name>Size: 8–64 }, en?: … }'),
  bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  bgGradientStop: z.number().int().min(0).max(100),
}).partial();

export type MarketingKindName = 'workflow' | 'coupon' | 'segment' | 'campaign' | 'product_set' | 'promotion_page' | 'banner' | 'notify_template' | 'smart_link' | 'welcome_email';

export interface MarketingKind {
  /** Thai name, for the change log in commerce-admin. */
  label: string;
  /** josh admin route (no /api). */
  path: string;
  update: 'PATCH' | 'PUT';
  /** What a new one is created with so that it is not live. */
  off?: Record<string, unknown>;
  /** josh drops `off` on create (whitelisted DTO without the flag): switch it off with an edit right after. */
  offAfterCreate?: boolean;
  /** josh has GET path/:id; otherwise the record is found in the list. */
  one?: boolean;
  /** One record, edited at `path` (no id, no create). */
  singleton?: boolean;
  /** An edit replaces the whole record: send every field. */
  replace?: boolean;
  /** commerce-admin page (under /j). */
  admin: (id?: string) => string;
  /** Fields for create; an edit takes any subset unless `replace`. Undefined = free-form (copy an existing one). */
  fields?: z.ZodObject;
  /** Field names josh's route expects, when they differ from `fields`. */
  toJosh?: (data: Record<string, unknown>, create: boolean) => Record<string, unknown>;
  /** Shown in every preview. */
  note?: string;
}

const bannerToJosh = (d: Record<string, unknown>, create: boolean) => {
  // josh's banner routes are multipart forms: flags and numbers arrive as strings; create names title / link differently.
  const out: Record<string, unknown> = { ...d };
  if (d.is_active !== undefined) out.is_active = String(d.is_active);
  if (d.sort_order !== undefined) out.sort_order = String(d.sort_order);
  if (create) {
    if ('title' in out) { out.nameBanner = out.title; delete out.title; }
    if ('link_url' in out) { out.linkWeb = out.link_url; delete out.link_url; }
  }
  return out;
};

export const MARKETING_KINDS: Record<MarketingKindName, MarketingKind> = {
  workflow: { label: 'Marketing workflow', path: '/marketing-workflows', update: 'PATCH', one: true,
    admin: (id) => id ? `/j/marketing/workflows/${id}` : '/j/marketing/workflows' },
  coupon: { label: 'คูปอง', path: '/coupon', update: 'PATCH', off: { is_active: false }, one: true, fields: coupon,
    admin: (id) => id ? `/j/coupon/${id}` : '/j/coupons' },
  segment: { label: 'Segment ลูกค้า', path: '/user-segments', update: 'PATCH', off: { is_active: false }, one: true, fields: segment,
    admin: (id) => id ? `/j/segments/edit/${id}` : '/j/segments' },
  campaign: { label: 'Campaign', path: '/campaigns', update: 'PATCH', off: { is_active: false }, offAfterCreate: true, one: true, fields: campaign,
    admin: (id) => id ? `/j/promotions/campaigns/${id}` : '/j/promotions/campaigns' },
  product_set: { label: 'Product set', path: '/admin/promotion-product-sets', update: 'PATCH', one: true, replace: true, fields: productSet,
    admin: (id) => id ? `/j/promotion-product-sets/${id}/edit` : '/j/promotion-product-sets',
    note: 'an edit replaces the whole set (name, skus, categoryIds, brandIds) — send the full list' },
  promotion_page: { label: 'หน้าโปรโมชัน', path: '/promotion-pages', update: 'PUT', off: { is_active: false }, one: true, fields: promotionPage,
    admin: (id) => id ? `/j/promotion-pages/${id}/edit` : '/j/promotion-pages' },
  banner: { label: 'Banner / carousel', path: '/banner', update: 'PATCH', off: { is_active: false }, fields: banner, toJosh: bannerToJosh,
    admin: (id) => id ? `/j/banner/edit/${id}` : '/j/banner' },
  notify_template: { label: 'Notify template', path: '/marketing-notify-templates', update: 'PATCH', fields: notifyTemplate,
    admin: () => '/j/marketing/notify-templates',
    note: 'editing a template changes the messages of every workflow that uses it right away; josh keeps its revisions (restore in commerce-admin)' },
  smart_link: { label: 'Smart link', path: '/smart-links', update: 'PATCH', off: { active: false }, one: true, fields: smartLink,
    admin: (id) => id ? `/j/smart-links/edit/${id}` : '/j/smart-links' },
  welcome_email: { label: 'อีเมลต้อนรับ lead', path: '/marketing-settings/welcome-lead-email', update: 'PATCH', singleton: true, fields: welcomeEmail,
    admin: () => '/j/marketing/welcome-lead-email',
    note: 'there is one welcome email and it is live: new leads get the changed email as soon as this is saved; images are changed in commerce-admin' },
};

/** Absolute commerce-admin link (admin is served on the same host as MCP), or the path when MCP_PUBLIC_URL is unset. */
export const adminUrl = (path: string) => `${process.env.MCP_PUBLIC_URL?.trim().replace(/\/$/, '') ?? ''}${path}`;

/** josh answers `{ id }`, `{ data: { id } }` or `{ status, data: { … }, message }`. */
export function unwrapJosh(answer: unknown): Record<string, unknown> | null {
  const a = answer as { data?: unknown } | null;
  if (!a || typeof a !== 'object') return null;
  const d = a.data as { data?: unknown } | undefined;
  if (d && typeof d === 'object' && !Array.isArray(d)) return (d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? d.data : d) as Record<string, unknown>;
  return a as Record<string, unknown>;
}

/** josh's banner routes answer 200 `{ data: [], message }` when they fail. */
export function quietJoshError(answer: unknown): string | null {
  const a = answer as { data?: unknown; message?: unknown } | null;
  return a && Array.isArray(a.data) && !a.data.length && typeof a.message === 'string' && a.message ? a.message : null;
}

/** Top-level fields of `after` whose value differs from `before`. */
export function changesOf(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  return Object.entries(after)
    .filter(([field, value]) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(value ?? null))
    .map(([field, value]) => ({ field, before: before?.[field] ?? null, after: value }));
}
