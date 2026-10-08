// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MARKETING_TEMPLATE_VARIABLES,
  createMarketingNotifyTemplate,
  deleteMarketingNotifyTemplate,
  ensureTemplateChannels,
  getCoupons,
  getMarketingNotifyTemplateRevisions,
  getMarketingNotifyTemplates,
  getUserSegments,
  migrateBlocksToChannelDesign,
  projectChannelDesignToBlocks,
  resolvePushForLocale,
  restoreMarketingNotifyTemplateRevision,
  updateMarketingNotifyTemplate,
  type ChannelDesign,
  type MarketingCreativeChannels,
  type MarketingNotifyTemplate,
  type MarketingNotifyTemplateRevision,
  type MarketingTemplateBlock,
  type MarketingTemplateVariant,
  type UserSegmentListItem,
} from '@josh/shared-api';
import { Select } from '@josh/shared-ui-web';
import { MdOutlineClose } from 'react-icons/md';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { forceAdminLogout } from '../../lib/admin-auth';
import { useBannerLibrary } from '../../components/marketing/banner-library';
import { PopupCreativeEditor } from './creative-editor/PopupCreativeEditor';
import { EmailCreativeEditor } from './creative-editor/EmailCreativeEditor';
import { ImageSourceField } from './creative-editor/ImageSourceField';
import {
  cloneChannelDesign,
  DEFAULT_EMAIL_CHROME,
  newEmailDesign,
} from './creative-editor/element-factory';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type CouponOption = { id: string; coupon_code: string; title: string };

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none';
const FIELD_LABEL = 'mb-1 block text-xs font-medium text-gray-500';

type Draft = {
  name: string;
  title: string;
  /**
   * Dispatch content for `en` recipients on system/transactional templates
   * (order_paid, ...) rendered via `renderDispatchTemplate` — separate from
   * the push channel's `channels.push.i18n.en` overlay above, which only
   * feeds marketing-workflow overrides. Optional: blank falls back to the
   * code-defined registry.
   */
  title_en: string;
  body_en: string;
  template_type: 'notify' | 'popup';
  blocks: MarketingTemplateBlock[];
  variants: MarketingTemplateVariant[];
  /** schemaVersion 1 channels — popup editor writes to `channels.popup`; notify flat form syncs into blocks on edit. */
  channels: MarketingCreativeChannels;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  title: '',
  title_en: '',
  body_en: '',
  template_type: 'notify',
  blocks: [],
  variants: [],
  channels: { schemaVersion: 1 },
};

function newBlock(type: MarketingTemplateBlock['type']): MarketingTemplateBlock {
  if (type === 'text') return { id: crypto.randomUUID(), type: 'text', text: '' };
  if (type === 'image') return { id: crypto.randomUUID(), type: 'image', url: '' };
  if (type === 'coupon') return { id: crypto.randomUUID(), type: 'coupon', code: '' };
  return {
    id: crypto.randomUUID(),
    type: 'button',
    label: 'ไปใช้ที่ตะกร้า',
    action: 'go_url',
    url: '/cart/placement',
  };
}

/** Deep-copy blocks with fresh ids — variants start from the default layout. */
function cloneBlocks(blocks: MarketingTemplateBlock[]): MarketingTemplateBlock[] {
  return blocks.map((block) => ({ ...block, id: crypto.randomUUID() }));
}

function ensureVariantPopupChannel(variant: MarketingTemplateVariant): MarketingTemplateVariant {
  const popup = variant.channels?.popup as ChannelDesign | undefined;
  if (popup) {
    return variant.channels?.schemaVersion === 1
      ? variant
      : { ...variant, channels: { ...variant.channels, schemaVersion: 1, popup } };
  }
  return {
    ...variant,
    channels: {
      ...(variant.channels ?? {}),
      schemaVersion: 1,
      popup: migrateBlocksToChannelDesign(variant.blocks),
    },
  };
}

/** Eagerly materialize `channels.popup` for popup templates (default + variants). */
function ensurePopupDraftChannels(
  draft: Pick<Draft, 'blocks' | 'channels' | 'variants' | 'template_type'>,
): Pick<Draft, 'channels' | 'variants'> {
  if (draft.template_type !== 'popup') {
    return { channels: draft.channels, variants: draft.variants };
  }
  const popup = draft.channels.popup ?? migrateBlocksToChannelDesign(draft.blocks);
  return {
    channels: { ...draft.channels, schemaVersion: 1, popup },
    variants: draft.variants.map(ensureVariantPopupChannel),
  };
}

/**
 * Compile blocks into the flat `body`/`image_url` the notification pipeline
 * dispatches — the runner never parses blocks.
 */
function compileBlocks(blocks: MarketingTemplateBlock[]): {
  body: string;
  image_url: string | null;
} {
  const lines: string[] = [];
  let imageUrl: string | null = null;
  for (const block of blocks) {
    if (block.type === 'text' && block.text.trim()) lines.push(block.text.trim());
    if (block.type === 'coupon' && block.code.trim()) {
      lines.push(`ใช้โค้ด ${block.code.trim()} ได้เลย`);
    }
    if (block.type === 'image' && block.url.trim() && !imageUrl) {
      imageUrl = block.url.trim();
    }
  }
  return { body: lines.join('\n'), image_url: imageUrl };
}

/** Rebuild notify blocks from the flat form (text + optional image). Preserves ids when possible. */
function syncNotifyBlocks(
  prevBlocks: MarketingTemplateBlock[],
  body: string,
  imageUrl: string | null,
): MarketingTemplateBlock[] {
  const prevText = prevBlocks.find((block) => block.type === 'text');
  const prevImage = prevBlocks.find((block) => block.type === 'image');
  const next: MarketingTemplateBlock[] = [
    {
      id: prevText?.id ?? crypto.randomUUID(),
      type: 'text',
      text: body,
    },
  ];
  if (imageUrl?.trim()) {
    next.push({
      id: prevImage?.id ?? crypto.randomUUID(),
      type: 'image',
      url: imageUrl.trim(),
    });
  }
  return next;
}

/** Blocks for a template saved before the builder existed (title/body only). */
function blocksFromLegacy(template: MarketingNotifyTemplate): MarketingTemplateBlock[] {
  if (template.blocks && template.blocks.length > 0) return template.blocks;
  const blocks: MarketingTemplateBlock[] = [];
  if (template.body) {
    blocks.push({ id: crypto.randomUUID(), type: 'text', text: template.body });
  }
  if (template.image_url) {
    blocks.push({ id: crypto.randomUUID(), type: 'image', url: template.image_url });
  }
  return blocks;
}

/** Sample values for the preview — mirrors keys `buildMarketingTemplateVars` fills at send time. */
const PREVIEW_VAR_SAMPLES: Record<string, string> = {
  user_name: 'คุณสมชาย',
  user_first_name: 'สมชาย',
  user_last_name: 'ใจดี',
  user_email: 'somchai@example.com',
  user_phone: '081-234-5678',
  user_custype: 'VIP',
  company_name: 'ร้านอาหารตัวอย่าง',
  company_phone: '02-123-4567',
  company_credit_limit: '100,000',
  cuisine_name: 'อาหารไทย',
  today: new Date().toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), { day: 'numeric', month: 'long' }),
};

function renderPreviewVars(text: string): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => PREVIEW_VAR_SAMPLES[key] ?? match);
}

export default function MarketingNotifyTemplates() {
  __useUiLocale();
  const [templates, setTemplates] = useState<MarketingNotifyTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  /** null = nothing open, 'new' = creating, otherwise template id. */
  const [editingId, setEditingId] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  /** popup mode: which content set is being edited on the canvas. */
  const [activeVariantId, setActiveVariantId] = useState<'default' | string>('default');
  /** notify mode: Blocks (flat push/in-app form) vs Email (creative canvas on channels.email). */
  const [activeNotifyTab, setActiveNotifyTab] = useState<'blocks' | 'email'>('blocks');
  /** Blocks tab locale: TH edits flat title/body/image; EN edits push i18n overlay. */
  const [pushLocale, setPushLocale] = useState<'th' | 'en'>('th');
  /** Which field last focused — variable chips insert here (`thTitle` = Thai title while on EN tab). */
  const [pushEnFocusField, setPushEnFocusField] = useState<'title' | 'body' | 'thTitle'>('body');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const [coupons, setCoupons] = useState<CouponOption[]>([]);
  const [segments, setSegments] = useState<UserSegmentListItem[]>([]);
  const banners = useBannerLibrary();

  const [revisions, setRevisions] = useState<MarketingNotifyTemplateRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(null);
  const templateNameInputId = useId();
  const segmentSelectId = useId();
  const pushTitleInputId = useId();
  const pushBodyThInputId = useId();
  const pushTitleEnInputId = useId();
  const pushBodyEnInputId = useId();
  const emailSubjectInputId = useId();
  const titleEnInputId = useId();
  const bodyEnInputId = useId();

  useEffect(() => {
    let cancelled = false;
    setTemplatesLoading(true);

    const normalize = (rows: unknown): MarketingNotifyTemplate[] => {
      if (Array.isArray(rows)) return rows as MarketingNotifyTemplate[];
      // Accidental axios/nest envelopes from older callers or HMR skew.
      const nested = (rows as { data?: unknown } | null)?.data;
      if (Array.isArray(nested)) return nested as MarketingNotifyTemplate[];
      const double = (nested as { data?: unknown } | null)?.data;
      return Array.isArray(double) ? (double as MarketingNotifyTemplate[]) : [];
    };

    const loadViaSameOriginProxy = async (): Promise<MarketingNotifyTemplate[]> => {
      const token =
        typeof window !== 'undefined' ? window.localStorage.getItem('token') : null;
      const response = await fetch('/api/marketing-notify-templates', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.status === 401 && token) {
        forceAdminLogout();
      }
      if (!response.ok) {
        throw new Error(`โหลด template ไม่สำเร็จ (HTTP ${response.status})`);
      }
      return normalize(await response.json());
    };

    (async () => {
      try {
        let rows = normalize(await getMarketingNotifyTemplates());
        // Standalone :4200 talks to :3000 directly; if that path returns an
        // empty array while the vite `/api` proxy has rows, prefer the proxy.
        if (rows.length === 0) {
          try {
            const viaProxy = await loadViaSameOriginProxy();
            if (viaProxy.length > 0) rows = viaProxy;
          } catch {
            // Keep the primary result (possibly empty).
          }
        }
        if (cancelled) return;
        setTemplates(rows);
        if (rows.length > 0) setError(null);
      } catch (err: any) {
        console.error('load marketing notify templates error:', err);
        try {
          const viaProxy = await loadViaSameOriginProxy();
          if (cancelled) return;
          setTemplates(viaProxy);
          if (viaProxy.length > 0) setError(null);
          return;
        } catch (proxyErr: any) {
          console.error('notify templates proxy fallback failed:', proxyErr);
        }
        if (cancelled) return;
        setTemplates([]);
        setError(
          err?.response?.data?.message ||
            err?.message ||
            __uiMessage("โหลดรายการ template ไม่สำเร็จ"),
        );
      } finally {
        // Always clear the loading flag for this effect instance when the
        // async work settles — even if a newer effect superseded it, the
        // newer effect sets loading true again on mount.
        setTemplatesLoading(false);
      }
    })();

    // คูปองจริงจากระบบ — บล็อกโค้ดคูปองเลือกจากตัวเลือกนี้แทนการพิมพ์เอง
    getCoupons(1, 200)
      .then((response: any) => {
        if (cancelled) return;
        const rows = response?.data?.data?.data ?? [];
        setCoupons(
          (Array.isArray(rows) ? rows : []).map((row: any) => ({
            id: row.id,
            coupon_code: row.coupon_code,
            title: row.title,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setCoupons([]);
      });

    // segments สำหรับ variant แบบ Braze ("segment นี้เห็น popup แบบนี้")
    getUserSegments()
      .then((rows) => {
        if (!cancelled) setSegments(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setSegments([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loadRevisions = (id: string) => {
    setRevisionsLoading(true);
    getMarketingNotifyTemplateRevisions(id)
      .then(setRevisions)
      .catch(() => setRevisions([]))
      .finally(() => setRevisionsLoading(false));
  };

  const openTemplate = (
    template: MarketingNotifyTemplate | null,
    newType: 'notify' | 'popup' = 'notify',
    /** When creating a notify template, open Blocks or Email tab. */
    initialNotifyTab: 'blocks' | 'email' = 'blocks',
  ) => {
    setError(null);
    setSavedFlash(false);
    setActiveVariantId('default');
    setActiveNotifyTab(template?.template_type === 'popup' ? 'blocks' : initialNotifyTab);
    setPushLocale('th');
    setPushEnFocusField('body');
    if (template) {
      setEditingId(template.id);
      const rawBlocks = blocksFromLegacy(template);
      const templateType = template.template_type ?? 'notify';
      const compiledLegacy = compileBlocks(rawBlocks);
      // Notify flat form: bake legacy coupon/extra blocks into body+image so the
      // simple fields show what actually gets sent.
      const blocks =
        templateType === 'popup'
          ? rawBlocks
          : syncNotifyBlocks(
              rawBlocks,
              compiledLegacy.body || template.body || '',
              compiledLegacy.image_url ?? template.image_url,
            );
      const channels = ensureTemplateChannels({
        templateType,
        blocks,
        title: template.title,
        body: template.body,
        imageUrl: template.image_url,
        channels: template.channels,
      });
      const baseDraft: Draft = {
        name: template.name,
        title: template.title,
        title_en: template.title_en ?? '',
        body_en: template.body_en ?? '',
        template_type: templateType,
        blocks,
        variants: template.variants ?? [],
        channels,
      };
      const ensured = ensurePopupDraftChannels(baseDraft);
      setDraft({ ...baseDraft, ...ensured });
      loadRevisions(template.id);
    } else {
      setEditingId('new');
      const blocks =
        newType === 'popup'
          ? [newBlock('text'), newBlock('coupon'), newBlock('button')]
          : [newBlock('text')];
      const channelsBase = ensureTemplateChannels({
        templateType: newType,
        blocks,
        title: '',
        body: '',
        imageUrl: null,
        channels: null,
      });
      // Eager email canvas when creating from "+ Template Email" (empty Unlayer-style body).
      const channels: MarketingCreativeChannels =
        newType === 'notify' && initialNotifyTab === 'email'
          ? { ...channelsBase, email: newEmailDesign() }
          : channelsBase;
      const baseDraft: Draft = {
        ...EMPTY_DRAFT,
        template_type: newType,
        blocks,
        variants: [],
        channels,
      };
      const ensured = ensurePopupDraftChannels(baseDraft);
      setDraft({ ...baseDraft, ...ensured });
      setRevisions([]);
    }
  };

  /** Active content = default title/blocks or the selected variant's. */
  const activeContent = useMemo(() => {
    if (activeVariantId === 'default') {
      return { title: draft.title, blocks: draft.blocks };
    }
    const variant = draft.variants.find((v) => v.id === activeVariantId);
    return variant
      ? { title: variant.title, blocks: variant.blocks }
      : { title: draft.title, blocks: draft.blocks };
  }, [draft, activeVariantId]);

  const patchActiveContent = (patch: { title?: string; blocks?: MarketingTemplateBlock[] }) => {
    setDraft((prev) => {
      if (activeVariantId === 'default') {
        return { ...prev, ...patch };
      }
      return {
        ...prev,
        variants: prev.variants.map((v) =>
          v.id === activeVariantId ? { ...v, ...patch } : v,
        ),
      };
    });
  };

  /**
   * Active popup design (Unlayer-style rows/columns) for the popup editor —
   * default channel or the selected variant's, migrated from legacy blocks
   * on first read (Task 5 Step 1/4).
   */
  const activePopupDesign: ChannelDesign = useMemo(() => {
    if (activeVariantId === 'default') {
      return draft.channels.popup ?? migrateBlocksToChannelDesign(draft.blocks);
    }
    const variant = draft.variants.find((v) => v.id === activeVariantId);
    if (!variant) return draft.channels.popup ?? migrateBlocksToChannelDesign(draft.blocks);
    return (variant.channels?.popup as ChannelDesign | undefined) ?? migrateBlocksToChannelDesign(variant.blocks);
  }, [draft, activeVariantId]);

  const patchActivePopupDesign = (design: ChannelDesign) => {
    setDraft((prev) => {
      if (activeVariantId === 'default') {
        return { ...prev, channels: { ...prev.channels, schemaVersion: 1, popup: design } };
      }
      return {
        ...prev,
        variants: prev.variants.map((v) =>
          v.id === activeVariantId
            ? { ...v, channels: { ...(v.channels ?? {}), schemaVersion: 1, popup: design } }
            : v,
        ),
      };
    });
  };

  /**
   * notify "Email" tab design — `channels.email`, seeded from the notify
   * blocks on first open (with EmailChrome defaults) since notify has no
   * variants for email yet.
   */
  const activeEmailDesign: ChannelDesign = useMemo(
    () =>
      draft.channels.email ??
      migrateBlocksToChannelDesign(draft.blocks, { ...DEFAULT_EMAIL_CHROME }),
    [draft.channels.email, draft.blocks],
  );

  const patchActiveEmailDesign = (design: ChannelDesign) => {
    setDraft((prev) => ({ ...prev, channels: { ...prev.channels, schemaVersion: 1, email: design } }));
  };

  /** Sync flat notify title/body/image edits into `draft.blocks` for save compatibility. */
  const patchNotifyFlat = (patch: { body?: string; imageUrl?: string | null }) => {
    setDraft((prev) => {
      const current = compileBlocks(prev.blocks);
      const body = patch.body !== undefined ? patch.body : current.body;
      const imageUrl =
        patch.imageUrl !== undefined ? patch.imageUrl : current.image_url;
      return {
        ...prev,
        blocks: syncNotifyBlocks(prev.blocks, body, imageUrl),
      };
    });
  };

  const addVariant = () => {
    const unusedSegment = segments.find(
      (segment) => !draft.variants.some((v) => v.segmentId === segment.id),
    );
    if (!unusedSegment) {
      setError(__uiMessage("ทุก segment ถูกใช้ใน variant แล้ว (หรือยังไม่มี segment ในระบบ)"));
      return;
    }
    const variant: MarketingTemplateVariant = {
      id: crypto.randomUUID(),
      segmentId: unusedSegment.id,
      segmentName: unusedSegment.name,
      title: draft.title,
      blocks: cloneBlocks(draft.blocks),
      channels:
        draft.template_type === 'popup'
          ? { schemaVersion: 1, popup: cloneChannelDesign(activePopupDesign) }
          : undefined,
    };
    setDraft((prev) => ({ ...prev, variants: [...prev.variants, variant] }));
    setActiveVariantId(variant.id);
  };

  const removeVariant = (id: string) => {
    setDraft((prev) => ({ ...prev, variants: prev.variants.filter((v) => v.id !== id) }));
    if (activeVariantId === id) setActiveVariantId('default');
  };

  const patchVariantSegment = (id: string, segmentId: string) => {
    const segment = segments.find((s) => s.id === segmentId);
    setDraft((prev) => ({
      ...prev,
      variants: prev.variants.map((v) =>
        v.id === id ? { ...v, segmentId, segmentName: segment?.name } : v,
      ),
    }));
  };

  const compiled = useMemo(() => compileBlocks(draft.blocks), [draft.blocks]);

  /** Flat-form controlled values — prefer raw text/image blocks so typing isn't trimmed mid-edit. */
  const notifyBodyText = useMemo(() => {
    const textBlock = draft.blocks.find(
      (block): block is Extract<MarketingTemplateBlock, { type: 'text' }> => block.type === 'text',
    );
    return textBlock ? textBlock.text : compiled.body;
  }, [draft.blocks, compiled.body]);

  const notifyImageUrl = useMemo(() => {
    const imageBlock = draft.blocks.find(
      (block): block is Extract<MarketingTemplateBlock, { type: 'image' }> => block.type === 'image',
    );
    return imageBlock ? imageBlock.url : compiled.image_url ?? '';
  }, [draft.blocks, compiled.image_url]);

  /**
   * Patch the push channel's EN overlay (`channels.push.i18n.en`). An empty string
   * deletes that key so it falls back to the Thai (compiled-from-blocks) value —
   * same empty-string-deletes rule as `useCreativeI18n.patchOverlay`. `sourceTitle`/
   * `sourceBody` are editor-only metadata (I2): the Thai text the EN overlay was
   * translated against, stamped whenever the EN title/body is written, used to warn
   * when the Thai source has since changed. When the last field is cleared the whole
   * `en: {}` entry is pruned (M2) — mirrors `useCreativeI18n.patchOverlay`.
   */
  const patchPushI18n = (
    patch: Partial<{
      title: string;
      body: string;
      imageUrl: string;
      sourceTitle: string;
      sourceBody: string;
    }>,
  ) => {
    setDraft((prev) => {
      const nextEn: Record<string, string> = { ...(prev.channels.push?.i18n?.en ?? {}) };
      for (const [key, value] of Object.entries(patch)) {
        if (typeof value === 'string' && value.trim()) nextEn[key] = value;
        else delete nextEn[key];
      }
      const i18n = { ...(prev.channels.push?.i18n ?? {}) };
      if (Object.keys(nextEn).length > 0) i18n.en = nextEn;
      else delete i18n.en;
      const basePush = prev.channels.push ?? { title: '', body: '' };
      return {
        ...prev,
        channels: { ...prev.channels, schemaVersion: 1, push: { ...basePush, i18n } },
      };
    });
  };

  const handleSave = async () => {
    // Popup content lives in `channels.popup` (edited via PopupCreativeEditor);
    // notify content lives in flat form → `draft.blocks` (text + optional image).
    // Each save rebuilds the *other* channel's design from its own source of
    // truth so save never discards edits to the format that isn't primary.
    const isPopupSave = draft.template_type === 'popup';

    if (!draft.name.trim()) {
      setError(__uiMessage("กรอกชื่อ template ก่อน"));
      return;
    }
    // Popup chrome title is optional (not shown on shop; content uses text elements).
    // Notify / email still require a title + body text.
    if (!isPopupSave && !draft.title.trim()) {
      setError(__uiMessage("กรอกชื่อ template และหัวข้อก่อน"));
      return;
    }

    const popupEnsured = isPopupSave ? ensurePopupDraftChannels(draft) : null;
    const channelsBase = popupEnsured
      ? { ...draft.channels, ...popupEnsured.channels }
      : { ...draft.channels, inApp: migrateBlocksToChannelDesign(draft.blocks) };
    const variantsForSave = popupEnsured?.variants ?? draft.variants;

    const blocks = isPopupSave
      ? projectChannelDesignToBlocks(channelsBase.popup as ChannelDesign)
      : draft.blocks;
    const compiledPrimary = compileBlocks(blocks);
    const bodyForValidation = isPopupSave ? compiledPrimary.body : compiled.body;
    const pushBody = isPopupSave ? compiledPrimary.body : compiled.body;
    const pushImage = isPopupSave ? compiledPrimary.image_url : compiled.image_url;

    const channels: MarketingCreativeChannels = {
      ...channelsBase,
      schemaVersion: 1,
      push: {
        title: draft.title.trim(),
        body: pushBody,
        imageUrl: pushImage,
        // Save always recompiles title/body/imageUrl from draft.title/blocks (the TH
        // source of truth) — carry the EN overlay forward or it gets silently wiped.
        i18n: draft.channels.push?.i18n,
      },
    };

    if (!isPopupSave && !bodyForValidation.trim()) {
      setError(__uiMessage("กรอกข้อความแจ้งเตือนก่อน"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const variantsPayload: MarketingTemplateVariant[] | null = isPopupSave
        ? variantsForSave.map((variant) => {
            const variantDesign =
              (variant.channels?.popup as ChannelDesign | undefined) ??
              migrateBlocksToChannelDesign(variant.blocks);
            return {
              ...variant,
              channels: {
                ...(variant.channels ?? {}),
                schemaVersion: 1 as const,
                popup: variantDesign,
              },
              blocks: projectChannelDesignToBlocks(variantDesign),
            };
          })
        : null;
      const payload = {
        name: draft.name.trim(),
        template_type: draft.template_type,
        title: draft.title.trim(),
        body: bodyForValidation,
        title_en: draft.title_en.trim() || null,
        body_en: draft.body_en.trim() || null,
        image_url: pushImage,
        blocks,
        channels,
        variants: variantsPayload,
      };
      if (editingId === 'new') {
        const created = await createMarketingNotifyTemplate(payload);
        setTemplates((prev) => [created, ...prev]);
        setEditingId(created.id);
        loadRevisions(created.id);
      } else if (editingId) {
        const updated = await updateMarketingNotifyTemplate(editingId, payload);
        setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        loadRevisions(updated.id);
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err: any) {
      setError(err?.response?.data?.message || __uiMessage("บันทึกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (!editingId || editingId === 'new') return;
    const revision = revisions.find((r) => r.id === revisionId);
    const label = revision ? new Date(revision.created_at).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) : 'เวอร์ชันนี้';
    if (
      !window.confirm(
        __uiText("ย้อนกลับ template ไปเป็นเวอร์ชันเมื่อ {0} ใช่หรือไม่? การแก้ไขปัจจุบันจะถูกแทนที่ (แต่ยังย้อนกลับมาได้อีกครั้งภายหลัง)", {"0": label}),
      )
    ) {
      return;
    }
    setRestoringRevisionId(revisionId);
    setError(null);
    try {
      const restored = await restoreMarketingNotifyTemplateRevision(editingId, revisionId);
      setTemplates((prev) => prev.map((t) => (t.id === restored.id ? restored : t)));
      openTemplate(restored);
    } catch (err: any) {
      setError(err?.response?.data?.message || __uiMessage("ย้อนกลับไม่สำเร็จ"));
    } finally {
      setRestoringRevisionId(null);
    }
  };

  const handleDelete = async (template: MarketingNotifyTemplate) => {
    if (template.is_system) return;
    setBusy(true);
    setError(null);
    try {
      await deleteMarketingNotifyTemplate(template.id);
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
      if (editingId === template.id) setEditingId(null);
    } catch (err: any) {
      setError(err?.response?.data?.message || __uiMessage("ลบไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  const insertVariable = (key: string) => {
    if (!isPopup && activeNotifyTab === 'blocks' && pushLocale === 'en') {
      if (pushEnFocusField === 'thTitle') {
        setDraft({ ...draft, title: `${draft.title}{{${key}}}`.trim() });
        return;
      }
      const current = draft.channels.push?.i18n?.en ?? {};
      if (pushEnFocusField === 'title') {
        const nextTitle = `${current.title ?? ''}{{${key}}}`.trim();
        patchPushI18n({ title: nextTitle, sourceTitle: draft.title });
      } else {
        const nextBody = `${current.body ?? ''}{{${key}}}`.trim();
        patchPushI18n({ body: nextBody, sourceBody: compiled.body });
      }
      return;
    }
    // TH flat form — insert into last-focused title or body.
    if (pushEnFocusField === 'title' || pushEnFocusField === 'thTitle') {
      setDraft({ ...draft, title: `${draft.title}{{${key}}}`.trim() });
      return;
    }
    patchNotifyFlat({ body: `${notifyBodyText}{{${key}}}` });
  };

  const activeVariant =
    activeVariantId === 'default'
      ? null
      : draft.variants.find((v) => v.id === activeVariantId) ?? null;

  const isPopup = draft.template_type === 'popup';

  // I1: push preview must follow the ไทย/EN toggle instead of always showing the Thai source.
  const resolvedPush = useMemo(
    () =>
      resolvePushForLocale(
        {
          title: draft.title,
          body: compiled.body,
          imageUrl: compiled.image_url,
          i18n: draft.channels.push?.i18n,
        },
        pushLocale === 'en' ? 'en' : null,
      ),
    [draft.title, compiled.body, compiled.image_url, draft.channels.push?.i18n, pushLocale],
  );

  // I2: staleness — the EN overlay was translated against a Thai title/body snapshot
  // (`sourceTitle`/`sourceBody`, stamped on every EN edit); warn when the live Thai
  // value has since drifted from that snapshot.
  const pushEnEntry = draft.channels.push?.i18n?.en;
  const titleTranslationStale =
    !!pushEnEntry?.title?.trim() &&
    !!pushEnEntry?.sourceTitle?.trim() &&
    pushEnEntry.sourceTitle !== draft.title;
  const bodyTranslationStale =
    !!pushEnEntry?.body?.trim() &&
    !!pushEnEntry?.sourceBody?.trim() &&
    pushEnEntry.sourceBody !== compiled.body;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Link to={ADMIN_ROUTES.marketingWorkflows} className="text-xs text-primary hover:underline">
          {__uiText("&larr; Marketing Workflows")}</Link>
        <h1 className="mt-1 text-xl font-bold text-gray-800">{__uiText("Notify · Email · Popup Templates")}</h1>
        <p className="mt-1 text-xs text-gray-500">
          {__uiText("สร้าง template แจ้งเตือน (push/in-app) · อีเมล HTML · หรือ popup · ใส่ตัวแปรได้ · popup ทำ variant ตาม segment ได้ — ใช้ใน step \"แจ้งเตือน\" / \"แสดง Offer\"")}</p>
      </div>

      {/* popup: 2 cols — PopupCreativeEditor มี panel ของตัวเองอยู่แล้ว ไม่จองคอลัมน์ขวา 300px ทิ้งไว้ */}
      <div
        className={`grid gap-4 ${
          isPopup && editingId !== null
            ? 'lg:grid-cols-[260px_1fr]'
            : 'lg:grid-cols-[260px_1fr_300px]'
        }`}
      >
        {/* รายการ template */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => openTemplate(null, 'notify')}
            className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            {__uiText("+ Template แจ้งเตือน")}</button>
          <button
            type="button"
            onClick={() => openTemplate(null, 'notify', 'email')}
            className="w-full rounded-lg border border-sky-700 bg-white px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-50"
          >
            {__uiText("+ Template Email (HTML layout)")}</button>
          <button
            type="button"
            onClick={() => openTemplate(null, 'popup')}
            className="w-full rounded-lg border border-gray-900 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            {__uiText("+ Template Popup (มีปุ่ม action)")}</button>
          {templates.map((template) => (
            <div
              key={template.id}
              className={`cursor-pointer rounded-lg border p-2.5 transition-colors ${
                editingId === template.id
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
              onClick={() => openTemplate(template)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-800">{template.name}</p>
                  <p className="truncate text-[11px] text-gray-400">
                    <span
                      className={`mr-1 rounded px-1 py-px text-[9px] font-semibold ${
                        template.template_type === 'popup'
                          ? 'bg-violet-100 text-violet-600'
                          : 'bg-sky-100 text-sky-600'
                      }`}
                    >
                      {template.template_type === 'popup'
                        ? __uiText("POPUP")
                        : template.channels?.email
                          ? __uiText("แจ้งเตือน+EMAIL")
                          : __uiText("แจ้งเตือน")}
                    </span>
                    {template.is_system && (
                      <span
                        className="mr-1 rounded bg-emerald-100 px-1 py-px text-[9px] font-semibold text-emerald-700"
                        title={__uiText("เทมเพลตระบบ — ใช้แจ้งเตือนออเดอร์/สต๊อกจริง แก้ข้อความได้ แต่ลบไม่ได้")}
                      >
                        {__uiText("ระบบ")}</span>
                    )}
                    {(template.variants?.length ?? 0) > 0 && (
                      <span className="mr-1 rounded bg-amber-100 px-1 py-px text-[9px] font-semibold text-amber-600">
                        {template.variants!.length} {__uiText(" variant")}</span>
                    )}
                    {template.title}
                  </p>
                </div>
                <button
                  type="button"
                  title={
                    template.is_system
                      ? __uiText("เทมเพลตระบบลบไม่ได้ — ระบบแจ้งเตือนต้องใช้ key นี้เสมอ (แก้ข้อความได้)")
                      : __uiText("ลบ template")
                  }
                  disabled={template.is_system}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (template.is_system) return;
                    handleDelete(template);
                  }}
                  className={`shrink-0 rounded p-1 ${
                    template.is_system
                      ? 'cursor-not-allowed text-gray-200'
                      : 'text-gray-300 hover:text-red-500'
                  }`}
                >
                  <MdOutlineClose size={14} />
                </button>
              </div>
            </div>
          ))}
          {templatesLoading && (
            <p className="px-1 text-[11px] text-gray-400">{__uiText("กำลังโหลด template...")}</p>
          )}
          {error && templates.length === 0 && !templatesLoading && (
            <p className="px-1 text-[11px] text-red-500">{(typeof error === 'string' ? __uiText(error) : error)}</p>
          )}
          {templates.length === 0 && !error && !templatesLoading && (
            <p className="px-1 text-[11px] text-gray-400">{__uiText("ยังไม่มี template — กดสร้างอันแรกเลย")}</p>
          )}
        </div>

        {editingId === null ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400 lg:col-span-2">
            {__uiText("เลือก template ทางซ้าย หรือกด \"+ สร้าง template ใหม่\"")}</div>
        ) : (
          <>
            {/* กลาง: canvas (popup = WYSIWYG บนตัว popup, notify = ฟอร์ม + preview แยก) */}
            <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
              <div>
                <label htmlFor={templateNameInputId} className={FIELD_LABEL}>{__uiText("ชื่อ template (ให้ทีมเห็นใน dropdown)")}</label>
                <input
                  id={templateNameInputId}
                  type="text"
                  className={INPUT_CLASS}
                  placeholder={isPopup ? __uiText("เช่น Popup ฝนตก") : __uiText("เช่น โปรฝนตก push")}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </div>

              {isPopup && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveVariantId('default');
                    }}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                      activeVariantId === 'default'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {__uiText("ทุกคน (ค่าเริ่มต้น)")}</button>
                  {draft.variants.map((variant) => (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => {
                        setActiveVariantId(variant.id);
                      }}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                        activeVariantId === variant.id
                          ? 'border-amber-500 bg-amber-50 text-amber-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {variant.segmentName ||
                        segments.find((s) => s.id === variant.segmentId)?.name ||
                        __uiText("segment")}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={addVariant}
                    className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:border-primary hover:text-primary"
                  >
                    {__uiText("+ variant ตาม segment")}</button>
                </div>
              )}

              {!isPopup && (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 pb-2">
                  <button
                    type="button"
                    onClick={() => setActiveNotifyTab('blocks')}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                      activeNotifyTab === 'blocks'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {__uiText("Push / In-app")}</button>
                  <button
                    type="button"
                    onClick={() => setActiveNotifyTab('email')}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                      activeNotifyTab === 'email'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {__uiText("Email")}</button>
                </div>
              )}

              {!isPopup && activeNotifyTab === 'blocks' && (
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[10px] font-semibold tracking-wide text-gray-400">
                    {__uiText("ภาษาที่แก้ไข (push/in-app)")}</span>
                  <div className="flex shrink-0 overflow-hidden rounded-md border border-gray-200">
                    {(['th', 'en'] as const).map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setPushLocale(code)}
                        className={`px-2.5 py-1 text-[11px] font-medium ${
                          pushLocale === code
                            ? 'bg-primary text-white'
                            : 'bg-white text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {code === 'th' ? __uiText("ไทย") : __uiText("EN")}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {isPopup ? (
                /* ===== Unlayer-style popup editor: chrome preview + rows/columns/elements ===== */
                <div className="space-y-2">
                  {activeVariant && (
                    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                      <label htmlFor={segmentSelectId} className="block text-[10px] font-semibold tracking-wide text-amber-700">
                        {__uiText("VARIANT ตาม SEGMENT")}</label>
                      <Select
                        id={segmentSelectId}
                        className="w-full"
                        value={activeVariant.segmentId}
                        onChange={(event) =>
                          patchVariantSegment(activeVariant.id, event.target.value)
                        }
                      >
                        {segments.map((segment) => (
                          <option key={segment.id} value={segment.id}>
                            {segment.name}
                          </option>
                        ))}
                      </Select>
                      <p className="text-[11px] leading-relaxed text-amber-700/80">
                        {__uiText("user ที่อยู่ใน segment นี้เห็นเนื้อหาชุดนี้แทนค่าเริ่มต้น (variant แรกที่ตรงชนะ · guest เห็นค่าเริ่มต้นเสมอ)")}</p>
                      <button
                        type="button"
                        onClick={() => removeVariant(activeVariant.id)}
                        className="text-[11px] text-red-500 hover:underline"
                      >
                        {__uiText("ลบ variant นี้")}</button>
                    </div>
                  )}
                  <PopupCreativeEditor
                    design={activePopupDesign}
                    onChange={patchActivePopupDesign}
                    title={activeContent.title}
                    onTitleChange={(title) => patchActiveContent({ title })}
                    coupons={coupons}
                    banners={banners}
                    variables={MARKETING_TEMPLATE_VARIABLES}
                  />
                  <p className="text-center text-[10px] text-gray-400">
                    {activeVariant
                      ? __uiText("กำลังแก้ variant: {0} — คนใน segment นี้เห็นแบบนี้", {"0": activeVariant.segmentName ?? 'segment'})
                      : __uiText("กำลังแก้ค่าเริ่มต้น — ทุกคนที่ไม่เข้า variant ไหนเห็นแบบนี้")}
                  </p>
                </div>
              ) : activeNotifyTab === 'email' ? (
                /* ===== notify: Email tab — creative canvas on channels.email ===== */
                <div className="space-y-2">
                  <div>
                    <label htmlFor={emailSubjectInputId} className={FIELD_LABEL}>{__uiText("หัวข้ออีเมล (Subject — ใช้ตัวแปรได้)")}</label>
                    <input
                      id={emailSubjectInputId}
                      type="text"
                      className={INPUT_CLASS}
                      placeholder={__uiText("เช่น {{user_name}} มีคูปองรอคุณอยู่")}
                      value={draft.title}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    />
                  </div>
                  <EmailCreativeEditor
                    design={activeEmailDesign}
                    onChange={patchActiveEmailDesign}
                    coupons={coupons}
                    banners={banners}
                    variables={MARKETING_TEMPLATE_VARIABLES}
                  />
                  <p className="text-center text-[10px] text-gray-400">
                    {__uiText("เนื้อหาอีเมลอยู่ที่ canvas นี้ · หัวข้อด้านบน = subject ที่ส่งจริง · แท็บ Push / In-app ยังใช้ตั้งแจ้งเตือนแยกได้")}</p>
                </div>
              ) : pushLocale === 'en' ? (
                /* ===== notify: push/in-app EN overlay — flat title/body/imageUrl, not blocks ===== */
                <div className="space-y-2">
                  {/* M5: the Thai title is what save() actually validates — keep it reachable
                      even while the admin is on the EN tab, or the validation error points at
                      a field that's off screen. */}
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-2">
                    <label htmlFor={pushTitleInputId} className={FIELD_LABEL}>{__uiText("หัวข้อแจ้งเตือน (ไทย — ต้นฉบับ, จำเป็นต้องกรอก)")}</label>
                    <input
                      id={pushTitleInputId}
                      type="text"
                      className={INPUT_CLASS}
                      placeholder={__uiText("เช่น {{user_name}} ฝนตกแบบนี้ รับส่วนลดเลย ☔")}
                      value={draft.title}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                      onFocus={() => setPushEnFocusField('thTitle')}
                    />
                  </div>
                  <div>
                    <label htmlFor={pushTitleEnInputId} className={FIELD_LABEL}>{__uiText("หัวข้อแจ้งเตือน (EN)")}</label>
                    <input
                      id={pushTitleEnInputId}
                      type="text"
                      className={INPUT_CLASS}
                      placeholder={draft.title || __uiText("Notification title")}
                      value={pushEnEntry?.title ?? ''}
                      onFocus={() => setPushEnFocusField('title')}
                      onChange={(event) => {
                        const value = event.target.value;
                        patchPushI18n({
                          title: value,
                          sourceTitle: value.trim() ? draft.title : '',
                        });
                      }}
                    />
                    {titleTranslationStale && (
                      <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
                        <p className="text-[11px] leading-relaxed text-amber-700">
                          {__uiText("ข้อความไทยเปลี่ยนหลังแปลแล้ว — ตรวจสอบคำแปลอังกฤษอีกครั้ง")}</p>
                        <button
                          type="button"
                          onClick={() => patchPushI18n({ sourceTitle: draft.title })}
                          className="shrink-0 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100"
                        >
                          {__uiText("ตรวจแล้ว")}</button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label htmlFor={pushBodyEnInputId} className={FIELD_LABEL}>{__uiText("ข้อความ (EN)")}</label>
                    <textarea
                      id={pushBodyEnInputId}
                      rows={4}
                      className={INPUT_CLASS}
                      placeholder={compiled.body || __uiText("Notification body")}
                      value={pushEnEntry?.body ?? ''}
                      onFocus={() => setPushEnFocusField('body')}
                      onChange={(event) => {
                        const value = event.target.value;
                        patchPushI18n({
                          body: value,
                          sourceBody: value.trim() ? compiled.body : '',
                        });
                      }}
                    />
                    {bodyTranslationStale && (
                      <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
                        <p className="text-[11px] leading-relaxed text-amber-700">
                          {__uiText("ข้อความไทยเปลี่ยนหลังแปลแล้ว — ตรวจสอบคำแปลอังกฤษอีกครั้ง")}</p>
                        <button
                          type="button"
                          onClick={() => patchPushI18n({ sourceBody: compiled.body })}
                          className="shrink-0 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100"
                        >
                          {__uiText("ตรวจแล้ว")}</button>
                      </div>
                    )}
                  </div>
                  <ImageSourceField
                    label={__uiText("รูปภาพ (EN)")}
                    value={pushEnEntry?.imageUrl ?? ''}
                    basePreviewValue={compiled.image_url ?? undefined}
                    onChange={(url) => patchPushI18n({ imageUrl: url })}
                    banners={banners}
                  />
                  <p className="text-[11px] leading-relaxed text-gray-400">
                    {__uiText("เนื้อหาไทย (ต้นฉบับ) แก้ที่ช่องด้านบน — ค่า EN นี้แทนที่เฉพาะช่องที่กรอก ช่องว่าง = ใช้ค่าไทยแทน")}</p>
                </div>
              ) : (
                /* ===== notify: flat push/in-app form (TH) ===== */
                <>
                  <div>
                    <label htmlFor={pushTitleInputId} className={FIELD_LABEL}>{__uiText("หัวข้อแจ้งเตือน (ใช้ตัวแปรได้)")}</label>
                    <input
                      id={pushTitleInputId}
                      type="text"
                      className={INPUT_CLASS}
                      placeholder={__uiText("เช่น {{user_name}} ฝนตกแบบนี้ รับส่วนลดเลย ☔")}
                      value={draft.title}
                      onFocus={() => setPushEnFocusField('title')}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    />
                  </div>
                  <div>
                    <label htmlFor={pushBodyThInputId} className={FIELD_LABEL}>{__uiText("ข้อความแจ้งเตือน")}</label>
                    <textarea
                      id={pushBodyThInputId}
                      rows={4}
                      className={INPUT_CLASS}
                      placeholder={__uiText("เช่น {{user_name}} ช้อปตอนนี้ลดพิเศษ")}
                      value={notifyBodyText}
                      onFocus={() => setPushEnFocusField('body')}
                      onChange={(event) => patchNotifyFlat({ body: event.target.value })}
                    />
                  </div>
                  <ImageSourceField
                    label={__uiText("รูปภาพ (ไม่บังคับ)")}
                    value={notifyImageUrl}
                    onChange={(url) => patchNotifyFlat({ imageUrl: url || null })}
                    banners={banners}
                  />
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-2.5 space-y-2">
                    <p className="text-[10px] font-semibold tracking-wide text-gray-400">
                      {__uiText("เนื้อหาที่ส่งจริงสำหรับผู้รับภาษาอังกฤษ (order_paid ฯลฯ) — เว้นว่างได้ ถ้าไม่กรอก ระบบจะใช้ข้อความ EN ที่ตั้งไว้ในโค้ดแทน")}</p>
                    <div>
                      <label htmlFor={titleEnInputId} className={FIELD_LABEL}>{__uiText("หัวข้อ (EN)")}</label>
                      <input
                        id={titleEnInputId}
                        type="text"
                        className={INPUT_CLASS}
                        placeholder={__uiText("เช่น Your order has been paid")}
                        value={draft.title_en}
                        onChange={(event) => setDraft({ ...draft, title_en: event.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor={bodyEnInputId} className={FIELD_LABEL}>{__uiText("ข้อความ (EN)")}</label>
                      <textarea
                        id={bodyEnInputId}
                        rows={3}
                        className={INPUT_CLASS}
                        placeholder={__uiText("เช่น Thank you for your order, ...")}
                        value={draft.body_en}
                        onChange={(event) => setDraft({ ...draft, body_en: event.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}

              {error && <p className="text-xs text-red-500">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
              <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSave}
                  className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {busy ? __uiText("กำลังบันทึก...") : editingId === 'new' ? __uiText("สร้าง template") : __uiText("บันทึก")}
                </button>
                {savedFlash && <span className="text-xs text-emerald-600">{__uiText("บันทึกแล้ว ✓")}</span>}
              </div>
            </div>

            {/* ขวา: ตัวแปร + notify preview (popup ใช้ full-width editor — ไม่เรนเดอร์คอลัมน์นี้) */}
            {!isPopup && (
            <div className="space-y-3">
              {activeNotifyTab === 'blocks' && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-2">
                  <span className="text-[10px] font-semibold tracking-wide text-gray-400">
                    {__uiText("ตัวแปร (คลิกเพื่อแทรก)")}</span>
                  {MARKETING_TEMPLATE_VARIABLES.map((variable) => (
                    <button
                      key={variable.key}
                      type="button"
                      onClick={() => insertVariable(variable.key)}
                      className="rounded-md border border-gray-200 bg-white px-2 py-0.5 font-mono text-[11px] text-gray-600 hover:border-primary hover:text-primary"
                      title={variable.label}
                    >
                      {'{{'}{variable.key}{'}}'} · {variable.label}
                    </button>
                  ))}
                </div>
              )}

              {activeNotifyTab === 'blocks' && (
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold tracking-wide text-gray-400">
                    {__uiText("PREVIEW (ตัวแปรถูกแทนด้วยค่าตัวอย่าง)")}</div>
                  <div className="rounded-2xl border border-gray-200 bg-gray-900 p-3">
                    <div className="rounded-xl bg-white/95 p-3 shadow-lg">
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                        <span className="grid h-4 w-4 place-items-center rounded bg-primary/20 text-[8px] font-bold text-primary">
                          {__uiText("J")}</span>
                        {__uiText("JOSH · ตอนนี้")}</div>
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        {renderPreviewVars(resolvedPush.title) || __uiText("หัวข้อแจ้งเตือน")}
                      </p>
                      <p className="whitespace-pre-line text-xs text-gray-600">
                        {renderPreviewVars(resolvedPush.body) || __uiText("ข้อความแจ้งเตือนจะแสดงที่นี่")}
                      </p>
                      {resolvedPush.imageUrl && (
                        <img
                          src={resolvedPush.imageUrl}
                          alt={__uiText("banner")}
                          className="mt-2 w-full rounded-lg object-cover"
                        />
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-gray-400">
                    {__uiText("push แสดงหัวข้อ + ข้อความ + รูปใหญ่ · in-app เก็บรูปไว้ใน data · ตัวแปรจะถูกแทนด้วยข้อมูลลูกค้าจริงตอนส่ง")}</p>
                </div>
              )}

              {editingId !== 'new' && (
                <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold tracking-wide text-gray-400">
                      {__uiText("ประวัติการแก้ไข (ล่าสุด 20 ครั้ง)")}</p>
                    {revisionsLoading && (
                      <span className="text-[10px] text-gray-300">{__uiText("กำลังโหลด...")}</span>
                    )}
                  </div>
                  {revisions.length === 0 ? (
                    <p className="text-[11px] text-gray-400">{__uiText("ยังไม่มีประวัติการแก้ไข")}</p>
                  ) : (
                    <ul className="max-h-56 space-y-1 overflow-y-auto">
                      {revisions.map((revision) => (
                        <li
                          key={revision.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-gray-100 px-2 py-1.5"
                        >
                          <p className="min-w-0 truncate text-[11px] text-gray-600">
                            {new Date(revision.created_at).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}
                            {revision.updated_by && (
                              <span className="text-gray-400"> · {revision.updated_by}</span>
                            )}
                          </p>
                          <button
                            type="button"
                            disabled={restoringRevisionId === revision.id}
                            onClick={() => handleRestoreRevision(revision.id)}
                            className="shrink-0 rounded border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:border-primary hover:text-primary disabled:opacity-50"
                          >
                            {restoringRevisionId === revision.id ? __uiText("กำลังย้อนกลับ...") : __uiText("ย้อนกลับ")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
