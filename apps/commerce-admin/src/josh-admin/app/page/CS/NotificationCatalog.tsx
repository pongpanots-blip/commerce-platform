// ui-metadata-migration: static labels and UI notices only
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

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale, Button, Chip, Empty, confirmAction } from "@cp/ui";
const CHANNELS: { key: NotificationDeliveryChannel; label: string }[] = [
  { key: 'inapp', get label() { return __uiText("ในแอป"); } },
  { key: 'push', get label() { return __uiText("แจ้งเตือนบนมือถือ"); } },
  { key: 'email', get label() { return __uiText("อีเมล"); } },
];

const CATEGORY_LABEL: Record<NotificationCatalogItem['category'], string> = {
  get order_update(){return __uiText("คำสั่งซื้อ");},
  get financial(){return __uiText("การเงิน");},
  get account(){return __uiText("บัญชี");},
  get back_in_stock(){return __uiText("สินค้ากลับมามีสต๊อก");},
  get order_round(){return __uiText("รอบสั่งซื้อ");},
  get marketing(){return __uiText("การตลาด");},
  get winback(){return __uiText("ชวนลูกค้าเก่ากลับมาซื้อ");},
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
  __useUiLocale();
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
      setError(__uiMessage("ไม่สามารถโหลดรายการแจ้งเตือนได้"));
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
      setError(__uiMessage("บันทึก \"{0}\" ไม่สำเร็จ", {"0": item.label}));
    } finally {
      setSavingType(null);
    }
  };

  const handleToggleEnabled = async (item: NotificationCatalogItem) => {
    if (
      item.enabled &&
      !(await confirmAction({
        title: __uiMessage("ปิดการแจ้งเตือน \"{0}\" ?", { "0": item.label }),
        body: item.critical
          ? __uiText("เป็นการแจ้งเตือนเรื่องคำสั่งซื้อของลูกค้า ปิดแล้วลูกค้าจะไม่รู้ความคืบหน้าของคำสั่งซื้อที่จ่ายเงินไปแล้ว")
          : __uiText("ปิดแล้วลูกค้าทุกคนจะไม่ได้รับการแจ้งเตือนประเภทนี้ จนกว่าจะเปิดอีกครั้ง"),
        confirmLabel: __uiText("ปิดการแจ้งเตือน"),
        danger: true,
      }))
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
      setError(__uiMessage("ต้องเปิดอย่างน้อยหนึ่งช่องทาง — ถ้าต้องการหยุดส่ง ให้ปิดทั้งรายการแทน"));
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
        title={__uiText("ประเภทการแจ้งเตือนทั้งหมด")}
        subtitle={__uiText("การแจ้งเตือนทุกประเภทที่ระบบส่งได้ และการเปิดปิด")}
      />

      <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-600">
        <p>
          {__uiText("การปิดที่นี่เป็นสวิตช์ระดับระบบ — ปิดแล้วไม่มีลูกค้าคนไหนได้รับ ไม่ว่าเขาจะเปิดรับไว้หรือไม่ ส่วนช่องทางที่เปิดไว้ยังต้องผ่านการตั้งค่า ของลูกค้าแต่ละคนอีกชั้น")}</p>
        <p className="mt-2">
          {__uiText("แก้ข้อความที่")}{' '}
          <Link className="text-primary hover:underline" to={ADMIN_ROUTES.marketingNotifyTemplates}>
            {__uiText("แม่แบบข้อความ")}</Link>{' '}
          {__uiText("· ดูผลการส่งที่")}{' '}
          <Link className="text-primary hover:underline" to={ADMIN_ROUTES.notificationStats}>
            {__uiText("สถิติการส่งแจ้งเตือน")}</Link>
        </p>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{(typeof error === 'string' ? __uiText(error) : error)}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : grouped.length === 0 ? (
        !error && <Empty>{__uiText("ยังไม่มีประเภทการแจ้งเตือน — ลองโหลดหน้านี้ใหม่อีกครั้ง")}</Empty>
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
                        {item.critical && <Chip tone="warn">{__uiText("สำคัญ")}</Chip>}
                        {item.customised && <Chip tone="info">{__uiText("แก้ไขแล้ว")}</Chip>}
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

                      <Chip tone={item.enabled ? 'ok' : 'muted'} dot>
                        {item.enabled ? __uiText("เปิดใช้งาน") : __uiText("ปิดอยู่")}
                      </Chip>
                      <Button
                        size="sm"
                        variant={item.enabled ? 'danger-ghost' : 'secondary'}
                        disabled={savingType === item.type}
                        onClick={() => void handleToggleEnabled(item)}
                      >
                        {item.enabled ? __uiText("ปิดการแจ้งเตือน") : __uiText("เปิดการแจ้งเตือน")}
                      </Button>
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
