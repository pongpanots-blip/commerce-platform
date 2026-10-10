// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { TableViewport } from '@cp/ui';
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-render-cache-locale: refresh memoized UI labels when the language changes
import { getUiLocale as __getUiLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import {
  createPushCampaign,
  getPushCampaignDelivery,
  getPushCampaignOverview,
  getPushCampaigns,
  getUserSegments,
  getUsers,
  previewPushAudience,
  schedulePushCampaign,
  sendPushCampaign,
  testPushCampaign,
  type PushCampaign,
  type PushCampaignAudience,
  type PushCampaignOverview,
  type UserSegmentListItem,
} from '@josh/shared-api';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import { marketingTestersApi, type MarketingTester } from '../../../../lib/api';
import { useCompanySearch } from '../../components/useCompanySearch';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Tab = 'overview' | 'create' | 'delivery';

type PickedUser = { id: string; label: string };
type PickedCompany = { id: string; label: string };

const emptyAudience = (): PushCampaignAudience => ({
  include: { userIds: [], companyIds: [], segmentIds: [] },
  exclude: { userIds: [], companyIds: [], segmentIds: [] },
});

const statusLabel: Record<PushCampaign['status'], string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const statusClass: Record<PushCampaign['status'], string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-amber-50 text-amber-800',
  sending: 'bg-blue-50 text-blue-700',
  sent: 'bg-emerald-50 text-emerald-800',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

function PhonePreview({ title, body }: { title: string; body: string }) {
  __useUiLocale();
  return (
    <div className="mx-auto w-[220px] rounded-[28px] border-8 border-slate-800 bg-slate-100 p-3 shadow-lg">
      <div className="mx-auto mb-3 h-4 w-16 rounded-full bg-slate-800" />
      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500 text-[10px] font-bold text-white">
            {__uiText("J")}</span>
          <span>{__uiText("Josh")}</span>
          <span className="ml-auto">{__uiText("now")}</span>
        </div>
        <p className="mt-2 text-xs font-semibold text-slate-900">
          {title || __uiText("Title")}
        </p>
        <p className="mt-1 text-[11px] text-slate-600">{body || __uiText("Message")}</p>
      </div>
    </div>
  );
}

export default function PushCampaignsPage() {
  __useUiLocale();
  const [tab, setTab] = useState<Tab>('overview');
  const [campaigns, setCampaigns] = useState<PushCampaign[]>([]);
  const [overview, setOverview] = useState<PushCampaignOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create form
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [deepLinkWeb, setDeepLinkWeb] = useState('');
  const [differentWebUrl, setDifferentWebUrl] = useState(false);
  const [abEnabled, setAbEnabled] = useState(false);
  const [titleB, setTitleB] = useState('');
  const [bodyB, setBodyB] = useState('');
  const [audience, setAudience] = useState<PushCampaignAudience>(emptyAudience);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [testUserId, setTestUserId] = useState('');
  // Real test sends only reach commerce's tester list (managed under ข้อความอัตโนมัติ › Tester).
  const [testers, setTesters] = useState<MarketingTester[]>([]);
  useEffect(() => { marketingTestersApi.list().then(setTesters, () => setTesters([])); }, []);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // pickers
  const [segments, setSegments] = useState<UserSegmentListItem[]>([]);
  const [userQuery, setUserQuery] = useState('');
  const [userHits, setUserHits] = useState<PickedUser[]>([]);
  const [companyQuery, setCompanyQuery] = useState('');
  const { hits: companySearchHits } = useCompanySearch(companyQuery);
  const companyHits: PickedCompany[] = companySearchHits.map((c) => ({ id: c.id, label: c.name }));
  const [pickedUsers, setPickedUsers] = useState<PickedUser[]>([]);
  const [pickedCompanies, setPickedCompanies] = useState<PickedCompany[]>([]);

  // delivery
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Awaited<
    ReturnType<typeof getPushCampaignDelivery>
  > | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, kpi] = await Promise.all([
        getPushCampaigns(),
        getPushCampaignOverview(),
      ]);
      setCampaigns(rows);
      setOverview(kpi);
    } catch {
      setError(__uiMessage("โหลดรายการแคมเปญไม่สำเร็จ"));
      setCampaigns([]);
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    getUserSegments()
      .then(setSegments)
      .catch(() => setSegments([]));
  }, [loadOverview]);

  useEffect(() => {
    if (!userQuery.trim()) {
      setUserHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      getUsers({ search: userQuery.trim(), limit: 8, page: 1 })
        .then((res) => {
          const rows = (res?.data?.data ?? res?.data ?? []) as Array<{
            id: string;
            first_name?: string;
            last_name?: string;
            email?: string;
          }>;
          setUserHits(
            (Array.isArray(rows) ? rows : []).map((u) => ({
              id: u.id,
              label: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email || u.id,
            })),
          );
        })
        .catch(() => setUserHits([]));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [userQuery]);

  const syncAudienceUsersCompanies = useCallback(
    (nextUsers: PickedUser[], nextCompanies: PickedCompany[], segmentIds: string[]) => {
      setAudience((prev) => ({
        ...prev,
        include: {
          userIds: nextUsers.map((u) => u.id),
          companyIds: nextCompanies.map((c) => c.id),
          segmentIds,
        },
      }));
    },
    [],
  );

  const selectedSegmentIds = audience.include.segmentIds ?? [];

  const refreshEstimate = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await previewPushAudience(audience);
      setEstimate(result.uniqueUsers);
    } catch {
      setError(__uiMessage("ประมาณจำนวนผู้รับไม่สำเร็จ"));
      setEstimate(null);
    } finally {
      setBusy(false);
    }
  };

  const buildPayload = () => ({
    name: name.trim() || title.trim() || 'Untitled campaign',
    title: title.trim(),
    body: body.trim(),
    title_en: titleEn.trim() || null,
    body_en: bodyEn.trim() || null,
    image_url: imageUrl.trim() || null,
    deep_link: deepLink.trim() || null,
    deep_link_web: differentWebUrl ? deepLinkWeb.trim() || null : null,
    audience,
    ab_enabled: abEnabled,
    ab_variant_b: abEnabled
      ? { title: titleB.trim(), body: bodyB.trim() }
      : null,
  });

  const handleSaveDraft = async () => {
    if (!title.trim() || !body.trim()) {
      setError(__uiMessage("ต้องมี Title และ Message"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createPushCampaign(buildPayload());
      setCreatedId(created.id);
      await loadOverview();
      setError(null);
    } catch {
      setError(__uiMessage("บันทึกแคมเปญไม่สำเร็จ — ตรวจ audience และข้อความ"));
    } finally {
      setBusy(false);
    }
  };

  const ensureSaved = async (): Promise<string | null> => {
    if (createdId) return createdId;
    if (!title.trim() || !body.trim()) {
      setError(__uiMessage("ต้องมี Title และ Message ก่อนส่ง"));
      return null;
    }
    const created = await createPushCampaign(buildPayload());
    setCreatedId(created.id);
    return created.id;
  };

  const handleSendNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await ensureSaved();
      if (!id) return;
      const sent = await sendPushCampaign(id);
      setDeliveryId(sent.id);
      setTab('delivery');
      await openDelivery(sent.id);
      await loadOverview();
    } catch {
      setError(__uiMessage("ส่งไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  const handleSchedule = async () => {
    if (!scheduledAt) {
      setError(__uiMessage("เลือกเวลาก่อนตั้ง Schedule"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await ensureSaved();
      if (!id) return;
      await schedulePushCampaign(id, new Date(scheduledAt).toISOString());
      await loadOverview();
      setTab('overview');
    } catch {
      setError(__uiMessage("ตั้งเวลาส่งไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    if (!testUserId.trim()) {
      setError(__uiMessage("เลือก tester ที่จะส่งทดสอบ"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await ensureSaved();
      if (!id) return;
      await testPushCampaign(id, testUserId.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : __uiMessage("ส่งทดสอบไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  const openDelivery = async (id: string) => {
    setDeliveryId(id);
    setBusy(true);
    try {
      const data = await getPushCampaignDelivery(id);
      setDelivery(data);
    } catch {
      setDelivery(null);
      setError(__uiMessage("โหลด delivery ไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  const tabs = useMemo(
    () =>
      [
        { key: 'overview' as const, label: __uiText("Overview") },
        { key: 'create' as const, label: __uiText("Create Notification") },
        { key: 'delivery' as const, label: __uiText("Delivery") },
      ] as const,
    [__getUiLocale()],
  );

  return (
    <div className="cp-management-page">
      <AdminListHeader
        title={__uiText("Push Campaigns")}
        subtitle={__uiText("Compose · Audience · Schedule/Send — ส่งผ่าน OneSignal ของ Josh")}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rounded-lg px-3 py-2 text-sm ${
              tab === item.key
                ? 'bg-slate-900 text-white'
                : 'border border-gray-200 bg-white text-gray-700'
            }`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{(typeof error === 'string' ? __uiText(error) : error)}</p>}

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label={__uiText("Campaigns")} value={overview?.campaigns ?? '—'} />
            <Kpi label={__uiText("Scheduled")} value={overview?.scheduled ?? '—'} />
            <Kpi label={__uiText("Sent today")} value={overview?.sentToday ?? '—'} />
            <Kpi
              label={__uiText("CTR (all)")}
              value={
                overview
                  ? `${(overview.clickRate * 100).toFixed(1)}%`
                  : '—'
              }
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">{__uiText("Recent campaigns")}</h2>
              <button
                type="button"
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white"
                onClick={() => {
                  setCreatedId(null);
                  setTab('create');
                }}
              >
                {__uiText("+ New Notification")}</button>
            </div>
            {loading ? (
              <p className="p-4 text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
            ) : campaigns.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">{__uiText("ยังไม่มีแคมเปญ")}</p>
            ) : (
              <TableViewport><table className="cp-data-table w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2" scope="col">{__uiText("Notification")}</th>
                    <th className="px-4 py-2" scope="col">{__uiText("Audience")}</th>
                    <th className="px-4 py-2" scope="col">{__uiText("Sent")}</th>
                    <th className="px-4 py-2" scope="col">{__uiText("Status")}</th>
                    <th className="px-4 py-2" scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((row) => (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{row.name}</div>
                        <div className="text-xs text-gray-500">{row.title}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {row.stats?.queued || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {row.sent_at
                          ? new Date(row.sent_at).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))
                          : row.scheduled_at
                            ? new Date(row.scheduled_at).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))
                            : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass[row.status]}`}
                        >
                          {statusLabel[row.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="text-xs text-indigo-600 hover:underline"
                          onClick={() => {
                            setTab('delivery');
                            void openDelivery(row.id);
                          }}
                        >
                          {__uiText("Delivery")}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></TableViewport>
            )}
          </div>
        </div>
      )}

      {tab === 'create' && (
        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <section className="rounded-xl border border-gray-100 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-800">{__uiText("1. Audience")}</h2>
              <p className="mb-3 text-xs text-gray-500">
                {__uiText("Include = users ∪ ร้าน(company) ∪ segments · Exclude ตัดออกก่อนส่ง")}</p>

              <label className="mb-1 block text-xs text-gray-500">{__uiText("ค้นหา Users")}</label>
              <input
                className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder={__uiText("ชื่อ / อีเมล")}
              />
              {userHits.length > 0 && (
                <div className="mb-2 space-y-1">
                  {userHits.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      className="block w-full rounded-lg border border-gray-100 px-3 py-1.5 text-left text-xs hover:bg-gray-50"
                      onClick={() => {
                        if (pickedUsers.some((u) => u.id === hit.id)) return;
                        const next = [...pickedUsers, hit];
                        setPickedUsers(next);
                        syncAudienceUsersCompanies(next, pickedCompanies, selectedSegmentIds);
                      }}
                    >
                      + {hit.label}
                    </button>
                  ))}
                </div>
              )}
              <ChipRow
                items={pickedUsers}
                onRemove={(id) => {
                  const next = pickedUsers.filter((u) => u.id !== id);
                  setPickedUsers(next);
                  syncAudienceUsersCompanies(next, pickedCompanies, selectedSegmentIds);
                }}
              />

              <label className="mb-1 mt-3 block text-xs text-gray-500">{__uiText("ค้นหาร้าน / Company")}</label>
              <input
                className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={companyQuery}
                onChange={(e) => setCompanyQuery(e.target.value)}
                placeholder={__uiText("ชื่อร้าน / บริษัท")}
              />
              {companyHits.length > 0 && (
                <div className="mb-2 space-y-1">
                  {companyHits.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      className="block w-full rounded-lg border border-gray-100 px-3 py-1.5 text-left text-xs hover:bg-gray-50"
                      onClick={() => {
                        if (pickedCompanies.some((c) => c.id === hit.id)) return;
                        const next = [...pickedCompanies, hit];
                        setPickedCompanies(next);
                        syncAudienceUsersCompanies(pickedUsers, next, selectedSegmentIds);
                      }}
                    >
                      + {hit.label}
                    </button>
                  ))}
                </div>
              )}
              <ChipRow
                items={pickedCompanies}
                onRemove={(id) => {
                  const next = pickedCompanies.filter((c) => c.id !== id);
                  setPickedCompanies(next);
                  syncAudienceUsersCompanies(pickedUsers, next, selectedSegmentIds);
                }}
              />

              <label className="mb-1 mt-3 block text-xs text-gray-500">{__uiText("Segments")}</label>
              <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-gray-100 p-2">
                {segments.length === 0 ? (
                  <p className="text-xs text-gray-400">{__uiText("ยังไม่มี segment")}</p>
                ) : (
                  segments.map((seg) => {
                    const checked = selectedSegmentIds.includes(seg.id);
                    return (
                      <label
                        key={seg.id}
                        className="flex items-center gap-2 text-xs text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? selectedSegmentIds.filter((id) => id !== seg.id)
                              : [...selectedSegmentIds, seg.id];
                            syncAudienceUsersCompanies(pickedUsers, pickedCompanies, next);
                          }}
                        />
                        {seg.name}
                      </label>
                    );
                  })
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => void refreshEstimate()}
                >
                  {__uiText("Preview audience")}</button>
                {estimate != null && (
                  <span className="text-sm font-semibold text-gray-800">
                    ≈ {estimate.toLocaleString()} {__uiText(" users")}</span>
                )}
              </div>

              <label className="mb-1 mt-4 block text-xs text-gray-500">
                {__uiText("Exclude segments (optional)")}</label>
              <div className="max-h-28 space-y-1 overflow-auto rounded-lg border border-gray-100 p-2">
                {segments.map((seg) => {
                  const excludeIds = audience.exclude?.segmentIds ?? [];
                  const checked = excludeIds.includes(seg.id);
                  return (
                    <label
                      key={`ex-${seg.id}`}
                      className="flex items-center gap-2 text-xs text-gray-700"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? excludeIds.filter((id) => id !== seg.id)
                            : [...excludeIds, seg.id];
                          setAudience((prev) => ({
                            ...prev,
                            exclude: {
                              ...(prev.exclude ?? {}),
                              segmentIds: next,
                            },
                          }));
                        }}
                      />
                      {seg.name}
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-gray-100 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-800">{__uiText("2. Message")}</h2>
              <Field label={__uiText("Campaign name")}>
                <input
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={__uiText("Flash Sale — Thailand")}
                />
              </Field>
              <Field label={__uiText("Title *")}>
                <input
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={__uiText("Title (TH)")}
                />
              </Field>
              <Field label={__uiText("Message *")}>
                <textarea
                  className="min-h-[80px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={__uiText("Message (TH)")}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={__uiText("Title EN")}>
                  <input
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    value={titleEn}
                    onChange={(e) => setTitleEn(e.target.value)}
                  />
                </Field>
                <Field label={__uiText("Message EN")}>
                  <textarea
                    className="min-h-[60px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    value={bodyEn}
                    onChange={(e) => setBodyEn(e.target.value)}
                  />
                </Field>
              </div>
              <Field label={__uiText("Image URL")}>
                <input
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://..."
                />
              </Field>
              <Field label={__uiText("Launch URL / deep link")}>
                <input
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  value={deepLink}
                  onChange={(e) => setDeepLink(e.target.value)}
                  placeholder="/cart หรือ myapp://..."
                />
              </Field>
              <label className="mb-2 flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={differentWebUrl}
                  onChange={(e) => setDifferentWebUrl(e.target.checked)}
                />
                {__uiText("Different URL for web")}</label>
              {differentWebUrl && (
                <Field label={__uiText("Web URL")}>
                  <input
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    value={deepLinkWeb}
                    onChange={(e) => setDeepLinkWeb(e.target.value)}
                  />
                </Field>
              )}

              <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={abEnabled}
                  onChange={(e) => setAbEnabled(e.target.checked)}
                />
                {__uiText("A/B Test (variant B 50%)")}</label>
              {abEnabled && (
                <div className="mt-2 space-y-2 rounded-lg border border-dashed border-gray-200 p-3">
                  <Field label={__uiText("Title B")}>
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={titleB}
                      onChange={(e) => setTitleB(e.target.value)}
                    />
                  </Field>
                  <Field label={__uiText("Message B")}>
                    <textarea
                      className="min-h-[60px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={bodyB}
                      onChange={(e) => setBodyB(e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-gray-100 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-800">{__uiText("3. Delivery")}</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  onClick={() => void handleSaveDraft()}
                >
                  {__uiText("Save draft")}</button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
                  onClick={() => void handleSendNow()}
                >
                  {__uiText("Send now")}</button>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">{__uiText("Schedule")}</label>
                  <input
                    type="datetime-local"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  onClick={() => void handleSchedule()}
                >
                  {__uiText("Schedule")}</button>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <label className="mb-1 block text-xs text-gray-500">
                    {__uiText("ส่งทดสอบถึง tester")}</label>
                  <select
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    value={testUserId}
                    onChange={(e) => setTestUserId(e.target.value)}
                  >
                    <option value="">{testers.length ? __uiText("เลือก tester") : __uiText("ยังไม่มี tester — เพิ่มที่ ข้อความอัตโนมัติ")}</option>
                    {testers.map((t) => <option key={t.userId} value={t.userId}>{t.name ? `${t.name} · ${t.email}` : t.email}</option>)}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  onClick={() => void handleTest()}
                >
                  {__uiText("Test send")}</button>
              </div>
              {createdId && (
                <p className="mt-2 text-xs text-gray-500">{__uiText("Saved campaign: ")}{createdId}</p>
              )}
            </section>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <p className="mb-3 text-xs text-gray-500">{__uiText("Live Preview")}</p>
            <PhonePreview title={title} body={body} />
            {abEnabled && (
              <div className="mt-6">
                <p className="mb-3 text-xs text-gray-500">{__uiText("Variant B")}</p>
                <PhonePreview title={titleB} body={bodyB} />
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'delivery' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={deliveryId ?? ''}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                void openDelivery(id);
              }}
            >
              <option value="">{__uiText("เลือกแคมเปญ")}</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {statusLabel[c.status]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
              onClick={() => deliveryId && void openDelivery(deliveryId)}
            >
              {__uiText("Refresh")}</button>
          </div>

          {!delivery ? (
            <p className="text-sm text-gray-500">{__uiText("เลือกแคมเปญเพื่อดู pipeline")}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Kpi label={__uiText("Queued")} value={delivery.pipeline.queued} />
                <Kpi label={__uiText("Sent")} value={delivery.pipeline.sent} />
                <Kpi label={__uiText("Skipped")} value={delivery.pipeline.skipped} />
                <Kpi label={__uiText("Failed")} value={delivery.pipeline.failed} />
                <Kpi label={__uiText("Clicked")} value={delivery.pipeline.clicked} />
              </div>
              <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
                <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold">
                  {__uiText("Recent deliveries · ")}{delivery.campaign.name}
                </div>
                {delivery.recentDeliveries.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500">{__uiText("ยังไม่มี delivery log")}</p>
                ) : (
                  <TableViewport><table className="cp-data-table w-full text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="px-4 py-2" scope="col">{__uiText("User")}</th>
                        <th className="px-4 py-2" scope="col">{__uiText("Channel")}</th>
                        <th className="px-4 py-2" scope="col">{__uiText("Status")}</th>
                        <th className="px-4 py-2" scope="col">{__uiText("Reason")}</th>
                        <th className="px-4 py-2" scope="col">{__uiText("Sent")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {delivery.recentDeliveries.map((row) => (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="px-4 py-2 font-mono text-xs">{row.userId}</td>
                          <td className="px-4 py-2">{row.channel}</td>
                          <td className="px-4 py-2">{row.status}</td>
                          <td className="px-4 py-2 text-xs text-gray-500">
                            {row.reason ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-xs">
                            {new Date(row.sentAt).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table></TableViewport>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      {children}
    </div>
  );
}

function ChipRow({
  items,
  onRemove,
}: {
  items: Array<{ id: string; label: string }>;
  onRemove: (id: string) => void;
}) {
  __useUiLocale();
  if (items.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700"
          onClick={() => onRemove(item.id)}
          title={__uiText("ลบ")}
        >
          {item.label} ×
        </button>
      ))}
    </div>
  );
}
