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

const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
];

const topColumns: TableColumn<AnalyticsTopN>[] = [
  { key: 'key', label: 'Value' },
  { key: 'count', label: 'Clicks' },
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
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5">
      <p className="mb-3 text-sm font-semibold text-gray-700">{title}</p>
      {rows.length ? (
        <Table<AnalyticsTopN> columns={topColumns} data={rows} />
      ) : (
        <p className="text-xs text-gray-400">ยังไม่มีข้อมูล</p>
      )}
    </div>
  );
}

export default function SmartLinkAnalyticsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [linkLabel, setLinkLabel] = useState<string | null>(null);
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [data, setData] = useState<SmartLinkAnalytics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const loader = id
      ? getSmartLinkAnalytics(id, range)
      : getSmartLinkAnalyticsOverview(range);
    loader.then(setData).finally(() => setLoading(false));
  }, [range, id]);

  useEffect(() => {
    if (!id) { setLinkLabel(null); return; }
    getSmartLink(id).then((l) => setLinkLabel(l.title || l.slug)).catch(() => setLinkLabel(null));
  }, [id]);

  return (
    <div className="p-6">
      <AdminListHeader
        title={id ? `Analytics — ${linkLabel ?? '…'}` : 'Smart Link Analytics'}
        subtitle="คลิก / ผู้เข้าชม / conversion ตามช่วงเวลา"
      />
      {id && (
        <button
          className="mt-2 text-sm text-blue-600"
          onClick={() => navigate(ADMIN_ROUTES.smartLinks)}
        >
          ← กลับไปหน้า Smart Links
        </button>
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
        {loading && <span className="self-center text-xs text-gray-400">กำลังโหลด…</span>}
      </div>

      {data && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Clicks" value={data.totals.clicks} />
            <Tile label="Unique Visitors" value={data.totals.uniqueVisitors} />
            <Tile label="Conversions" value={data.totals.conversions} />
            <Tile label="Conversion Rate" value={`${data.totals.conversionRate}%`} />
          </div>

          <div className="mt-4 rounded-xl border border-gray-100 bg-white p-5">
            <p className="mb-3 text-sm font-semibold text-gray-700">Clicks over time</p>
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
            <p className="mb-3 text-sm font-semibold text-gray-700">Top Campaigns</p>
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
            <TopCard title="Top Countries" rows={data.topCountries} />
            <TopCard title="Top Devices" rows={data.topDevices} />
            <TopCard title="Top Browsers" rows={data.topBrowsers} />
          </div>
        </>
      )}
    </div>
  );
}
