// ui-metadata-migration: static labels and UI notices only
import {
  deleteCampaign,
  getCampaign,
  updateCampaign,
  type CampaignDetail as CampaignDetailData,
} from '@josh/shared-api';
import {
  Button,
  DateTimeRangeInput,
  Input,
  Table,
  TableColumn,
} from '@josh/shared-ui-web';
import { useEffect, useId, useRef, useState } from 'react';
import { AiOutlineEdit, AiOutlinePlus } from 'react-icons/ai';
import { useNavigate, useParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import CouponConfirmDialog from '../coupon/CouponConfirmDialog';
import { Section } from '../coupon/CouponCoreForm';
import { CouponFormErrorBanner } from '../coupon/CouponFormSections';
import {
  CampaignStatusPill,
  EditHistorySection,
  getErrorMessage,
} from '../promotion-common';
import {
  ActivePill,
  SwitchField,
} from '../promotion-page/PromotionPageControls';
import {
  GuardedLink,
  LeaveGuardContext,
  useUnsavedChangesGuard,
} from '../promotion-page/useUnsavedChangesGuard';
import CampaignCouponsSection from './CampaignCouponsSection';
import CampaignPageSection from './CampaignPageSection';
import {
  addMechanicPath,
  buildUpdateCampaignPayload,
  emptyCampaignForm,
  formFromCampaign,
  validateCampaignForm,
  type CampaignForm,
  type CampaignFormErrors,
} from './campaign.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Mechanic = CampaignDetailData['mechanics'][number];

/**
 * The hub of one campaign: info + dates, automatic promotions, coupons, and the page. The
 * header "บันทึก" saves the info section; coupons attach/detach immediately and the page
 * has its own save button — each is a separate API call.
 */
function CampaignHub({ id }: { id: string }) {
  __useUiLocale();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CampaignDetailData | null>(null);
  // `baseline` = what the server last returned, so the PATCH can send only what changed.
  const [form, setForm] = useState<CampaignForm>(emptyCampaignForm);
  const [baseline, setBaseline] = useState<CampaignForm>(emptyCampaignForm);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [errors, setErrors] = useState<CampaignFormErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pageDirty, setPageDirty] = useState(false);
  // Every read/write that replaces `detail` takes a ticket; a slower, older response is dropped
  // instead of overwriting a newer one (e.g. a refresh after a page save vs. a coupon PUT).
  const latestDetail = useRef(0);
  const dateLabelId = useId();
  const datesErrorId = useId();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ticket = ++latestDetail.current;
        const data = await getCampaign(id);
        if (cancelled || ticket !== latestDetail.current) return;
        setDetail(data);
        setForm(formFromCampaign(data));
        setBaseline(formFromCampaign(data));
        setLoadError('');
      } catch (err) {
        if (!cancelled)
          setLoadError(getErrorMessage(err, 'โหลด Campaign ไม่สำเร็จ'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const patch = (partial: Partial<CampaignForm>) => {
    setSaved(false);
    setForm((current) => ({ ...current, ...partial }));
  };

  // A server response that is the newest state — invalidates any read still in flight.
  const applyDetail = (next: CampaignDetailData) => {
    latestDetail.current += 1;
    setDetail(next);
  };

  // Re-read after the page section changed something — leaves the info form (maybe mid-edit) alone.
  const refresh = () => {
    const ticket = ++latestDetail.current;
    getCampaign(id)
      .then((next) => {
        if (ticket === latestDetail.current) setDetail(next);
      })
      .catch(() => undefined); // the section that changed already shows its own result
  };

  const handleSave = async () => {
    if (saving) return false;
    const found = validateCampaignForm(form);
    setErrors(found);
    setSaved(false);
    if (Object.keys(found).length > 0) {
      setSaveError(__uiMessage("กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง — ตรวจช่องที่ขึ้นสีแดง"));
      return false;
    }
    setSaveError('');
    setSaving(true);
    try {
      const updated = await updateCampaign(
        id,
        buildUpdateCampaignPayload(form, baseline),
      );
      applyDetail(updated);
      setForm(formFromCampaign(updated));
      setBaseline(formFromCampaign(updated));
      setSaved(true);
      return true;
    } catch (err) {
      setSaveError(getErrorMessage(err, 'บันทึกไม่สำเร็จ'));
      return false;
    } finally {
      setSaving(false);
    }
    return false;
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteCampaign(id);
      navigate(ADMIN_ROUTES.campaigns);
    } catch (err) {
      // 409 while it still has mechanics — the server message says to remove them first.
      setConfirmDelete(false);
      setSaveError(getErrorMessage(err, 'ลบ Campaign ไม่สำเร็จ'));
      setDeleting(false);
    }
  };

  const infoDirty = (Object.keys(baseline) as Array<keyof CampaignForm>).some(
    (key) => form[key] !== baseline[key],
  );
  const guard = useUnsavedChangesGuard(infoDirty || pageDirty);

  if (loading)
    return <div className="cp-management-page text-sm text-ink-muted">{__uiText("กำลังโหลด...")}</div>;
  if (loadError || !detail) {
    return (
      <div className="cp-management-page space-y-4">
        <CouponFormErrorBanner error={loadError || __uiText("ไม่พบ Campaign")} />
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
  }

  const mechanicColumns: TableColumn<Mechanic>[] = [
    {
      key: 'name',
      label: __uiText("ชื่อโปร"),
      render: (value: string, row) => (
        <GuardedLink
          to={ADMIN_ROUTES.promotionsMechanicEdit(row.id)}
          className="font-semibold text-blue-600 hover:underline"
        >
          {value}
        </GuardedLink>
      ),
    },
    {
      key: 'is_active',
      label: __uiText("สถานะ"),
      render: (value: boolean) => <ActivePill active={value} />,
    },
    {
      key: 'sku_count',
      label: __uiText("จำนวน SKU"),
      render: (value: number) => value.toLocaleString('th-TH'),
    },
    {
      key: 'actions',
      label: __uiText("จัดการ"),
      render: (_value, row) => (
        <GuardedLink
          to={ADMIN_ROUTES.promotionsMechanicEdit(row.id)}
          className="inline-flex rounded-lg p-1.5 text-ink-muted hover:bg-primary-soft hover:text-primary"
          title={__uiText("แก้ไข")}
          aria-label={__uiText("แก้ไข {0}", {"0": row.name})}
        >
          <AiOutlineEdit size={18} />
        </GuardedLink>
      ),
    },
  ];

  return (
    <LeaveGuardContext.Provider value={guard.context}>
      <AdminInsertLayout
        title={detail.name}
        subtitle={__uiText("ปุ่มบันทึกด้านบนบันทึกเฉพาะข้อมูล Campaign — คูปองบันทึกทันทีที่เพิ่ม/ถอด และหน้าโปรมีปุ่มบันทึกของตัวเอง")}
        saving={saving}
        saveLabel={__uiText("บันทึกข้อมูล Campaign")}
        onBack={() =>
          guard.requestLeave(() => navigate(ADMIN_ROUTES.campaigns))
        }
        wide
        headerActions={<CampaignStatusPill status={detail.status} />}
        onSave={() => handleSave()}
      >
        <Section title={__uiText("ข้อมูล Campaign")}>
          <CouponFormErrorBanner error={saveError} />
          {saved && (
            <div
              role="status"
              className="rounded-xl border border-green-100 bg-green-50 p-4 text-sm text-green-700"
            >
              {__uiText("บันทึกแล้ว")}</div>
          )}
          <Input
            label={__uiText("ชื่อ Campaign")}
            required
            value={form.name}
            error={errors.name}
            aria-invalid={!!errors.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
          <div
            role="group"
            aria-labelledby={dateLabelId}
            aria-describedby={errors.dates ? datesErrorId : undefined}
          >
            <p id={dateLabelId} className="mb-1 text-sm text-ink-secondary">
              {__uiText("ระยะเวลา")}<span className="text-alert"> *</span>
            </p>
            <DateTimeRangeInput
              startValue={form.startAt}
              endValue={form.endAt}
              onStartChange={(value) => patch({ startAt: value })}
              onEndChange={(value) => patch({ endAt: value })}
            />
            {errors.dates && (
              <p id={datesErrorId} className="mt-1 text-sm text-alert">
                {(typeof (errors.dates) === 'string' ? __uiText(errors.dates) : errors.dates)}
              </p>
            )}
            <p className="mt-1 text-xs text-ink-muted">
              {__uiText("แก้วันที่แล้วบันทึก = ระบบเขียนวันที่ใหม่ทับทุกโปร หน้าโปร และแบนเนอร์ใน Campaign นี้")}</p>
          </div>
          <SwitchField
            label={__uiText("เปิดใช้งาน Campaign")}
            description={__uiText("ปิด = สถานะรวมของ Campaign เป็น “ปิดใช้งาน” — ไม่ได้ปิดโปร หน้าโปร หรือคูปองทีละตัว (ปิดได้ที่หน้าของแต่ละอัน)")}
            checked={form.isActive}
            onChange={(checked) => patch({ isActive: checked })}
          />
          <div>
            <Button
              variant="secondaryAlert"
              text={__uiText("ลบ Campaign")}
              onClick={() => setConfirmDelete(true)}
            />
          </div>
        </Section>

        <Section
          title={__uiText("โปรอัตโนมัติ (Promotion mechanics)")}
          description={__uiText("ส่วนลดระดับสินค้า — ใช้วันที่ของ Campaign และ SKU จาก Product set")}
        >
          <div>
            <GuardedLink
              to={addMechanicPath(detail.id)}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-dark"
            >
              <AiOutlinePlus size={20} />
              {__uiText("เพิ่มโปร")}</GuardedLink>
          </div>
          <Table columns={mechanicColumns} data={detail.mechanics} idKey="id" />
        </Section>

        <CampaignCouponsSection campaign={detail} onChange={applyDetail} />

        <CampaignPageSection
          campaign={detail}
          onChanged={refresh}
          onDirtyChange={setPageDirty}
        />

        <EditHistorySection
          entityType="campaign"
          entityId={detail.id}
          refreshKey={detail}
          names={Object.fromEntries([
            ...detail.coupons.map((coupon) => [coupon.id, coupon.title]),
            ...detail.mechanics.map((mechanic) => [mechanic.id, mechanic.name]),
          ])}
        />

        {guard.dialog}

        <CouponConfirmDialog
          open={confirmDelete}
          title={__uiText("ลบ Campaign นี้?")}
          body={`“${detail.name}” — หน้าโปร แบนเนอร์ และคูปองที่ผูกอยู่จะคงอยู่แต่หลุดจาก Campaign (ลบไม่ได้ถ้ายังมีโปรอัตโนมัติ)`}
          confirmLabel="ลบ"
          tone="danger"
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void handleDelete()}
        />
      </AdminInsertLayout>
    </LeaveGuardContext.Provider>
  );
}

/** `/promotions/campaigns/:id`. */
export default function CampaignDetail() {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  // key: moving between two campaigns must not show the first one's form.
  return id ? <CampaignHub key={id} id={id} /> : null;
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
