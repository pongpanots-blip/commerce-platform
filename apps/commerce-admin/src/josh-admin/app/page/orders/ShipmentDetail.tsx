// ui-metadata-migration: static labels and UI notices only
import {
  formatShipmentDuration,
  formatShipmentDurationMinutes,
  getShipmentById,
  type ShipmentDetail,
} from '@josh/shared-api';
import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { ButtonLink, Chip, KeyValueGrid, PageHeader, Panel, PanelHead, type Tone, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS_LABELS: Record<string, string> = {
  get to_ship(){return __uiText("รอส่ง");},
  get shipping(){return __uiText("กำลังจัดส่ง");},
  get delivered(){return __uiText("ส่งแล้ว");},
  get cancelled(){return __uiText("ยกเลิก");},
};

const STATUS_TONES: Record<string, Tone> = {
  to_ship: 'warn',
  shipping: 'info',
  delivered: 'ok',
  cancelled: 'muted',
};

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const PhotoGrid = ({
  urls,
  emptyLabel,
}: {
  urls: string[];
  emptyLabel: string;
}) => {
  if (!urls.length) {
    return <p className="text-sm text-gray-400">{emptyLabel}</p>;
  }
  return (
    <div className="flex flex-wrap gap-3">
      {urls.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block w-28 h-28 rounded border border-gray-200 overflow-hidden bg-gray-50"
        >
          <img src={url} alt="" className="w-full h-full object-cover" />
        </a>
      ))}
    </div>
  );
};

const ShipmentDetailPage = () => {
  __useUiLocale();
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const [data, setData] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!shipmentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getShipmentById(shipmentId);
      if (res.status === 200 && res.data && !Array.isArray(res.data)) {
        setData(res.data);
      } else {
        setData(null);
        setError(res.message || __uiMessage("ไม่พบ shipment"));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : __uiMessage("โหลดไม่สำเร็จ"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="cp-management-page py-12 text-center text-gray-500 text-sm">{__uiText("กำลังโหลด...")}</div>
    );
  }

  if (!data) {
    return (
      <div className="cp-management-page flex flex-col gap-3 py-8">
        <PageHeader
          back={{ to: ADMIN_ROUTES.shipments, label: "กลับรายการจัดส่ง" }}
          title={__uiText("ไม่พบการจัดส่ง")}
        />
        <p className="text-sm text-danger">{error || __uiText("ไม่พบข้อมูล")}</p>
      </div>
    );
  }

  const courier = data.tracking?.courier ?? null;
  const pod = data.tracking?.proofOfDelivery ?? null;
  const timing = data.timing;
  const duration = (minutes: number | null | undefined, seconds: number | null | undefined) =>
    minutes != null ? (
      <>
        {formatShipmentDurationMinutes(minutes)}
        <span className="ml-1 text-xs text-gray-400">({__uiText("{0} นาที", {"0": minutes})})</span>
      </>
    ) : (
      formatShipmentDuration(seconds)
    );

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <PageHeader
        back={{ to: ADMIN_ROUTES.shipments, label: "กลับรายการจัดส่ง" }}
        title={<span className="font-mono">{data.shipmentNumber}</span>}
        badge={
          data.status ? (
            <Chip tone={STATUS_TONES[data.status] ?? 'muted'} statusCode={data.status} dot>
              {STATUS_LABELS[data.status] ?? data.statusLabel}
            </Chip>
          ) : (
            <Chip tone="warn" dot>{__uiText("รอชำระ")}</Chip>
          )
        }
        subtitle={data.shipmentIndexLabel}
        actions={
          data.orderId ? (
            <ButtonLink to={ADMIN_ROUTES.orderDetail(data.orderId)} icon="receipt_long">
              {__uiText("เปิดคำสั่งซื้อ {0}", {"0": data.orderNumber || data.orderId.slice(0, 8)})}
            </ButtonLink>
          ) : null
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel className="lg:col-span-2">
          <PanelHead title={__uiText("สรุป")} />
          <div className="p-5">
            <KeyValueGrid
              cols={2}
              items={[
                { label: "ลูกค้า / ผู้รับ", value: data.recipientName },
                { label: "โทร", value: data.phone },
                { label: "สาขา", value: data.branchName },
                {
                  label: "วันจัดส่ง",
                  value: data.deliveryDate
                    ? `${data.deliveryDate}${data.statusTimeRange ? ` · ${data.statusTimeRange}` : ''}`
                    : null,
                },
                { label: "ที่อยู่", value: data.deliveryAddress, wide: true },
                { label: "ยอดรวม", value: `฿${Number(data.totalIncVat).toLocaleString()}` },
              ]}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHead title={__uiText("เวลาที่ใช้ในแต่ละขั้น")} />
          <div className="p-5">
            <KeyValueGrid
              cols={2}
              items={[
                { label: "สร้าง", value: formatDateTime(timing?.createdAt), mono: true },
                { label: "ออกของ", value: formatDateTime(timing?.shippedAt), mono: true },
                { label: "ส่งถึง", value: formatDateTime(timing?.deliveredAt), mono: true },
                { label: "ยกเลิก", value: formatDateTime(timing?.cancelledAt), mono: true },
                { label: "เวลารอส่ง", value: duration(timing?.toShipMinutes, timing?.toShipSeconds) },
                { label: "เวลาจัดส่ง", value: duration(timing?.shippingMinutes, timing?.shippingSeconds) },
                { label: "รวม (สร้างจนจบ)", value: duration(timing?.totalMinutes, timing?.totalSeconds), wide: true },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHead title={__uiText("คนขับ")} />
        <div className="p-5">
          {courier ? (
            <KeyValueGrid
              cols={3}
              items={[
                { label: "ชื่อ", value: courier.name },
                { label: "โทร", value: courier.phone },
                { label: "ทะเบียน", value: courier.licensePlate },
              ]}
            />
          ) : (
            <p className="text-sm text-gray-400">{__uiText("ยังไม่มีข้อมูลคนขับ")}</p>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHead title={__uiText("หลักฐานการส่ง")} />
        <div className="p-5">
          {pod ? (
            <div className="flex flex-col gap-4">
              <KeyValueGrid
                cols={2}
                items={[
                  { label: "ผู้รับ", value: pod.recipientName },
                  { label: "เวลาที่บันทึก", value: pod.capturedAt ? formatDateTime(pod.capturedAt) : null, mono: true },
                ]}
              />
              <div>
                <h3 className="text-xs font-semibold text-gray-500 mb-2">
                  {__uiText("รูปถ่าย")}</h3>
                <PhotoGrid urls={pod.photoUrls ?? []} emptyLabel={__uiText("ไม่มีรูปถ่าย")} />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-gray-500 mb-2">
                  {__uiText("ลายเซ็น")}</h3>
                <PhotoGrid
                  urls={pod.signatureImageUrls ?? []}
                  emptyLabel={__uiText("ไม่มีลายเซ็น")}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">{__uiText("ยังไม่มีหลักฐานการส่ง")}</p>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHead title={__uiText("สินค้า")} badge={<Chip>{data.itemCount}</Chip>} />
        <ul className="divide-y divide-gray-100 px-5">
          {data.items.map((item) => (
            <li key={item.orderItemId} className="flex gap-3 py-3 items-center">
              <div className="w-14 h-14 rounded border border-gray-200 overflow-hidden bg-gray-50 shrink-0">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.productName}</p>
                <p className="text-xs text-gray-500">
                  {item.quantityLabel}
                  {item.packLabel ? ` · ${item.packLabel}` : ''}
                </p>
              </div>
              <div className="text-sm font-medium shrink-0 tabular-nums text-right">
                {__uiText("฿")}{Number(item.lineTotalIncVat).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
};

export default ShipmentDetailPage;
