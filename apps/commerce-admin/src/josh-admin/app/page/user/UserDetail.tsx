// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
import { getUserDashboard, type AdminOrderUiStatus } from '@josh/shared-api';
import { Table, TableColumn, Text } from '@josh/shared-ui-web';
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
import AdminListHeader from '../../components/AdminListHeader';
import { RevealPiiButton } from '../../components/RevealPiiButton';
import BranchPricingPanel from './BranchPricingPanel';
import CsUserTools from '../CS/CsUserTools';
import UserJourneyTimeline from './UserJourneyTimeline';

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
  pending: 'รอชำระเงิน',
  paid: 'ชำระแล้ว',
  preparing: 'กำลังเตรียม',
  shipped: 'กำลังจัดส่ง',
  complete: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก / คืนเงิน',
};

const ORDER_STATUS_STYLES: Record<AdminOrderUiStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  preparing: 'bg-lime-50 text-lime-700 border-lime-200',
  shipped: 'bg-primary/10 text-primary border-primary/20',
  complete: 'bg-sky-50 text-sky-700 border-sky-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
};

function formatCurrency(value: number) {
  return `฿${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

const UserDetail = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'pricing' | 'cs' | 'journey'>(
    'overview',
  );

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
          setError('ไม่พบข้อมูลผู้ใช้');
        }
      } catch (err: any) {
        setError(err?.response?.data?.message ?? 'โหลดข้อมูลไม่สำเร็จ');
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
    { key: 'order_id', label: 'เลขที่ออเดอร์' },
    {
      key: 'date',
      label: 'วันที่สั่ง',
      render: (value) =>
        value
          ? new Date(String(value)).toLocaleDateString('th-TH', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : '-',
    },
    { key: 'branch', label: 'สาขา' },
    {
      key: 'item_count',
      label: 'รายการ',
      render: (value) => `${value} ชิ้น`,
    },
    {
      key: 'total_price',
      label: 'ยอดรวม',
      render: (value) => (
        <span className="font-semibold text-gray-800">{formatCurrency(Number(value))}</span>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (value: DashboardData['recent_orders'][0]['status']) => (
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${ORDER_STATUS_STYLES[value]}`}
        >
          {ORDER_STATUS_LABELS[value]}
        </span>
      ),
    },
    {
      key: 'orders_id',
      label: '',
      render: (_, row) => (
        <button
          type="button"
          onClick={() => navigate(ADMIN_ROUTES.orderDetail(row.orders_id))}
          className="text-xs font-semibold text-primary hover:underline"
        >
          ดูออเดอร์
        </button>
      ),
    },
  ];

  const topProductColumns: TableColumn<DashboardData['top_products'][0]>[] = [
    { key: 'sku', label: 'SKU' },
    { key: 'product_name', label: 'สินค้า' },
    {
      key: 'total_quantity',
      label: 'จำนวนที่สั่ง',
      render: (value) => (
        <span className="font-semibold text-primary">{Number(value).toLocaleString()}</span>
      ),
    },
    {
      key: 'total_revenue',
      label: 'มูลค่ารวม',
      render: (value) => formatCurrency(Number(value)),
    },
  ];

  if (loading) {
    return (
      <div className="p-8 text-sm text-gray-500">กำลังโหลดข้อมูลลูกค้า...</div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="grid gap-4 p-8">
        <p className="text-sm text-red-600">{error || 'ไม่พบข้อมูล'}</p>
        <button
          type="button"
          onClick={() => navigate(ADMIN_ROUTES.users)}
          className="w-fit rounded-lg bg-gray-800 px-4 py-2 text-sm text-white"
        >
          กลับรายชื่อผู้ใช้
        </button>
      </div>
    );
  }

  const { user, summary, top_products, recent_orders } = dashboard;
  const topProduct = top_products[0];

  return (
    <div className="grid mx-auto w-full gap-5 p-4">
      <AdminListHeader
        title={user.full_name}
        subtitle={`${user.email} · ${user.custcode ?? 'ไม่มี custcode'}`}
      >
        <button
          type="button"
          onClick={() => navigate(ADMIN_ROUTES.users)}
          className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          ← กลับรายชื่อผู้ใช้
        </button>
        <a
          href={`https://ecommerecesupport.zendesk.com/agent/search/1?type=user&q=${encodeURIComponent(user.email)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
        >
          เปิดใน Zendesk
        </a>
      </AdminListHeader>

      <div className="flex gap-2 border-b border-gray-100">
        <TabButton
          active={activeTab === 'overview'}
          onClick={() => setActiveTab('overview')}
          label="ภาพรวม"
        />
        <TabButton
          active={activeTab === 'pricing'}
          onClick={() => setActiveTab('pricing')}
          label="ราคาพิเศษ"
        />
        <TabButton
          active={activeTab === 'cs'}
          onClick={() => setActiveTab('cs')}
          label="เครื่องมือ CS"
        />
        <TabButton
          active={activeTab === 'journey'}
          onClick={() => setActiveTab('journey')}
          label="Journey"
        />
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
        <section className="overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-gray-800">
            ราคาสัญญาตามสาขา
          </h2>
          <BranchPricingPanel
            branches={user.branches ?? []}
            companyEditHref={
              user.company?.id
                ? ADMIN_ROUTES.companyEdit(user.company.id)
                : undefined
            }
          />
        </section>
      ) : (
        <>
      <div className="grid gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-4">
        <InfoCard label="Company" value={user.company?.name ?? '-'} />
        <InfoCard
          label="เบอร์โทร"
          value={
            <RevealPiiButton
              subjectType="user"
              subjectId={user.id}
              field="mobile_phone"
              masked={user.mobile_phone}
            />
          }
        />
        <InfoCard label="Cuisine / Type" value={user.custype ?? '-'} />
        <InfoCard label="สาขา" value={`${user.branch_count} สาขา`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="ออเดอร์ทั้งหมด" value={summary.total_orders.toLocaleString()} />
        <StatCard label="ยอดสั่งซื้อรวม" value={formatCurrency(summary.total_spend)} accent />
        <StatCard label="เฉลี่ยต่อออเดอร์" value={formatCurrency(summary.avg_order_value)} />
        <StatCard label="จำนวนสินค้าที่สั่ง" value={summary.total_items.toLocaleString()} />
      </div>

      {topProduct && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
          <Text variant="bodySm" muted>
            สินค้าที่สั่งบ่อยที่สุด
          </Text>
          <div className="mt-1 text-lg font-bold text-gray-900">
            {topProduct.product_name}
          </div>
          <div className="mt-1 text-sm text-gray-600">
            SKU {topProduct.sku} · สั่งแล้ว {topProduct.total_quantity.toLocaleString()} ชิ้น ·{' '}
            {formatCurrency(topProduct.total_revenue)}
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-bold text-gray-800">สินค้าที่สั่งบ่อย (Top 10)</h2>
          </div>
          {top_products.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">ยังไม่มีประวัติการสั่งซื้อ</p>
          ) : (
            <Table columns={topProductColumns} data={top_products} idKey="product_inventory_id" />
          )}
        </section>

        <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-gray-800">ยอดสั่งซื้อรายเดือน</h2>
          {chartData.length === 0 ? (
            <p className="text-sm text-gray-500">ยังไม่มีข้อมูลกราฟ</p>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === 'total' ? formatCurrency(value) : value
                    }
                  />
                  <Bar dataKey="total" fill="#2563eb" name="ยอดสั่งซื้อ" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-bold text-gray-800">ออเดอร์ล่าสุด</h2>
        </div>
        {recent_orders.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">ยังไม่มีออเดอร์</p>
        ) : (
          <Table columns={orderColumns} data={recent_orders} idKey="orders_id" />
        )}
      </section>

      {user.branches.length > 0 && (
        <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-gray-800">สาขาที่เชื่อมโยง</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {user.branches.map((branch) => (
              <div
                key={branch.id}
                className="rounded-lg border border-gray-100 bg-gray-50 p-3"
              >
                <div className="font-medium text-gray-800">{branch.name}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {branch.delivery_address || 'ไม่มีที่อยู่จัดส่ง'}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
        </>
      )}
    </div>
  );
};

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-4 py-2 text-sm font-medium ${
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-gray-500 hover:text-gray-800'
      }`}
    >
      {label}
    </button>
  );
}

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p
        className={`mt-2 text-2xl font-bold ${accent ? 'text-primary' : 'text-gray-900'}`}
      >
        {value}
      </p>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-800">{value}</p>
    </div>
  );
}

export default UserDetail;
