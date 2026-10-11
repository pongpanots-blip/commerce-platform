// ui-metadata-migration: static labels and UI notices only
import {
  formatBangkokRange,
  listCampaigns,
  listPromotionPages,
  type CampaignListItem,
} from '@josh/shared-api';
import { Button, Input, Table, TableColumn } from '@josh/shared-ui-web';
import { useEffect, useMemo, useState } from 'react';
import { AiOutlineEdit, AiOutlineSearch } from 'react-icons/ai';
import { HiOutlineExternalLink } from 'react-icons/hi';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import CopyIdButton from '../../components/CopyIdButton';
import { toShopPath, toShopUrl } from '../../config/admin-base-path';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { CouponFormErrorBanner } from '../coupon/CouponFormSections';
import { defaultDeeplink, shopPagePath } from '../promotion-page/promotion-page-form.helpers';
import { CampaignStatusPill, getErrorMessage } from '../promotion-common';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const CampaignList = () => {
  __useUiLocale();
  const [items, setItems] = useState<CampaignListItem[]>([]);
  // page id → deeplink. The campaign list only carries the slug; an overridden deeplink lives on the page.
  const [deeplinks, setDeeplinks] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [campaigns, pages] = await Promise.all([
          listCampaigns(),
          // Only feeds the copy button — losing it must not hide the campaigns.
          listPromotionPages().catch(() => []),
        ]);
        if (cancelled) return;
        setItems(campaigns);
        setDeeplinks(new Map(pages.map((page) => [page.id, page.mobile_deeplink || defaultDeeplink(page.slug)])));
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

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
  }, [items, search]);

  const columns: TableColumn<CampaignListItem>[] = [
    {
      key: 'name',
      label: __uiText("ชื่อแคมเปญ"),
      render: (value: string, row) => (
        <Link to={ADMIN_ROUTES.campaignDetail(row.id)} className="font-semibold text-blue-600 hover:underline">
          {value}
        </Link>
      ),
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value: CampaignListItem['status']) => <CampaignStatusPill status={value} />,
    },
    {
      key: 'start_at',
      label: __uiText("ช่วงเวลา"),
      className: 'tabular-nums whitespace-nowrap',
      render: (_value, row) => formatBangkokRange(row.start_at, row.end_at, 'th'),
    },
    {
      key: 'mechanic_count',
      label: __uiText("โปรโมชัน"),
      align: 'right',
      className: 'tabular-nums whitespace-nowrap',
      render: (_value, row) => (
        <div>
          <span>{(row.mechanic_count + row.coupon_count).toLocaleString('th-TH')}</span>
          <span className="ml-1 text-xs text-ink-muted">
            {__uiText("(โปรอัตโนมัติ ")}{row.mechanic_count} {__uiText(" · คูปอง ")}{row.coupon_count})
          </span>
        </div>
      ),
    },
    {
      key: 'page',
      label: __uiText("หน้าโปร"),
      render: (page: CampaignListItem['page']) =>
        page ? (
          <div className="flex items-center gap-1">
            <a
              href={toShopUrl(shopPagePath(page.slug))}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
            >
              {toShopPath(shopPagePath(page.slug))}
              <HiOutlineExternalLink size={14} />
            </a>
            {deeplinks.has(page.id) && (
              <CopyIdButton id={deeplinks.get(page.id) as string} label={__uiText("คัดลอก deeplink {0}", {"0": page.slug})} />
            )}
          </div>
        ) : (
          '-'
        ),
    },
    {
      key: 'actions',
      label: __uiText("จัดการ"),
      render: (_value, row) => (
        <Link
          to={ADMIN_ROUTES.campaignDetail(row.id)}
          className="inline-flex rounded-lg p-1.5 text-ink-muted hover:bg-primary-soft hover:text-primary"
          title={__uiText("แก้ไข")}
          aria-label={__uiText("แก้ไข {0}", {"0": row.name})}
        >
          <AiOutlineEdit size={18} />
        </Link>
      ),
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={__uiText("แคมเปญโปรโมชัน")}
        subtitle={__uiText("รวมโปรอัตโนมัติ คูปอง และหน้าโปรของงานเดียวกันไว้ที่เดียว วันเริ่มและวันจบตั้งที่แคมเปญ")}
        createLabel={__uiText("เพิ่มแคมเปญ")}
        createPath={ADMIN_ROUTES.campaignCreate}
      />

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
              label={__uiText("ค้นหาชื่อแคมเปญ")}
              icon={<AiOutlineSearch size={20} />}
              className="md:w-[296px]"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Table
            columns={columns}
            data={visible}
            idKey="id"
            emptyTitle={search.trim() ? __uiText("ไม่พบแคมเปญที่ตรงกับคำค้น") : __uiText("ยังไม่มีแคมเปญ")}
            emptyDescription={search.trim() ? __uiText("ลองค้นด้วยชื่ออื่น") : __uiText("กด \"เพิ่มแคมเปญ\" เพื่อเริ่มแคมเปญแรก")}
          />
        </>
      )}
    </div>
  );
};

export default CampaignList;
