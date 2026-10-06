import {
  getPromotionPage,
  listCampaigns,
  type CampaignListItem,
  type PromotionPageSummary,
} from '@josh/shared-api';
import { Button } from '@josh/shared-ui-web';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { CouponFormErrorBanner } from '../coupon/CouponFormSections';
import { EditHistorySection, getErrorMessage } from '../promotion-common';
import { PageFormFields, usePageForm } from './PageForm';
import {
  LeaveGuardContext,
  useUnsavedChangesGuard,
} from './useUnsavedChangesGuard';

function PageEditor({
  page,
  campaigns,
}: {
  page: PromotionPageSummary | null;
  campaigns: CampaignListItem[];
}) {
  const navigate = useNavigate();
  // Bumped on every save so an open History section refetches.
  const [historyKey, setHistoryKey] = useState(0);
  const state = usePageForm({
    page,
    // Created → straight to its edit page (same as the mechanic editor).
    onSaved: (saved) => {
      setHistoryKey((key) => key + 1);
      if (!page) navigate(ADMIN_ROUTES.promotionPageEdit(saved.id));
    },
  });

  const guard = useUnsavedChangesGuard(state.dirty);

  return (
    <LeaveGuardContext.Provider value={guard.context}>
      <AdminInsertLayout
        title={page ? 'แก้ไขหน้าโปรโมชัน' : 'สร้างหน้าโปรโมชัน'}
        subtitle="แบนเนอร์ + สินค้าของโปรอัตโนมัติ + คูปองสาธารณะของ campaign (และสินค้าที่คูปองจำกัดไว้) — ไม่มีขั้นตอน publish"
        saving={state.saving}
        wide
        onBack={() =>
          guard.requestLeave(() => navigate(ADMIN_ROUTES.promotionPages))
        }
        onSave={() => void state.save()}
      >
        <CouponFormErrorBanner error={state.saveError} />
        {state.saved && (
          <div
            role="status"
            className="rounded-xl border border-green-100 bg-green-50 p-4 text-sm text-green-700"
          >
            บันทึกแล้ว
          </div>
        )}
        <PageFormFields state={state} campaigns={campaigns} />
        {page && (
          <EditHistorySection
            entityType="promotion_page"
            entityId={page.id}
            refreshKey={historyKey}
            names={Object.fromEntries(campaigns.map((item) => [item.id, item.name]))}
          />
        )}
        {guard.dialog}
      </AdminInsertLayout>
    </LeaveGuardContext.Provider>
  );
}

function PageEditorLoader({ id }: { id?: string }) {
  const [page, setPage] = useState<PromotionPageSummary | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [campaignList, row] = await Promise.all([
          listCampaigns(),
          id ? getPromotionPage(id) : null,
        ]);
        if (cancelled) return;
        setCampaigns(campaignList);
        setPage(row);
        setLoadError('');
      } catch (err) {
        if (!cancelled)
          setLoadError(getErrorMessage(err, 'โหลดข้อมูลไม่สำเร็จ'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  if (loading)
    return <div className="p-6 text-sm text-ink-muted">กำลังโหลด...</div>;
  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl p-6">
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
    );
  }
  return <PageEditor page={page} campaigns={campaigns} />;
}

/** `/promotion-pages/create` and `/promotion-pages/:id/edit`. */
export default function PromotionPageEditorPage() {
  const { id } = useParams<{ id: string }>();
  // key: create → edit navigation after a save must not carry the create form's state over.
  return <PageEditorLoader key={id ?? 'new'} id={id} />;
}
