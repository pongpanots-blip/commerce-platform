import {
  getNotificationCatalog,
  updateNotificationTypeSetting,
  type NotificationCatalogItem,
  type NotificationDeliveryChannel,
} from '@josh/shared-api';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const CHANNELS: { key: NotificationDeliveryChannel; label: string }[] = [
  { key: 'inapp', label: 'ในแอป' },
  { key: 'push', label: 'Push' },
  { key: 'email', label: 'อีเมล' },
];

const CATEGORY_LABEL: Record<NotificationCatalogItem['category'], string> = {
  order_update: 'คำสั่งซื้อ',
  financial: 'การเงิน',
  account: 'บัญชี',
  back_in_stock: 'สินค้ากลับมามีสต๊อก',
  order_round: 'รอบสั่งซื้อ',
  marketing: 'การตลาด',
  winback: 'Win-back (แอปเซลล์)',
};

const CATEGORY_ORDER: NotificationCatalogItem['category'][] = [
  'order_update',
  'financial',
  'account',
  'back_in_stock',
  'order_round',
  'marketing',
  'winback',
];

/**
 * ตั้งค่าการแจ้งเตือนระดับระบบ — เปิด/ปิดทั้ง type และเลือกช่องทางที่อนุญาต
 *
 * คนละชั้นกับการตั้งค่าของลูกค้าเอง (`/account/notifications`): ที่นี่ปิดแล้ว
 * ไม่มีใครได้รับเลย ส่วนช่องทางที่เปิดไว้ยังต้องผ่าน preference ของลูกค้าอีกที
 * — แก้ข้อความไปที่หน้า Notify Templates
 */
export default function NotificationCatalogPage() {
  const [items, setItems] = useState<NotificationCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getNotificationCatalog();
      setItems(response.data.data);
    } catch {
      setItems([]);
      setError('ไม่สามารถโหลดรายการแจ้งเตือนได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (
    item: NotificationCatalogItem,
    patch: { enabled?: boolean; allowedChannels?: NotificationDeliveryChannel[] },
  ) => {
    setSavingType(item.type);
    setError(null);
    try {
      const response = await updateNotificationTypeSetting(item.type, patch);
      const saved = response.data.data;
      setItems((previous) =>
        previous.map((row) => (row.type === saved.type ? saved : row)),
      );
    } catch {
      setError(`บันทึก "${item.label}" ไม่สำเร็จ`);
    } finally {
      setSavingType(null);
    }
  };

  const handleToggleEnabled = (item: NotificationCatalogItem) => {
    if (
      item.enabled &&
      item.critical &&
      !window.confirm(
        `"${item.label}" เป็นการแจ้งเตือนเรื่องคำสั่งซื้อของลูกค้า\n` +
          'ปิดแล้วลูกค้าจะไม่รู้ความคืบหน้าของออเดอร์ที่จ่ายเงินไปแล้ว\n\nยืนยันปิด?',
      )
    ) {
      return;
    }
    void save(item, { enabled: !item.enabled });
  };

  const handleToggleChannel = (
    item: NotificationCatalogItem,
    channel: NotificationDeliveryChannel,
  ) => {
    const next = item.allowedChannels.includes(channel)
      ? item.allowedChannels.filter((value) => value !== channel)
      : [...item.allowedChannels, channel];
    if (next.length === 0) {
      setError('ต้องเปิดอย่างน้อยหนึ่งช่องทาง — ถ้าต้องการหยุดส่ง ให้ปิดทั้งรายการแทน');
      return;
    }
    void save(item, { allowedChannels: next });
  };

  const grouped = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        rows: items.filter((item) => item.category === category),
      })).filter((group) => group.rows.length > 0),
    [items],
  );

  return (
    <div className="p-6">
      <AdminListHeader
        title="Notification Catalog"
        subtitle="ตั้งค่าว่าระบบส่งการแจ้งเตือนอะไรบ้าง และส่งทางไหน"
      />

      <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-600">
        <p>
          การปิดที่นี่เป็นสวิตช์ระดับระบบ — ปิดแล้วไม่มีลูกค้าคนไหนได้รับ
          ไม่ว่าเขาจะเปิดรับไว้หรือไม่ ส่วนช่องทางที่เปิดไว้ยังต้องผ่านการตั้งค่า
          ของลูกค้าแต่ละคนอีกชั้น
        </p>
        <p className="mt-2">
          แก้ข้อความที่{' '}
          <Link className="text-primary hover:underline" to={ADMIN_ROUTES.marketingNotifyTemplates}>
            Notify Templates
          </Link>{' '}
          · ดูผลการส่งที่{' '}
          <Link className="text-primary hover:underline" to={ADMIN_ROUTES.notificationStats}>
            Notification Stats
          </Link>
        </p>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">กำลังโหลด...</p>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.category}>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">
                {CATEGORY_LABEL[group.category]}
              </h2>
              <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
                {group.rows.map((item, index) => (
                  <div
                    key={item.type}
                    className={`flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between ${
                      index > 0 ? 'border-t border-gray-100' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-800">{item.label}</span>
                        <span className="font-mono text-xs text-gray-400">{item.type}</span>
                        {item.critical && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                            สำคัญ
                          </span>
                        )}
                        {item.customised && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                            แก้ไขแล้ว
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{item.trigger}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex gap-3">
                        {CHANNELS.map((channel) => (
                          <label
                            key={channel.key}
                            className={`flex items-center gap-1 text-xs ${
                              item.enabled ? 'text-gray-600' : 'text-gray-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              disabled={!item.enabled || savingType === item.type}
                              checked={item.allowedChannels.includes(channel.key)}
                              onChange={() => handleToggleChannel(item, channel.key)}
                            />
                            {channel.label}
                          </label>
                        ))}
                      </div>

                      <button
                        type="button"
                        disabled={savingType === item.type}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
                          item.enabled
                            ? 'bg-green-50 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                        onClick={() => handleToggleEnabled(item)}
                      >
                        {item.enabled ? 'เปิดใช้งาน' : 'ปิดอยู่'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
