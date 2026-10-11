// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { getUserDashboard, type AdminOrderUiStatus } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { RevealPiiButton } from '../../components/RevealPiiButton';
import BranchPricingPanel from './BranchPricingPanel';
import CsUserTools from '../CS/CsUserTools';
import UserJourneyTimeline from './UserJourneyTimeline';

// ui-copy-migration: only literal UI copy and notification templates
import { Alert, Button, Chip, Empty, KeyValueGrid, Loading, PageHeader, Panel, PanelHead, Segmented, StatGrid, StatTile, type Tone, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type DashboardData = {
  user: {
    id: string;
    full_name: string;
    email: string;
    custcode: string | null;
    mobile_phone: string | null;
    custype: string | null;
    role: string;
    company: { id?: string; name: string; register_number: string | null } | null;
    branches: Array<{
      id: string;
      name: string;
      delivery_address: string | null;
      delivery_latitude?: number | null;
      delivery_longitude?: number | null;
    }>;
    branch_count: number;
  };
  summary: {
    total_orders: number;
    total_spend: number;
    avg_order_value: number;
    total_items: number;
  };
  top_products: Array<{
    product_inventory_id: string;
    sku: string;
    product_name: string;
    total_quantity: number;
    total_revenue: number;
  }>;
  recent_orders: Array<{
    orders_id: string;
    order_id: string;
    total_price: number;
    status: AdminOrderUiStatus;
    branch: string;
    date: string;
    item_count: number;
  }>;
  monthly_spend: Array<{
    month: string;
    order_count: number;
    total: number;
  }>;
};

const ORDER_STATUS_LABELS: Record<AdminOrderUiStatus, string> = {
  get pending(){return __uiText("รอชำระเงิน");},
  get paid(){return __uiText("ชำระแล้ว");},
  get preparing(){return __uiText("กำลังเตรียม");},
  get shipped(){return __uiText("กำลังจัดส่ง");},
  get complete(){return __uiText("เสร็จสิ้น");},
  get cancelled(){return __uiText("ยกเลิก / คืนเงิน");},
};

const ORDER_STATUS_TONES: Record<AdminOrderUiStatus, Tone> = {
  pending: 'warn',
  paid: 'info',
  preparing: 'info',
  shipped: 'info',
  complete: 'ok',
  cancelled: 'muted',
};

type DetailTab = 'overview' | 'pricing' | 'cs' | 'journey';

function formatCurrency(value: number) {
  return `฿${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

const UserDetail = () => {
  __useUiLocale();
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  useEffect(() => {
    if (!userId) return;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response: any = await getUserDashboard(userId);
        if (response?.status === 200 && response.data?.status === true) {
          setDashboard(response.data.data);
        } else {
          setError(__uiMessage("ไม่พบข้อมูลผู้ใช้"));
        }
      } catch (err: any) {
        setError(err?.response?.data?.message ?? __uiMessage("โหลดข้อมูลไม่สำเร็จ"));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [userId]);

  const chartData = useMemo(() => {
    if (!dashboard?.monthly_spend?.length) return [];
    return [...dashboard.monthly_spend].reverse().map((row) => ({
      month: row.month,
      total: row.total,
      orders: row.order_count,
    }));
  }, [dashboard?.monthly_spend]);

  const orderColumns: TableColumn<DashboardData['recent_orders'][0]>[] = [
    { key: 'order_id', label: __uiText("เลขที่ออเดอร์"), render: (value) => <span className="font-mono text-[11px]">{value}</span> },
    {
      key: 'date',
      label: __uiText("วันที่สั่ง"),
      render: (value) =>
        value
          ? new Date(String(value)).toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : '-',
    },
    { key: 'branch', label: __uiText("สาขา") },
    {
      key: 'item_count',
      label: __uiText("รายการ"),
      align: 'right',
      render: (value) => __uiText("{0} ชิ้น", { 0: Number(value).toLocaleString() }),
    },
    {
      key: 'total_price',
      label: __uiText("ยอดรวม"),
      align: 'right',
      render: (value) => (
        <span className="font-semibold tabular-nums">{formatCurrency(Number(value))}</span>
      ),
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value: DashboardData['recent_orders'][0]['status']) => (
        <Chip tone={ORDER_STATUS_TONES[value] ?? 'muted'} statusCode={value} dot>
          {ORDER_STATUS_LABELS[value] ?? value}
        </Chip>
      ),
    },
    {
      key: 'orders_id',
      label: '',
      render: (_, row) => (
        <Button size="sm" variant="ghost" onClick={() => navigate(ADMIN_ROUTES.orderDetail(row.orders_id))}>
          {__uiText("ดูออเดอร์")}</Button>
      ),
    },
  ];

  const topProductColumns: TableColumn<DashboardData['top_products'][0]>[] = [
    { key: 'sku', label: __uiText("รหัสสินค้า"), render: (value) => <span className="font-mono text-[11px]">{value}</span> },
    { key: 'product_name', label: __uiText("สินค้า") },
    {
      key: 'total_quantity',
      label: __uiText("จำนวนที่สั่ง"),
      align: 'right',
      render: (value) => (
        <span className="font-semibold tabular-nums">{Number(value).toLocaleString()}</span>
      ),
    },
    {
      key: 'total_revenue',
      label: __uiText("มูลค่ารวม"),
      align: 'right',
      render: (value) => formatCurrency(Number(value)),
    },
  ];

  const back = { to: ADMIN_ROUTES.users, label: 'กลับรายชื่อผู้ใช้' };

  if (loading) {
    return (
      <div className="cp-management-page grid w-full gap-5">
        <PageHeader back={back} title={__uiText("รายละเอียดผู้ใช้")} />
        <Loading variant="detail">{__uiText("กำลังโหลดข้อมูลลูกค้า...")}</Loading>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="cp-management-page grid w-full gap-5">
        <PageHeader back={back} title={__uiText("รายละเอียดผู้ใช้")} />
        <Alert tone="danger">{error || __uiText("ไม่พบข้อมูล")}</Alert>
      </div>
    );
  }

  const { user, summary, top_products, recent_orders } = dashboard;
  const topProduct = top_products[0];
  const tabs: { value: DetailTab; label: string }[] = [
    { value: 'overview', label: __uiText("ภาพรวม") },
    { value: 'pricing', label: __uiText("ราคาพิเศษ") },
    { value: 'cs', label: __uiText("เครื่องมือบริการลูกค้า") },
    { value: 'journey', label: __uiText("เส้นทางการใช้งาน") },
  ];

  return (
    <div className="cp-management-page grid w-full gap-5">
      <PageHeader
        back={back}
        title={user.full_name}
        subtitle={<>{user.email} · {user.custcode ? <span className="font-mono">{user.custcode}</span> : __uiText("ไม่มีรหัสลูกค้า")}</>}
        actions={
          <a
            href={`https://ecommerecesupport.zendesk.com/agent/search/1?type=user&q=${encodeURIComponent(user.email)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-outline-variant/70 bg-surface-container-lowest px-3.5 py-2 text-[13px] font-medium text-on-surface shadow-card hover:bg-surface-container-low"
          >
            {__uiText("เปิดประวัติติดต่อ (Zendesk)")}</a>
        }
      />

      <div className="overflow-x-auto">
        <Segmented value={activeTab} onChange={setActiveTab} options={tabs} />
      </div>

      {activeTab === 'journey' ? (
        <UserJourneyTimeline userId={user.id} />
      ) : activeTab === 'cs' ? (
        <CsUserTools
          userId={user.id}
          companyId={user.company?.id}
          email={user.email}
          firstName={user.full_name.split(' ')[0] ?? ''}
          lastName={user.full_name.split(' ').slice(1).join(' ')}
          mobilePhone={user.mobile_phone}
          branches={user.branches}
          onUpdated={() => {
            if (!userId) return;
            void getUserDashboard(userId).then((response: any) => {
              if (response?.status === 200 && response.data?.status === true) {
                setDashboard(response.data.data);
              }
            });
          }}
        />
      ) : activeTab === 'pricing' ? (
        <Panel className="overflow-hidden">
          <PanelHead icon="sell" title={__uiText("ราคาสัญญาตามสาขา")} />
          <div className="p-4">
            <BranchPricingPanel
              branches={user.branches ?? []}
              companyEditHref={
                user.company?.id
                  ? ADMIN_ROUTES.companyEdit(user.company.id)
                  : undefined
              }
            />
          </div>
        </Panel>
      ) : (
        <>
      <Panel className="p-4">
        <KeyValueGrid
          items={[
            { label: __uiText("บริษัท"), value: user.company?.name ?? '-' },
            {
              label: __uiText("เบอร์โทร"),
              value: (
                <RevealPiiButton
                  subjectType="user"
                  subjectId={user.id}
                  field="mobile_phone"
                  masked={user.mobile_phone}
                />
              ),
            },
            { label: __uiText("ประเภทร้าน"), value: user.custype ?? '-' },
            { label: __uiText("สาขา"), value: __uiText("{0} สาขา", { 0: user.branch_count }) },
          ]}
        />
      </Panel>

      <StatGrid cols={4}>
        <StatTile label={__uiText("ออเดอร์ทั้งหมด")} value={summary.total_orders.toLocaleString()} />
        <StatTile label={__uiText("ยอดสั่งซื้อรวม")} value={formatCurrency(summary.total_spend)} tone="primary" accent />
        <StatTile label={__uiText("เฉลี่ยต่อออเดอร์")} value={formatCurrency(summary.avg_order_value)} />
        <StatTile label={__uiText("จำนวนสินค้าที่สั่ง")} value={summary.total_items.toLocaleString()} />
      </StatGrid>

      {topProduct && (
        <Panel className="p-4">
          <p className="text-xs font-medium text-on-surface-variant">{__uiText("สินค้าที่สั่งบ่อยที่สุด")}</p>
          <div className="mt-1 text-lg font-semibold text-on-surface">
            {topProduct.product_name}
          </div>
          <div className="mt-1 text-sm text-on-surface-variant">
            {__uiText("รหัสสินค้า ")}<span className="font-mono">{topProduct.sku}</span> {__uiText(" · สั่งแล้ว ")}<span className="tabular-nums">{topProduct.total_quantity.toLocaleString()}</span> {__uiText(" ชิ้น ·")}{' '}
            <span className="tabular-nums">{formatCurrency(topProduct.total_revenue)}</span>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="overflow-hidden">
          <PanelHead icon="inventory_2" title={__uiText("สินค้าที่สั่งบ่อย 10 อันดับแรก")} />
          {top_products.length === 0 ? (
            <Empty icon="inventory_2">{__uiText("ยังไม่มีประวัติการสั่งซื้อ")}</Empty>
          ) : (
            <Table columns={topProductColumns} data={top_products} idKey="product_inventory_id" />
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHead icon="bar_chart" title={__uiText("ยอดสั่งซื้อรายเดือน")} />
          {chartData.length === 0 ? (
            <Empty icon="bar_chart">{__uiText("ยังไม่มีข้อมูลกราฟ")}</Empty>
          ) : (
            <div className="h-[280px] w-full p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-secondary-container)" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === 'total' ? formatCurrency(value) : value
                    }
                  />
                  <Bar dataKey="total" fill="var(--color-primary)" name={__uiText("ยอดสั่งซื้อ")} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <Panel className="overflow-hidden">
        <PanelHead icon="receipt_long" title={__uiText("ออเดอร์ล่าสุด")} />
        {recent_orders.length === 0 ? (
          <Empty icon="receipt_long">{__uiText("ยังไม่มีออเดอร์")}</Empty>
        ) : (
          <Table columns={orderColumns} data={recent_orders} idKey="orders_id" />
        )}
      </Panel>

      {user.branches.length > 0 && (
        <Panel className="overflow-hidden">
          <PanelHead icon="storefront" title={__uiText("สาขาที่เชื่อมโยง")} />
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {user.branches.map((branch) => (
              <div
                key={branch.id}
                className="rounded-lg border border-secondary-container p-3"
              >
                <div className="font-medium text-on-surface">{branch.name}</div>
                <div className="mt-1 text-xs text-on-surface-variant">
                  {branch.delivery_address || __uiText("ไม่มีที่อยู่จัดส่ง")}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
        </>
      )}
    </div>
  );
};

export default UserDetail;
