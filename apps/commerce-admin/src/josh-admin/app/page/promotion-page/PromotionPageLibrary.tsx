// ui-metadata-migration: static labels and UI notices only
import {
  deletePromotionPage,
  formatBangkokRange,
  listCampaigns,
  listPromotionPages,
  type CampaignListItem,
  type PromotionPageSummary,
} from '@josh/shared-api';
import { Button, Input, Table, TableColumn } from '@josh/shared-ui-web';
import { useEffect, useMemo, useState } from 'react';
import { AiOutlineDelete, AiOutlineEdit, AiOutlineSearch } from 'react-icons/ai';
import { HiOutlineExternalLink } from 'react-icons/hi';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import CopyIdButton from '../../components/CopyIdButton';
import { toShopPath, toShopUrl } from '../../config/admin-base-path';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import CouponConfirmDialog from '../coupon/CouponConfirmDialog';
import { CouponFormErrorBanner } from '../coupon/CouponFormSections';
import { getErrorMessage } from '../promotion-common';
import { ActivePill } from './PromotionPageControls';
import { defaultDeeplink, shopPagePath } from './promotion-page-form.helpers';

/**
 * A page is a banner plus the product list of its campaign — nothing to publish, so the
 * only state is on/off (+ the campaign's date window) and whether it is on the home page.
 */
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export default function PromotionPageLibrary() {
  __useUiLocale();
  const [rows, setRows] = useState<PromotionPageSummary[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<PromotionPageSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // The campaign names are a nicety — a failing campaign list must not hide the pages.
        const [pages, campaignList] = await Promise.all([
          listPromotionPages(),
          listCampaigns().catch(() => [] as CampaignListItem[]),
        ]);
        if (cancelled) return;
        setRows(pages);
        setCampaigns(campaignList);
        setLoadError('');
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'โหลดรายการไม่สำเร็จ'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const campaignName = useMemo(() => new Map(campaigns.map((item) => [item.id, item.name])), [campaigns]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? rows.filter((row) => row.name.toLowerCase().includes(query) || row.slug.toLowerCase().includes(query))
      : rows;
  }, [rows, search]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deletePromotionPage(pendingDelete.id);
      setPendingDelete(null);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setPendingDelete(null);
      setDeleteError(getErrorMessage(err, 'ลบไม่สำเร็จ'));
    } finally {
      setDeleting(false);
    }
  };

  const columns: TableColumn<PromotionPageSummary>[] = [
    {
      key: 'name',
      label: __uiText("ชื่อ"),
      render: (value: string, row) => (
        <Link to={ADMIN_ROUTES.promotionPageEdit(row.id)} className="font-semibold text-blue-600 hover:underline">
          {value}
        </Link>
      ),
    },
    {
      key: 'campaign_id',
      label: __uiText("Campaign"),
      render: (value: string | null) =>
        value && campaignName.has(value) ? (
          <Link to={ADMIN_ROUTES.campaignDetail(value)} className="text-blue-600 hover:underline">
            {campaignName.get(value)}
          </Link>
        ) : (
          '-'
        ),
    },
    {
      key: 'slug',
      label: __uiText("URL"),
      render: (value: string) => (
        <a
          href={toShopUrl(shopPagePath(value))}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
        >
          {toShopPath(shopPagePath(value))}
          <HiOutlineExternalLink size={14} />
        </a>
      ),
    },
    {
      key: 'is_active',
      label: __uiText("สถานะ"),
      render: (value: boolean, row) => (
        <div className="flex flex-col items-start gap-1">
          <ActivePill active={value} />
          <span className="text-xs text-ink-muted">
            {row.start_date || row.end_date
              ? formatBangkokRange(row.start_date, row.end_date, 'th')
              : __uiText("ไม่จำกัดช่วงเวลา")}
          </span>
        </div>
      ),
    },
    {
      key: 'show_on_home',
      label: __uiText("หน้าแรก"),
      render: (value: boolean) => (value ? '✓' : '-'),
    },
    {
      key: 'actions',
      label: __uiText("จัดการ"),
      render: (_value, row) => (
        <div className="flex items-center gap-1">
          <CopyIdButton
            id={row.mobile_deeplink || defaultDeeplink(row.slug)}
            label={__uiText("คัดลอก deeplink {0}", {"0": row.name})}
          />
          <Link
            to={ADMIN_ROUTES.promotionPageEdit(row.id)}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-primary-soft hover:text-primary"
            title={__uiText("แก้ไข")}
            aria-label={__uiText("แก้ไข {0}", {"0": row.name})}
          >
            <AiOutlineEdit size={18} />
          </Link>
          <button
            type="button"
            onClick={() => setPendingDelete(row)}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-alert-soft hover:text-alert"
            title={__uiText("ลบ")}
            aria-label={__uiText("ลบ {0}", {"0": row.name})}
          >
            <AiOutlineDelete size={18} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={__uiText("Promotion Pages")}
        subtitle={__uiText("หน้าของ campaign = แบนเนอร์ + สินค้าของโปรอัตโนมัติ + คูปองสาธารณะของ campaign (และสินค้าที่คูปองจำกัดไว้) — อยู่ที่ {0}", {"0": toShopPath('/promotions/<slug>')})}
        createLabel={__uiText("สร้างหน้าโปรโมชัน")}
        createPath={ADMIN_ROUTES.promotionPageCreate}
      />

      <CouponFormErrorBanner error={deleteError} />

      {loading ? (
        <p className="text-sm text-ink-muted">{__uiText("กำลังโหลด...")}</p>
      ) : loadError ? (
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
      ) : (
        <>
          <div className="rounded-lg bg-white p-3 shadow-level-1">
            <Input
              label={__uiText("ค้นหาชื่อหรือ slug")}
              icon={<AiOutlineSearch size={20} />}
              className="md:w-[296px]"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Table columns={columns} data={visible} idKey="id" />
        </>
      )}

      <CouponConfirmDialog
        open={!!pendingDelete}
        title={__uiText("ลบหน้าโปรโมชันนี้?")}
        body={`“${pendingDelete?.name ?? ''}” — ลิงก์ที่แชร์ไปแล้วจะเปิดไม่ได้ และแบนเนอร์หน้าแรกของหน้านี้จะถูกลบด้วย`}
        confirmLabel="ลบ"
        tone="danger"
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
