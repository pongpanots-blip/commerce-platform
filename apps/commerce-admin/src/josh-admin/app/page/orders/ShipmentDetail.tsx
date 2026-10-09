// ui-metadata-migration: static labels and UI notices only
import {
  formatShipmentDuration,
  formatShipmentDurationMinutes,
  getShipmentById,
  type ShipmentDetail,
} from '@josh/shared-api';
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { PageHeader, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS_LABELS: Record<string, string> = {
  get to_ship(){return __uiText("รอส่ง");},
  get shipping(){return __uiText("กำลังจัดส่ง");},
  get delivered(){return __uiText("ส่งแล้ว");},
  get cancelled(){return __uiText("ยกเลิก");},
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
  const navigate = useNavigate();
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
        <PageHeader title={__uiText("Shipment")} />
        <p className="text-sm text-red-600">{error || __uiText("ไม่พบข้อมูล")}</p>
        <button
          type="button"
          className="w-fit text-sm text-primary hover:underline"
          onClick={() => navigate(ADMIN_ROUTES.shipments)}
        >
          {__uiText("← กลับรายการ Shipments")}</button>
      </div>
    );
  }

  const courier = data.tracking?.courier ?? null;
  const pod = data.tracking?.proofOfDelivery ?? null;
  const timing = data.timing;

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            className="text-sm text-gray-500 hover:text-primary mb-1"
            onClick={() => navigate(ADMIN_ROUTES.shipments)}
          >
            {__uiText("← Shipments")}</button>
          <PageHeader title={data.shipmentNumber} />
          <p className="text-sm text-gray-500 mt-1">
            {data.shipmentIndexLabel}
            {data.status ? ` · ${STATUS_LABELS[data.status] ?? data.statusLabel}` : __uiText(" · รอชำระ")}
          </p>
        </div>
        {data.orderId ? (
          <Link
            to={ADMIN_ROUTES.orderDetail(data.orderId)}
            className="inline-flex items-center rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            {__uiText("เปิด Order ")}{data.orderNumber || data.orderId.slice(0, 8)}
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">{__uiText("สรุป")}</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">{__uiText("ลูกค้า / ผู้รับ")}</dt>
            <dd>{data.recipientName || '-'}</dd>
            <dt className="text-gray-500">{__uiText("โทร")}</dt>
            <dd>{data.phone || '-'}</dd>
            <dt className="text-gray-500">{__uiText("สาขา")}</dt>
            <dd>{data.branchName || '-'}</dd>
            <dt className="text-gray-500">{__uiText("วันจัดส่ง")}</dt>
            <dd>
              {data.deliveryDate || '-'}
              {data.statusTimeRange ? ` · ${data.statusTimeRange}` : ''}
            </dd>
            <dt className="text-gray-500">{__uiText("ที่อยู่")}</dt>
            <dd className="col-span-1">{data.deliveryAddress || '-'}</dd>
            <dt className="text-gray-500">{__uiText("ยอดรวม")}</dt>
            <dd className="font-medium">
              {__uiText("฿")}{Number(data.totalIncVat).toLocaleString()}
            </dd>
          </dl>
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">
            {__uiText("Timing / Analytics")}</h2>
          <dl className="grid grid-cols-1 gap-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{__uiText("สร้าง")}</dt>
              <dd className="font-mono text-xs">
                {formatDateTime(timing?.createdAt)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{__uiText("ออกของ (shipped)")}</dt>
              <dd className="font-mono text-xs">
                {formatDateTime(timing?.shippedAt)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{__uiText("ส่งถึง")}</dt>
              <dd className="font-mono text-xs">
                {formatDateTime(timing?.deliveredAt)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{__uiText("ยกเลิก")}</dt>
              <dd className="font-mono text-xs">
                {formatDateTime(timing?.cancelledAt)}
              </dd>
            </div>
            <hr className="my-1 border-gray-100" />
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{__uiText("เวลารอส่ง")}</dt>
              <dd className="font-medium">
                {timing?.toShipMinutes != null
                  ? formatShipmentDurationMinutes(timing.toShipMinutes)
                  : formatShipmentDuration(timing?.toShipSeconds)}
                {timing?.toShipMinutes != null ? (
                  <span className="ml-1 text-xs text-gray-400">
                    ({__uiText("{0} นาที", {"0": timing.toShipMinutes})})</span>
                ) : null}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{__uiText("เวลาจัดส่ง")}</dt>
              <dd className="font-medium">
                {timing?.shippingMinutes != null
                  ? formatShipmentDurationMinutes(timing.shippingMinutes)
                  : formatShipmentDuration(timing?.shippingSeconds)}
                {timing?.shippingMinutes != null ? (
                  <span className="ml-1 text-xs text-gray-400">
                    ({__uiText("{0} นาที", {"0": timing.shippingMinutes})})</span>
                ) : null}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{__uiText("รวม (สร้าง→จบ)")}</dt>
              <dd className="font-semibold text-primary">
                {timing?.totalMinutes != null
                  ? formatShipmentDurationMinutes(timing.totalMinutes)
                  : formatShipmentDuration(timing?.totalSeconds)}
                {timing?.totalMinutes != null ? (
                  <span className="ml-1 text-xs font-normal text-gray-400">
                    ({__uiText("{0} นาที", {"0": timing.totalMinutes})})</span>
                ) : null}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">{__uiText("Courier")}</h2>
        {courier ? (
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">{__uiText("ชื่อ")}</dt>
              <dd className="font-medium">{courier.name || '-'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">{__uiText("โทร")}</dt>
              <dd>{courier.phone || '-'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">{__uiText("ทะเบียน")}</dt>
              <dd>{courier.licensePlate || '-'}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-gray-400">{__uiText("ยังไม่มีข้อมูลคนขับ")}</p>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">
          {__uiText("Proof of Delivery")}</h2>
        {pod ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">
              {__uiText("ผู้รับ: ")}<span className="font-medium">{pod.recipientName || '-'}</span>
              {pod.capturedAt ? (
                <span className="text-gray-400">
                  {' '}
                  · {formatDateTime(pod.capturedAt)}
                </span>
              ) : null}
            </p>
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
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">
          {__uiText("สินค้า (")}{data.itemCount})
        </h2>
        <ul className="divide-y divide-gray-100">
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
              <div className="text-sm font-medium shrink-0">
                {__uiText("฿")}{Number(item.lineTotalIncVat).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default ShipmentDetailPage;
