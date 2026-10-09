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

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
function PageEditor({
  page,
  campaigns,
}: {
  page: PromotionPageSummary | null;
  campaigns: CampaignListItem[];
}) {
  __useUiLocale();
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
        title={page ? __uiText("แก้ไขหน้าโปรโมชัน") : __uiText("สร้างหน้าโปรโมชัน")}
        subtitle={__uiText("ใส่ภาพแบนเนอร์ แล้วเลือกแคมเปญ สินค้าและคูปองบนหน้านั้นมาจากแคมเปญที่เลือก บันทึกแล้วลูกค้าเห็นได้เลย")}
        saveLabel="บันทึกหน้าโปรโมชัน"
        steps={['ตั้งชื่อหน้า', 'เลือกแคมเปญและภาพ', 'บันทึกหน้าโปรโมชัน']}
        saving={state.saving}
        savedRevision={historyKey}
        wide
        onBack={() =>
          guard.requestLeave(() => navigate(ADMIN_ROUTES.promotionPages))
        }
        onSave={() => state.save()}
      >
        <CouponFormErrorBanner error={state.saveError} />
        {state.saved && (
          <div
            role="status"
            className="rounded-xl border border-green-100 bg-green-50 p-4 text-sm text-green-700"
          >
            {__uiText("บันทึกแล้ว")}</div>
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
  __useUiLocale();
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
    return <div className="cp-management-page text-sm text-ink-muted">{__uiText("กำลังโหลด...")}</div>;
  if (loadError) {
    return (
      <div className="cp-management-page space-y-4">
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
  }
  return <PageEditor page={page} campaigns={campaigns} />;
}

/** `/promotion-pages/create` and `/promotion-pages/:id/edit`. */
export default function PromotionPageEditorPage() {
  const { id } = useParams<{ id: string }>();
  // key: create → edit navigation after a save must not carry the create form's state over.
  return <PageEditorLoader key={id ?? 'new'} id={id} />;
}
