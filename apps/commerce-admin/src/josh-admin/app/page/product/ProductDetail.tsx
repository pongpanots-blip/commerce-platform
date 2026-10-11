// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { Button as CpButton, Chip, CopyValue, DetailSection, Empty, KeyValueGrid, Loading, PageHeader, Panel, TableViewport } from '@cp/ui';
import { getProductById } from '@josh/shared-api';
import { ADMIN_PRODUCT_READ } from '../../config/admin-product-read';
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
    return <div className="cp-management-page"><Loading variant="detail" /></div>;
  }

  if (!product) {
    return <div className="cp-management-page"><Empty icon="inventory_2">{__uiText("ไม่พบข้อมูลสินค้า")}</Empty></div>;
  }

  const translations = (product.translations as Array<Record<string, string>>) ?? [];
  const th = getTranslation(translations, 'th');
  const en = getTranslation(translations, 'en');
  const media = sortProductMedia((product.media as ProductMediaItem[]) ?? []);
  const statusValue = normalizeProductStatus(product.product_status);
  const statusBadge = productStatusBadge(statusValue);
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
  const sku = product.product_inventory_sku ? String(product.product_inventory_sku) : '';
  const longText = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return text ? <span className="whitespace-pre-wrap">{text}</span> : '';
  };

  const formatRestock = (raw: unknown): string => {
    if (raw == null || raw === '') return '-';
    const date = new Date(String(raw));
    if (Number.isNaN(date.getTime())) return String(raw);
    return fmt.when(date);
  };

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <PageHeader
        back={{ to: ADMIN_ROUTES.products, label: 'กลับรายการสินค้า' }}
        title={String(product.product_name ?? th?.product_name ?? __uiText('รายละเอียดสินค้า'))}
        badge={<Chip tone={statusBadge.tone} statusCode={statusValue} dot>{statusBadge.label}</Chip>}
        subtitle={sku ? <span className="font-mono">{sku} <CopyValue value={sku} /></span> : undefined}
        actions={
          <CpButton
            variant="primary"
            icon="edit"
            onClick={() => id && navigate(ADMIN_ROUTES.productEdit(id))}
          >
            {__uiText("แก้ไขสินค้า")}
          </CpButton>
        }
      />

      <Panel className="p-5 flex flex-col gap-6">
        <DetailSection title={__uiText("ข้อมูลหลัก")}>
          <KeyValueGrid
            cols={2}
            items={[
              {
                label: __uiText("ราคาขาย"),
                value: `${fmt.baht(basePrice)}/${String(product.selling_unit ?? product.product_unit ?? __uiText('ชิ้น'))}`,
              },
              ...(promotionSummary ? [{ label: __uiText("โปรโมชัน"), value: promotionSummary }] : []),
              {
                label: __uiText("สต็อก"),
                value: `${fmt.num(Number(product.product_inventory_quantity ?? 0))} ${__uiText('ชิ้น')}`,
              },
              { label: __uiText("แบรนด์"), value: String(product.brand_name ?? '') },
              { label: __uiText("ผู้ขาย"), value: String(product.marketed_by ?? '') },
              { label: __uiText("ภาษีมูลค่าเพิ่ม"), value: String(product.vat_type ?? '') },
              { label: __uiText("หมวดหมู่"), value: String(product.category_names_path ?? '') },
              { label: __uiText("อุณหภูมิเก็บรักษา"), value: String(product.storage_temperature ?? '') },
              { label: __uiText("คาดว่าจะมีสต็อกเข้า"), value: formatRestock(product.expected_restock_at) },
              { label: __uiText("วิธีเก็บรักษา"), value: longText(product.storage_instruction), wide: true },
              { label: __uiText("วิธีใช้"), value: longText(product.usage_direction), wide: true },
            ]}
          />
        </DetailSection>

        {id && (
          <DetailSection title={__uiText("ลิงก์สินค้าสำหรับการตลาด")}>
            <p className="text-xs text-on-surface-variant">
              {__uiText("ลิงก์เดียวใช้ได้ทุกเครื่อง มือถือจะเปิดแอปหรือร้านแอป ส่วนคอมพิวเตอร์จะเปิดหน้าสินค้าบนเว็บ ใช้กับโฆษณาได้เลย")}</p>
            <MarketingLinkField type="product" id={id} />
            <div className="mt-3">
              <SmartLinkField type="product" id={id} />
            </div>
          </DetailSection>
        )}

        {promotionRows.length > 0 && (
          <DetailSection title={__uiText("ราคาตามจำนวน (จากโปรโมชัน)")}>
            <p className="text-xs text-on-surface-variant">
              {__uiText("แก้ไขได้ที่หน้าโปรโมชันเท่านั้น")}</p>
            <div className="overflow-hidden rounded-xl border border-gray-100">
              <TableViewport><table className="cp-data-table min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-right" scope="col">{__uiText("ซื้อขั้นต่ำ")}</th>
                    <th className="px-4 py-2 text-right" scope="col">{__uiText("ราคาโปร")}</th>
                  </tr>
                </thead>
                <tbody>
                  {promotionRows.map((rule) => (
                    <tr key={`${rule.min_qty}-${rule.promotion_price}`} className="border-t">
                      <td className="px-4 py-2 text-right tabular-nums">
                        {rule.min_qty} {rule.unit_label ?? __uiText("ชิ้น")}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">
                        {fmt.baht(rule.promotion_price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></TableViewport>
            </div>
          </DetailSection>
        )}

        <DetailSection title={__uiText("ชื่อและรายละเอียด")}>
          <KeyValueGrid
            cols={2}
            items={[
              { label: __uiText("ชื่อภาษาไทย"), value: th?.product_name ?? '' },
              { label: __uiText("ชื่อภาษาอังกฤษ"), value: en?.product_name ?? '' },
              { label: __uiText("รายละเอียดภาษาไทย"), value: longText(th?.product_description), wide: true },
              { label: __uiText("รายละเอียดภาษาอังกฤษ"), value: longText(en?.product_description), wide: true },
            ]}
          />
        </DetailSection>

        <DetailSection title={__uiText("ส่วนประกอบและวันหมดอายุ")}>
          <KeyValueGrid
            cols={2}
            items={[
              { label: __uiText("ส่วนประกอบ"), value: longText(product.ingredients), wide: true },
              { label: __uiText("สารก่อภูมิแพ้"), value: longText(product.allergens), wide: true },
              { label: __uiText("ข้อมูลวันหมดอายุ"), value: longText(product.expiration_info), wide: true },
            ]}
          />
        </DetailSection>

        <DetailSection title={__uiText("ข้อมูลโภชนาการ")}>
          {nutrition ? (
            <>
              {nutrition.basis && (
                <p className="text-xs text-gray-500">{nutrition.basis}</p>
              )}
              <div className="overflow-hidden rounded-xl border border-gray-100">
                <TableViewport><table className="cp-data-table min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-2" scope="col">{__uiText("สารอาหาร")}</th>
                      <th className="px-4 py-2 text-right" scope="col">{__uiText("ค่า")}</th>
                      <th className="px-4 py-2" scope="col">{__uiText("หน่วย")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nutrition.items.map((item, index) => (
                      <tr key={`${item.label}-${index}`} className="border-t">
                        <td className="px-4 py-2">{item.label}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{item.value || '-'}</td>
                        <td className="px-4 py-2">{item.unit || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></TableViewport>
              </div>
            </>
          ) : (
            <Empty>{__uiText("ยังไม่มีข้อมูลโภชนาการ เพิ่มได้ที่หน้าแก้ไขสินค้า")}</Empty>
          )}
        </DetailSection>

        <DetailSection title={__uiText("สื่อสินค้า")}>
          {media.length === 0 ? (
            <Empty icon="image">{__uiText("ยังไม่มีรูปภาพหรือวิดีโอ เพิ่มได้ที่หน้าแก้ไขสินค้า")}</Empty>
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
        </DetailSection>

        {id && <ProductCustomerPricingSection productId={id} />}
      </Panel>
    </div>
  );
};

export default ProductDetail;
