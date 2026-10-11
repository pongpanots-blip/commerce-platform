// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid,
} from 'recharts';
import {
  getSmartLinkAnalyticsOverview, getSmartLinkAnalytics, getSmartLink,
  type SmartLinkAnalytics, type AnalyticsRange, type AnalyticsTopN,
} from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { LoadError } from '../../components/LoadError';

// ui-copy-migration: only literal UI copy and notification templates
import { Empty, PageHeader, Panel, PanelHead, Segmented, StatGrid, StatTile, fmt, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: 'today', get label() { return __uiText('วันนี้'); } },
  { value: '7d', get label() { return __uiText('7 วัน'); } },
  { value: '30d', get label() { return __uiText('30 วัน'); } },
];

const CHART_COLOR = 'var(--color-primary)';

const topColumns: TableColumn<AnalyticsTopN>[] = [
  { key: 'key', get label(){return __uiText("รายการ");} },
  { key: 'count', get label(){return __uiText("จำนวนคลิก");}, align: 'right', render: (v: number) => <span className="tabular-nums">{fmt.num(v)}</span> },
];

function TopCard({ title, rows }: { title: string; rows: AnalyticsTopN[] }) {
  __useUiLocale();
  return (
    <Panel className="overflow-hidden">
      <PanelHead title={title} />
      {rows.length ? (
        <Table<AnalyticsTopN> columns={topColumns} data={rows} />
      ) : (
        <div className="px-4 py-6"><Empty>{__uiText("ยังไม่มีข้อมูล")}</Empty></div>
      )}
    </Panel>
  );
}

export default function SmartLinkAnalyticsPage() {
  __useUiLocale();
  const { id } = useParams();
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
    <div className="cp-management-page space-y-4">
      <PageHeader
        back={id ? { to: ADMIN_ROUTES.smartLinks, label: 'ลิงก์ติดตามผล' } : undefined}
        title={id ? __uiText("ผลของลิงก์ {0}", {"0": linkLabel ?? '…'}) : __uiText("ผลของลิงก์ติดตามผล")}
        subtitle={__uiText("จำนวนคนกด คนที่เข้ามา และคนที่ซื้อ ในช่วงเวลาที่เลือก")}
        actions={
          <div className="flex items-center gap-2">
            {loading && <span className="text-xs text-gray-400">{__uiText("กำลังโหลด…")}</span>}
            <Segmented options={RANGES} value={range} onChange={setRange} />
          </div>
        }
      />
      {Boolean(loadError) && <LoadError title={__uiText('ผลของลิงก์ติดตามผล')} error={loadError} onRetry={() => setReload(value => value + 1)} />}

      {data && (
        <>
          <StatGrid cols={4}>
            <StatTile label={__uiText("คลิก")} value={fmt.num(data.totals.clicks)} />
            <StatTile label={__uiText("คนที่เข้ามา (ไม่นับซ้ำ)")} value={fmt.num(data.totals.uniqueVisitors)} />
            <StatTile label={__uiText("ซื้อ")} value={fmt.num(data.totals.conversions)} />
            <StatTile label={__uiText("อัตราการซื้อ")} value={`${data.totals.conversionRate}%`} />
          </StatGrid>

          <Panel className="overflow-hidden">
            <PanelHead title={__uiText("คลิกในแต่ละวัน")} />
            <div className="p-5">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.timeSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="clicks" name={__uiText("คลิก")} stroke={CHART_COLOR} />
              </LineChart>
            </ResponsiveContainer>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHead title={__uiText("แคมเปญที่มีคนกดมากที่สุด")} />
            <div className="p-5">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.topCampaigns}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="key" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" name={__uiText("คลิก")} fill={CHART_COLOR} />
              </BarChart>
            </ResponsiveContainer>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <TopCard title={__uiText("ประเทศ")} rows={data.topCountries} />
            <TopCard title={__uiText("อุปกรณ์")} rows={data.topDevices} />
            <TopCard title={__uiText("เบราว์เซอร์")} rows={data.topBrowsers} />
          </div>
        </>
      )}
    </div>
  );
}
