// ui-metadata-migration: static labels and UI notices only
import {
  getCoupons,
  setCampaignCoupons,
  type CampaignDetail,
} from '@josh/shared-api';
import { Button, Input, Select, Table, TableColumn } from '@josh/shared-ui-web';
import { useEffect, useState } from 'react';
import { AiOutlineMinusCircle, AiOutlineSearch } from 'react-icons/ai';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import CouponConfirmDialog from '../coupon/CouponConfirmDialog';
import { Section } from '../coupon/CouponCoreForm';
import { CouponFormErrorBanner } from '../coupon/CouponFormSections';
import { getErrorMessage } from '../promotion-common';
import { GuardedLink } from '../promotion-page/useUnsavedChangesGuard';
import { couponKindLabel, nextCouponIds } from './campaign.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { Chip, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type AttachedCoupon = CampaignDetail['coupons'][number];
/** Row of `GET /coupon` (the whole entity) — only what the picker reads. */
type CouponRow = {
  id: string;
  coupon_code: string;
  title: string;
  auto_apply?: boolean;
  campaign_id?: string | null;
};

/**
 * Attach / detach coupons. `PUT /campaigns/:id/coupons` replaces the whole set, so every
 * change sends the full id list computed from the campaign as last returned by the server.
 */
export default function CampaignCouponsSection({
  campaign,
  onChange,
}: {
  campaign: CampaignDetail;
  onChange: (next: CampaignDetail) => void;
}) {
  __useUiLocale();
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<CouponRow[]>([]);
  const [searchError, setSearchError] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingDetach, setPendingDetach] = useState<AttachedCoupon | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const response = await getCoupons(1, 30, search.trim());
            const rows: CouponRow[] = Array.isArray(response?.data?.data?.data)
              ? response.data.data.data
              : [];
            if (cancelled) return;
            setFound(rows);
            setSearchError('');
          } catch (err) {
            if (!cancelled)
              setSearchError(getErrorMessage(err, 'ค้นหาคูปองไม่สำเร็จ'));
          }
        })();
      },
      search ? 300 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  const attachedIds = campaign.coupons.map((coupon) => coupon.id);
  const options = found
    .filter((coupon) => !attachedIds.includes(coupon.id))
    .map((coupon) => ({
      value: coupon.id,
      label: `${coupon.coupon_code} — ${coupon.title}${
        coupon.auto_apply ? ' · ใช้อัตโนมัติ' : ''
      }${coupon.campaign_id && coupon.campaign_id !== campaign.id ? ' · อยู่ใน campaign อื่น (จะย้ายมาที่นี่)' : ''}`,
    }));

  const commit = async (ids: string[]) => {
    setBusy(true);
    setError('');
    try {
      onChange(await setCampaignCoupons(campaign.id, ids));
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'บันทึกคูปองไม่สำเร็จ'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const attach = async () => {
    if (pick && (await commit(nextCouponIds(attachedIds, { add: pick }))))
      setPick('');
  };

  const detach = async () => {
    if (!pendingDetach) return;
    await commit(nextCouponIds(attachedIds, { remove: pendingDetach.id }));
    setPendingDetach(null);
  };

  const columns: TableColumn<AttachedCoupon>[] = [
    {
      key: 'coupon_code',
      label: __uiText("รหัสคูปอง"),
      render: (value: string, row) => (
        <GuardedLink
          to={ADMIN_ROUTES.couponDetail(row.id)}
          className="font-mono font-semibold text-blue-600 hover:underline"
        >
          {value}
        </GuardedLink>
      ),
    },
    { key: 'title', label: __uiText("ชื่อ") },
    {
      key: 'auto_apply',
      label: __uiText("ประเภท"),
      render: (_autoApply: boolean, row) => {
        const label = couponKindLabel(row);
        return label === 'ใช้อัตโนมัติ' ? (
          <Chip tone="primary">{label}</Chip>
        ) : (
          label
        );
      },
    },
    {
      key: 'actions',
      label: __uiText("จัดการ"),
      render: (_value, row) => (
        <button
          type="button"
          onClick={() => setPendingDetach(row)}
          className="rounded-lg p-1.5 text-ink-muted hover:bg-alert-soft hover:text-alert"
          title={__uiText("ถอดออกจากแคมเปญ")}
          aria-label={__uiText("ถอด {0}", {"0": row.coupon_code})}
        >
          <AiOutlineMinusCircle size={18} />
        </button>
      ),
    },
  ];

  return (
    <Section
      title={__uiText("คูปอง")}
      description={__uiText("คูปองที่ผูกกับแคมเปญนี้ ถ้าเลือกคูปองที่อยู่ในแคมเปญอื่น คูปองนั้นจะย้ายมาที่นี่")}
    >
      <CouponFormErrorBanner error={error} />
      <Table
        columns={columns}
        data={campaign.coupons}
        idKey="id"
        emptyTitle={__uiText("ยังไม่มีคูปองในแคมเปญนี้")}
        emptyDescription={__uiText("ค้นหาและเลือกคูปองด้านล่าง แล้วกดเพิ่มเข้าแคมเปญ")}
      />

      <div className="flex flex-col gap-3 rounded-lg border-2 border-primary-border p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label={__uiText("ค้นหาคูปอง (รหัสหรือชื่อ)")}
            icon={<AiOutlineSearch size={20} />}
            value={search}
            error={searchError}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            label={__uiText("เลือกคูปอง")}
            data={[
              {
                value: '',
                label: options.length
                  ? '— เลือกคูปอง —'
                  : 'ไม่พบคูปองที่เพิ่มได้',
              },
              ...options,
            ]}
            value={pick}
            onChange={(event) => setPick(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            text={busy ? __uiText("กำลังบันทึก...") : __uiText("เพิ่มคูปองเข้าแคมเปญ")}
            disabled={!pick || busy}
            onClick={() => void attach()}
          />
          <GuardedLink
            to={ADMIN_ROUTES.couponCreate}
            className="inline-flex h-10 items-center rounded-lg bg-primary-soft px-3 text-sm font-semibold text-primary hover:bg-primary-light hover:text-white"
          >
            {__uiText("สร้างคูปองใหม่")}</GuardedLink>
          <span className="text-xs text-ink-muted">
            {__uiText("สร้างเสร็จแล้วกลับมาเพิ่มเข้าแคมเปญที่นี่")}</span>
        </div>
      </div>

      <CouponConfirmDialog
        open={!!pendingDetach}
        title={__uiText("ถอดคูปองออกจากแคมเปญ?")}
        body={__uiText("“{0}” จะยังอยู่ในระบบ แต่ไม่อยู่ในแคมเปญนี้แล้ว", {"0": pendingDetach?.coupon_code ?? ''})}
        confirmLabel="ถอดออก"
        tone="danger"
        busy={busy}
        onCancel={() => setPendingDetach(null)}
        onConfirm={() => void detach()}
      />
    </Section>
  );
}
