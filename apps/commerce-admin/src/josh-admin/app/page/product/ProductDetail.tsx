// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getProductById } from '@josh/shared-api';
import { ADMIN_PRODUCT_READ } from '../../config/admin-product-read';
import { Button } from '@josh/shared-ui-web';
import { LoadError } from '../../components/LoadError';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { MarketingLinkField } from '../../components/MarketingLinkField';
import { SmartLinkField } from '../../components/SmartLinkField';
import {
  getTranslation,
  ProductMediaItem,
  resolveMediaUrl,
  sortProductMedia,
} from './product-media.helpers';
import ProductCustomerPricingSection from './ProductCustomerPricingSection';
import {
  formatPromotionSummary,
  parsePromotionRows,
} from '../campain/promotion-mechanic.helpers';
import { catalogSellingPrice } from './catalog-price';
import { nutritionForDisplay } from './product-nutrition.helpers';
import { normalizeProductStatus, productStatusBadge } from './product-status.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { fmt, uiText as __uiText, useUiLocale as __useUiLocale } from "@cp/ui";
function MediaPreview({ item }: { item: ProductMediaItem }) {
  __useUiLocale();
  const [failed, setFailed] = useState(false);
  const url = resolveMediaUrl(item.source);
  const isVideo = item.media_type === 'video';

  if (!url || failed) {
    return (
      <div className="w-full h-40 flex items-center justify-center bg-gray-100 text-xs text-gray-400">
        {__uiText("โหลดสื่อไม่สำเร็จ")}</div>
    );
  }

  if (isVideo) {
    return (
      <video
        src={url}
        controls
        playsInline
        className="w-full h-40 object-cover bg-black"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <img
      src={url}
      alt={__uiText("product media")}
      className="w-full h-40 object-cover"
      onError={() => setFailed(true)}
    />
  );
}

const ProductDetail = () => {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [product, setProduct] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);

    getProductById(id, ADMIN_PRODUCT_READ)
      .then((response) => {
        setProduct(response.data ?? null);
      })
      .catch((error: unknown) => setLoadError(error))
      .finally(() => setLoading(false));
  }, [id, reload]);

  if (loadError) return <LoadError title={__uiText('รายละเอียดสินค้า')} error={loadError} onRetry={() => setReload(value => value + 1)} />;
  if (loading) {
    return <div className="cp-management-page text-sm text-gray-500">{__uiText("กำลังโหลด...")}</div>;
  }

  if (!product) {
    return <div className="cp-management-page text-sm text-red-500">{__uiText("ไม่พบข้อมูลสินค้า")}</div>;
  }

  const translations = (product.translations as Array<Record<string, string>>) ?? [];
  const th = getTranslation(translations, 'th');
  const en = getTranslation(translations, 'en');
  const media = sortProductMedia((product.media as ProductMediaItem[]) ?? []);
  const statusBadge = productStatusBadge(normalizeProductStatus(product.product_status));
  const promotionRows = parsePromotionRows(
    product.promotion_rules ?? product.tier_prices,
  );
  const promotionSummary =
    promotionRows.length > 0
      ? formatPromotionSummary(promotionRows)
      : null;
  // Catalog price — the payload is priced like the shop (promotion / special price move selling_unit_price).
  const basePrice = Number(catalogSellingPrice(product) ?? 0);
  const nutrition = nutritionForDisplay(product.nutrition);

  const formatRestock = (raw: unknown): string => {
    if (raw == null || raw === '') return '-';
    const date = new Date(String(raw));
    if (Number.isNaN(date.getTime())) return String(raw);
    return fmt.when(date);
  };

  return (
    <div className="cp-management-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <button
            type="button"
            onClick={() => navigate(ADMIN_ROUTES.products)}
            className="text-sm text-gray-500 hover:text-gray-800 mb-2"
          >
            {__uiText("← กลับรายการสินค้า")}</button>
          <h1 className="text-2xl font-bold text-gray-900">
            {String(product.product_name ?? th?.product_name ?? 'รายละเอียดสินค้า')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {__uiText("รหัสสินค้า")} {String(product.product_inventory_sku ?? '—')}
            {product.product_inventory_sku ? (
              <button
                type="button"
                className="ml-2 text-xs text-gray-400 hover:text-gray-700"
                onClick={() => { void navigator.clipboard?.writeText(String(product.product_inventory_sku)); }}
              >
                {__uiText("คัดลอก")}
              </button>
            ) : null}
          </p>
        </div>
        <Button
          text={__uiText("แก้ไขสินค้า")}
          onClick={() => id && navigate(ADMIN_ROUTES.productEdit(id))}
        />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-6">
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoRow label={__uiText("สถานะ")} value={statusBadge.label} />
          <InfoRow
            label={__uiText("ราคาขาย")}
            value={`฿${basePrice.toLocaleString()}/${String(product.selling_unit ?? product.product_unit ?? 'ชิ้น')}`}
          />
          {promotionSummary && (
            <InfoRow
              label={__uiText("โปรโมชัน")}
              value={promotionSummary}
            />
          )}
          <InfoRow
            label={__uiText("สต็อก")}
            value={`${Number(product.product_inventory_quantity ?? 0).toLocaleString()} ชิ้น`}
          />
          <InfoRow label={__uiText("แบรนด์")} value={String(product.brand_name ?? '-')} />
          <InfoRow label={__uiText("ผู้ขาย")} value={String(product.marketed_by ?? '')} />
          <InfoRow label={__uiText("ภาษีมูลค่าเพิ่ม")} value={String(product.vat_type ?? '')} />
          <InfoRow label={__uiText("หมวดหมู่")} value={String(product.category_names_path ?? '-')} />
          <InfoRow
            label={__uiText("อุณหภูมิเก็บรักษา")}
            value={String(product.storage_temperature ?? '-')}
          />
          <InfoRow
            label={__uiText("วิธีเก็บรักษา")}
            value={String(product.storage_instruction ?? '-')}
            wide
          />
          <InfoRow
            label={__uiText("วิธีใช้")}
            value={String(product.usage_direction ?? '-')}
            wide
          />
          <InfoRow
            label={__uiText("คาดว่าจะมีสต็อกเข้า")}
            value={formatRestock(product.expected_restock_at)}
          />
        </section>

        {id && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-1">
              {__uiText("ลิงก์สินค้า (สำหรับ Marketing)")}</h2>
            <p className="text-xs text-gray-400 mb-3">
              {__uiText("ลิงก์เดียว — มือถือเด้งเข้าแอป/สโตร์ (deferred deep link) ส่วน desktop เปิดหน้าเว็บสินค้า เอาไปยิง ads ได้เลย")}</p>
            <MarketingLinkField type="product" id={id} />
            <div className="mt-3">
              <SmartLinkField type="product" id={id} />
            </div>
          </section>
        )}

        {promotionRows.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-1">
              {__uiText("ราคาตามจำนวน (จาก Promotion Mechanic)")}</h2>
            <p className="text-xs text-gray-400 mb-3">
              {__uiText("แก้ไขได้ที่เมนู Promotion Mechanic เท่านั้น")}</p>
            <div className="overflow-hidden rounded-xl border border-gray-100">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2">{__uiText("ซื้อขั้นต่ำ")}</th>
                    <th className="px-4 py-2">{__uiText("ราคาโปร")}</th>
                  </tr>
                </thead>
                <tbody>
                  {promotionRows.map((rule) => (
                    <tr key={`${rule.min_qty}-${rule.promotion_price}`} className="border-t">
                      <td className="px-4 py-2">
                        {rule.min_qty} {rule.unit_label ?? __uiText("ชิ้น")}
                      </td>
                      <td className="px-4 py-2 font-semibold">
                        {__uiText("฿")}{rule.promotion_price.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">{__uiText("ชื่อและรายละเอียด (TH)")}</h2>
          <p className="font-medium text-gray-900">{th?.product_name ?? '-'}</p>
          <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">
            {th?.product_description ?? '-'}
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">{__uiText("ชื่อและรายละเอียด (EN)")}</h2>
          <p className="font-medium text-gray-900">{en?.product_name ?? '-'}</p>
          <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">
            {en?.product_description ?? '-'}
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoRow
            label={__uiText("ส่วนประกอบ")}
            value={String(product.ingredients ?? '-')}
            wide
          />
          <InfoRow
            label={__uiText("สารก่อภูมิแพ้")}
            value={String(product.allergens ?? '-')}
            wide
          />
          <InfoRow
            label={__uiText("ข้อมูลวันหมดอายุ")}
            value={String(product.expiration_info ?? '-')}
            wide
          />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-1">
            {__uiText("ข้อมูลโภชนาการ")}</h2>
          {nutrition ? (
            <>
              {nutrition.basis && (
                <p className="text-xs text-gray-500 mb-3">{nutrition.basis}</p>
              )}
              <div className="overflow-hidden rounded-xl border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-2">{__uiText("สารอาหาร")}</th>
                      <th className="px-4 py-2">{__uiText("ค่า")}</th>
                      <th className="px-4 py-2">{__uiText("หน่วย")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nutrition.items.map((item, index) => (
                      <tr key={`${item.label}-${index}`} className="border-t">
                        <td className="px-4 py-2">{item.label}</td>
                        <td className="px-4 py-2">{item.value || '-'}</td>
                        <td className="px-4 py-2">{item.unit || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">{__uiText("ยังไม่มีข้อมูลโภชนาการ")}</p>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">{__uiText("สื่อสินค้า")}</h2>
          {media.length === 0 ? (
            <p className="text-sm text-gray-400">{__uiText("ยังไม่มีรูปภาพหรือวิดีโอ")}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {media.map((item) => (
                <div
                  key={item.product_media_id}
                  className="border rounded-xl overflow-hidden bg-gray-50"
                >
                  <MediaPreview item={item} />
                  <div className="px-3 py-2 text-xs text-gray-500 flex justify-between">
                    <span>{item.media_type === 'video' ? __uiText("วิดีโอ") : __uiText("รูปภาพ")}</span>
                    <span>{__uiText("ลำดับ ")}{item.sort_order}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {id && <ProductCustomerPricingSection productId={id} />}
      </div>
    </div>
  );
};

function InfoRow({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 ${wide ? 'md:col-span-2' : ''}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900 mt-1 whitespace-pre-wrap">{value || '—'}</p>
    </div>
  );
}

export default ProductDetail;
