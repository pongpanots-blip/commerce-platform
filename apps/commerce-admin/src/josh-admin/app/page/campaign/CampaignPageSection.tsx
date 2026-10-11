import { getPromotionPage, type CampaignDetail, type PromotionPageSummary } from '@josh/shared-api';
import { Button } from '@josh/shared-ui-web';
import { useEffect, useId, useState } from 'react';
import { CouponFormErrorBanner } from '../coupon/CouponFormSections';
import PageForm from '../promotion-page/PageForm';
import { getErrorMessage } from '../promotion-common';
import { pageContentNotices } from './campaign.helpers';

/** หน้าโปร: 1 campaign มีได้ 1 หน้า — สร้างที่นี่ (ผูก campaign ให้เลย) หรือแก้ฟอร์มเดียวกับเมนู Promotion Pages */
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export default function CampaignPageSection({
  campaign,
  onChanged,
  onDirtyChange,
}: {
  campaign: CampaignDetail;
  /** The page was created or edited — the hub re-reads the campaign (its `page` summary changed). */
  onChanged: () => void;
  /** The page form has (or no longer has) unsaved edits — the hub warns before leaving. Pass a stable function. */
  onDirtyChange: (dirty: boolean) => void;
}) {
  __useUiLocale();
  const headingId = useId();
  const pageId = campaign.page?.id ?? null;
  const [page, setPage] = useState<PromotionPageSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(!!pageId);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    void (async () => {
      try {
        const row = await getPromotionPage(pageId);
        if (cancelled) return;
        setPage(row);
        setLoadError('');
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'โหลดหน้าโปรไม่สำเร็จ'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageId, reloadKey]);

  const campaigns = [campaign];
  let body;
  if (loading) {
    body = <p className="text-sm text-ink-muted">{__uiText("กำลังโหลด...")}</p>;
  } else if (loadError) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <CouponFormErrorBanner error={loadError} />
        <Button
          variant="secondary"
          text={__uiText("ลองใหม่")}
          onClick={() => {
            setLoading(true);
            setReloadKey((key) => key + 1);
          }}
        />
      </div>
    );
  } else if (page) {
    // Saved inside the form (its own button) — separate from the Campaign info save above.
    body = (
      <PageForm
        key={page.id}
        page={page}
        campaigns={campaigns}
        campaignLocked
        headingLevel={3}
        onDirtyChange={onDirtyChange}
        onSaved={(saved) => {
          setPage(saved);
          onChanged();
        }}
      />
    );
  } else if (creating) {
    body = (
      <div className="flex flex-col gap-4">
        <PageForm
          campaigns={campaigns}
          campaignId={campaign.id}
          campaignLocked
          headingLevel={3}
          onDirtyChange={onDirtyChange}
          onSaved={(saved) => {
            setPage(saved);
            setCreating(false);
            onChanged();
          }}
        />
        <div>
          <Button variant="secondary" text={__uiText("ยกเลิก")} onClick={() => setCreating(false)} />
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-ink-muted">{__uiText("ยังไม่มีหน้าโปร — ลูกค้ายังเปิดดูสินค้าของงานนี้ทั้งชุดในหน้าเดียวไม่ได้")}</p>
        <Button text={__uiText("สร้างหน้าโปร")} onClick={() => setCreating(true)} />
      </div>
    );
  }

  return (
    // A card of its own: the form inside has its own save button, separate from the header's.
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border-2 border-primary-border bg-primary-soft/30 p-4"
    >
      <div>
        <h2 id={headingId} className="text-base font-bold text-ink">
          {__uiText("หน้าโปร")}</h2>
        <p className="mt-1 text-xs text-ink-secondary">
          {__uiText("แบนเนอร์ สินค้าของโปรอัตโนมัติ และคูปองสาธารณะที่ใช้งานอยู่ของแคมเปญ (รวมสินค้าที่คูปองจำกัดไว้)")}{' '}
          <strong>{__uiText("บันทึกแยก")}</strong>{__uiText("จากข้อมูลแคมเปญด้านบน (ปุ่มของหน้าโปรอยู่ท้ายการ์ดนี้)")}</p>
      </div>
      {pageContentNotices(campaign).map((notice) => (
        <p
          key={notice.text}
          role="status"
          className={
            notice.tone === 'warning'
              ? 'rounded-lg border border-warn/20 bg-warn-container px-3 py-2 text-xs text-warn'
              : 'text-xs text-ink-muted'
          }
        >
          {(typeof (notice.text) === 'string' ? __uiText(notice.text) : notice.text)}
        </p>
      ))}
      {body}
    </section>
  );
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
