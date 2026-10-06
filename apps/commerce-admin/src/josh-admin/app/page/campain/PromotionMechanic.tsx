import {
  deletePromotionMechanic,
  formatBangkokRange,
  listCampaigns,
  listPromotionMechanicAudiences,
  listPromotionMechanicCaps,
  listPromotionMechanics,
  type CampaignListItem,
  type PromotionMechanicAudienceSummary,
  type PromotionMechanicCap,
  type PromotionMechanicRecord,
} from '@josh/shared-api';
import { Button, Input, Table, TableColumn } from '@josh/shared-ui-web';
import { useEffect, useMemo, useState } from 'react';
import { AiOutlineDelete, AiOutlineEdit, AiOutlineSearch } from 'react-icons/ai';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import CouponConfirmDialog from '../coupon/CouponConfirmDialog';
import { CouponFormErrorBanner } from '../coupon/CouponFormSections';
import { CampaignStatusPill, getErrorMessage } from '../promotion-common';
import { summarizeMechanicRow } from './promotion-mechanic-form.helpers';

const PromotionMechanic = () => {
  const [items, setItems] = useState<PromotionMechanicRecord[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  // admin-only flash-sale caps (own guarded endpoint) keyed by mechanic id — no row = no cap
  const [caps, setCaps] = useState<Map<string, PromotionMechanicCap>>(new Map());
  // admin-only audiences (own guarded endpoint) keyed by mechanic id — no row = everyone
  const [audiences, setAudiences] = useState<Map<string, PromotionMechanicAudienceSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<PromotionMechanicRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [mechanics, campaignList, capList, audienceList] = await Promise.all([
          listPromotionMechanics(),
          listCampaigns(),
          listPromotionMechanicCaps(),
          listPromotionMechanicAudiences(),
        ]);
        if (cancelled) return;
        setItems(mechanics);
        setCampaigns(campaignList);
        setCaps(new Map(capList.map((cap) => [cap.id, cap])));
        setAudiences(new Map(audienceList.map((audience) => [audience.id, audience])));
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

  const campaignName = useMemo(
    () => new Map(campaigns.map((campaign) => [campaign.id, campaign.name])),
    [campaigns],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
  }, [items, search]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deletePromotionMechanic(pendingDelete.id);
      setPendingDelete(null);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setPendingDelete(null);
      setDeleteError(getErrorMessage(err, 'ลบไม่สำเร็จ'));
    } finally {
      setDeleting(false);
    }
  };

  const columns: TableColumn<PromotionMechanicRecord>[] = [
    {
      key: 'name',
      label: 'ชื่อโปร',
      render: (value: string, row) => (
        <Link
          to={ADMIN_ROUTES.promotionsMechanicEdit(row.id)}
          className="font-semibold text-blue-600 hover:underline"
        >
          {value}
        </Link>
      ),
    },
    {
      key: 'campaign_id',
      label: 'Campaign',
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
      key: 'audience',
      label: 'กลุ่มลูกค้า',
      // no row = everyone; a targeted mechanic shows how many companies it is for
      render: (_value, row) => {
        const audience = audiences.get(row.id);
        return audience?.audience === 'companies'
          ? `${audience.company_count.toLocaleString('th-TH')} บริษัท`
          : 'ทุกคน';
      },
    },
    {
      key: 'value',
      label: 'ส่วนลด',
      render: (value: PromotionMechanicRecord['value']) => summarizeMechanicRow(value),
    },
    {
      key: 'remaining_units',
      label: 'เหลือ',
      // computed by the server (`remaining_units`) — null / no row = no cap
      render: (_value, row) => {
        const remaining = caps.get(row.id)?.remaining_units;
        if (remaining == null) return '-';
        return remaining === 0 ? (
          <span className="font-medium text-alert">หมดแล้ว</span>
        ) : (
          `${remaining.toLocaleString('th-TH')} ชิ้น`
        );
      },
    },
    {
      key: 'skuItems',
      label: 'จำนวน SKU',
      render: (value: PromotionMechanicRecord['skuItems']) => (value?.length ?? 0).toLocaleString('th-TH'),
    },
    {
      key: 'start_date',
      label: 'ช่วงเวลา',
      render: (_value, row) => formatBangkokRange(row.start_date, row.end_date, 'th'),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (value: PromotionMechanicRecord['status'] | undefined) =>
        value ? <CampaignStatusPill status={value} /> : '-',
    },
    {
      key: 'actions',
      label: 'จัดการ',
      render: (_value, row) => (
        <div className="flex items-center gap-1">
          <Link
            to={ADMIN_ROUTES.promotionsMechanicEdit(row.id)}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-primary-soft hover:text-primary"
            title="แก้ไข"
            aria-label={`แก้ไข ${row.name}`}
          >
            <AiOutlineEdit size={18} />
          </Link>
          <button
            type="button"
            onClick={() => setPendingDelete(row)}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-alert-soft hover:text-alert"
            title="ลบ"
            aria-label={`ลบ ${row.name}`}
          >
            <AiOutlineDelete size={18} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5 p-4">
      <AdminListHeader
        title="Promotion Mechanics"
        subtitle="ส่วนลดระดับสินค้า — SKU มาจาก Product set, วันที่ตาม Campaign"
        createLabel="สร้าง Promotion Mechanic"
        createPath={ADMIN_ROUTES.promotionsMechanicCreate}
      />

      <CouponFormErrorBanner error={deleteError} />

      {loading ? (
        <p className="text-sm text-ink-muted">กำลังโหลด...</p>
      ) : loadError ? (
        <div className="flex flex-col items-start gap-3">
          <CouponFormErrorBanner error={loadError} />
          <Button
            variant="secondary"
            text="ลองใหม่"
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
              label="ค้นหาชื่อโปร"
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
        title="ลบ Promotion Mechanic นี้?"
        body={`“${pendingDelete?.name ?? ''}” — การลบไม่สามารถย้อนกลับได้`}
        confirmLabel="ลบ"
        tone="danger"
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
};

export default PromotionMechanic;
