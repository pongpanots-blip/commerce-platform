// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid,
} from 'recharts';
import {
  getSmartLinkAnalyticsOverview, getSmartLinkAnalytics, getSmartLink,
  type SmartLinkAnalytics, type AnalyticsRange, type AnalyticsTopN,
} from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { LoadError } from '../../components/LoadError';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: 'today', get label() { return __uiText('Today'); } },
  { value: '7d', get label() { return __uiText('7 Days'); } },
  { value: '30d', get label() { return __uiText('30 Days'); } },
];

const topColumns: TableColumn<AnalyticsTopN>[] = [
  { key: 'key', get label(){return __uiText("Value");} },
  { key: 'count', get label(){return __uiText("Clicks");} },
];

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5">
      <div className="text-xs font-semibold text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function TopCard({ title, rows }: { title: string; rows: AnalyticsTopN[] }) {
  __useUiLocale();
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5">
      <p className="mb-3 text-sm font-semibold text-gray-700">{title}</p>
      {rows.length ? (
        <Table<AnalyticsTopN> columns={topColumns} data={rows} />
      ) : (
        <p className="text-xs text-gray-400">{__uiText("ยังไม่มีข้อมูล")}</p>
      )}
    </div>
  );
}

export default function SmartLinkAnalyticsPage() {
  __useUiLocale();
  const { id } = useParams();
  const navigate = useNavigate();
  const [linkLabel, setLinkLabel] = useState<string | null>(null);
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [data, setData] = useState<SmartLinkAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setData(null);
    const loader = id
      ? getSmartLinkAnalytics(id, range)
      : getSmartLinkAnalyticsOverview(range);
    loader.then(value => { if (active) setData(value); })
      .catch((error: unknown) => { if (active) setLoadError(error); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range, id, reload]);

  useEffect(() => {
    if (!id) { setLinkLabel(null); return; }
    getSmartLink(id).then((l) => setLinkLabel(l.title || l.slug)).catch(() => setLinkLabel(null));
  }, [id]);

  return (
    <div className="cp-management-page">
      <AdminListHeader
        title={id ? __uiText("Analytics — {0}", {"0": linkLabel ?? '…'}) : __uiText("Smart Link Analytics")}
        subtitle={__uiText("คลิก / ผู้เข้าชม / conversion ตามช่วงเวลา")}
      />
      {Boolean(loadError) && <div className="mt-4"><LoadError title={__uiText('Smart Link Analytics')} error={loadError} onRetry={() => setReload(value => value + 1)} /></div>}
      {id && (
        <button
          className="mt-2 text-sm text-blue-600"
          onClick={() => navigate(ADMIN_ROUTES.smartLinks)}
        >
          {__uiText("← กลับไปหน้า Smart Links")}</button>
      )}

      <div className="mt-4 flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            className={`rounded-lg px-3 py-1.5 text-sm ${range === r.value ? 'bg-primary text-white' : 'bg-gray-100'}`}
          >
            {r.label}
          </button>
        ))}
        {loading && <span className="self-center text-xs text-gray-400">{__uiText("กำลังโหลด…")}</span>}
      </div>

      {data && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label={__uiText("Clicks")} value={data.totals.clicks} />
            <Tile label={__uiText("Unique Visitors")} value={data.totals.uniqueVisitors} />
            <Tile label={__uiText("Conversions")} value={data.totals.conversions} />
            <Tile label={__uiText("Conversion Rate")} value={`${data.totals.conversionRate}%`} />
          </div>

          <div className="mt-4 rounded-xl border border-gray-100 bg-white p-5">
            <p className="mb-3 text-sm font-semibold text-gray-700">{__uiText("Clicks over time")}</p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.timeSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="clicks" stroke="#2563eb" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 rounded-xl border border-gray-100 bg-white p-5">
            <p className="mb-3 text-sm font-semibold text-gray-700">{__uiText("Top Campaigns")}</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.topCampaigns}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="key" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <TopCard title={__uiText("Top Countries")} rows={data.topCountries} />
            <TopCard title={__uiText("Top Devices")} rows={data.topDevices} />
            <TopCard title={__uiText("Top Browsers")} rows={data.topBrowsers} />
          </div>
        </>
      )}
    </div>
  );
}
