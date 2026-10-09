// ui-metadata-migration: static labels and UI notices only
import { TableViewport } from '@cp/ui';
import {
  getOrderPaymentQr,
  getProducts,
  placeOrderOnBehalf,
  quoteOrderOnBehalf,
  resolveCsProductSkus,
  type CsResolvedProductSku,
} from '@josh/shared-api';
import { ADMIN_PRODUCT_READ } from '../../config/admin-product-read';
import { Input, Select } from '@josh/shared-ui-web';
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AiOutlineSearch } from 'react-icons/ai';
import { MdInsertDriveFile } from 'react-icons/md';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { normalizeSearchProduct } from '../carousels/carousel-product.helpers';
import {
  aggregateCsvQuantities,
  CS_PLACE_ORDER_CSV_TEMPLATE,
  parseCsPlaceOrderCsv,
} from './cs-place-order-csv.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type BranchOption = {
  id: string;
  name: string;
  delivery_address: string | null;
};

type CartLine = {
  product_inventory_id: string;
  sku: string;
  name: string;
  quantity: number;
};

type QuoteLine = CartLine & {
  unit_price_inc_vat: number;
  line_total_inc_vat: number;
  price_source?: string | null;
};

type QuoteTotals = {
  subtotal_inc_vat: number;
  vat_amount: number;
  delivery_fee: number;
  total_inc_vat: number;
};

type PaymentMethod = 'customer_credit' | 'qr' | 'cod' | 'credit';

type CreatedOrder = {
  orderIds: string[];
  orderNumbers: string[];
  paymentPending: boolean;
  paymentMethod: PaymentMethod;
};

type Props = {
  userId: string;
  branches: BranchOption[];
  onMessage?: (message: string) => void;
};

function formatCurrency(value: number) {
  return `฿${Number(value).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const PAYMENT_OPTIONS: Array<{
  value: PaymentMethod;
  label: string;
  hint: string;
}> = [
  {
    value: 'customer_credit',
    get label(){return __uiText("เครดิตลูกค้า");},
    get hint(){return __uiText("ยืนยันออเดอร์ทันที (ไม่ต้องชำระเพิ่ม)");},
  },
  {
    value: 'qr',
    get label(){return __uiText("QR PromptPay");},
    get hint(){return __uiText("สร้างออเดอร์รอชำระ — ส่ง QR ให้ลูกค้า");},
  },
  {
    value: 'cod',
    get label(){return __uiText("เก็บเงินปลายทาง");},
    get hint(){return __uiText("สร้างออเดอร์รอชำระเมื่อจัดส่ง");},
  },
  {
    value: 'credit',
    get label(){return __uiText("เครดิตบริษัท");},
    get hint(){return __uiText("ใช้วงเงินเครดิตบริษัท");},
  },
];

export function CsPlaceOrderPanel({ userId, branches, onMessage }: Props) {
  __useUiLocale();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResult, setSearchResult] = useState<
    ReturnType<typeof normalizeSearchProduct>[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [quoteLines, setQuoteLines] = useState<QuoteLine[]>([]);
  const [quoteTotals, setQuoteTotals] = useState<QuoteTotals | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>('customer_credit');
  const [couponCode, setCouponCode] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [placing, setPlacing] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportSummary, setCsvImportSummary] = useState('');
  const [csvMissingSkus, setCsvMissingSkus] = useState<string[]>([]);

  useEffect(() => {
    if (!branchId && branches[0]?.id) {
      setBranchId(branches[0].id);
    }
  }, [branchId, branches]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setSearchResult([]);
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const response: any = await getProducts(1, 20, searchTerm.trim(), ADMIN_PRODUCT_READ);
          const body = response?.data ?? response;
          const rows = Array.isArray(body?.data)
            ? body.data
            : Array.isArray(body?.data?.data)
              ? body.data.data
              : Array.isArray(body)
                ? body
                : [];
          setSearchResult(
            rows.map((row: Record<string, unknown>) =>
              normalizeSearchProduct(row),
            ),
          );
        } catch {
          setSearchResult([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (!branchId || lines.length === 0) {
      setQuoteLines([]);
      setQuoteTotals(null);
      setQuoteError('');
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        setQuoting(true);
        setQuoteError('');
        try {
          const response: any = await quoteOrderOnBehalf({
            user_id: userId,
            branch_id: branchId,
            items: lines.map((line) => ({
              product_inventory_id: line.product_inventory_id,
              quantity: line.quantity,
            })),
          });
          const data = response?.data?.data ?? response?.data;
          setQuoteLines(data?.items ?? []);
          setQuoteTotals({
            subtotal_inc_vat: Number(data?.subtotal_inc_vat ?? 0),
            vat_amount: Number(data?.vat_amount ?? 0),
            delivery_fee: Number(data?.delivery_fee ?? 0),
            total_inc_vat: Number(data?.total_inc_vat ?? 0),
          });
        } catch (error: any) {
          setQuoteLines([]);
          setQuoteTotals(null);
          setQuoteError(
            error?.response?.data?.message ?? __uiMessage("ไม่สามารถคำนวณราคาได้"),
          );
        } finally {
          setQuoting(false);
        }
      })();
    }, 400);

    return () => window.clearTimeout(timer);
  }, [branchId, lines, userId]);

  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === branchId),
    [branches, branchId],
  );

  const addProduct = (row: ReturnType<typeof normalizeSearchProduct>) => {
    if (!row.id) return;
    setCreatedOrder(null);
    setQrUrl(null);
    setLines((prev) => {
      const existing = prev.find(
        (line) => line.product_inventory_id === row.id,
      );
      if (existing) {
        return prev.map((line) =>
          line.product_inventory_id === row.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [
        ...prev,
        {
          product_inventory_id: row.id,
          sku: row.sku,
          name: row.name,
          quantity: 1,
        },
      ];
    });
    setSearchTerm('');
    setSearchResult([]);
  };

  const updateQuantity = (productId: string, quantity: number) => {
    const safeQty = Math.max(1, quantity);
    setCreatedOrder(null);
    setQrUrl(null);
    setLines((prev) =>
      prev.map((line) =>
        line.product_inventory_id === productId
          ? { ...line, quantity: safeQty }
          : line,
      ),
    );
  };

  const removeLine = (productId: string) => {
    setCreatedOrder(null);
    setQrUrl(null);
    setLines((prev) =>
      prev.filter((line) => line.product_inventory_id !== productId),
    );
  };

  const mergeResolvedProducts = (
    products: CsResolvedProductSku[],
    quantityBySku: Map<string, number>,
  ) => {
    setCreatedOrder(null);
    setQrUrl(null);
    setLines((prev) => {
      const next = [...prev];
      for (const product of products) {
        const quantity = quantityBySku.get(product.sku) ?? 1;
        const existing = next.find(
          (line) => line.product_inventory_id === product.product_inventory_id,
        );
        if (existing) {
          existing.quantity += quantity;
          continue;
        }
        next.push({
          product_inventory_id: product.product_inventory_id,
          sku: product.sku,
          name: product.name,
          quantity,
        });
      }
      return next;
    });
  };

  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        const text = String(reader.result ?? '');
        const parsedRows = parseCsPlaceOrderCsv(text);
        if (!parsedRows.length) {
          setCsvImportSummary('ไม่พบข้อมูลในไฟล์ CSV');
          setCsvMissingSkus([]);
          onMessage?.('ไม่พบข้อมูลในไฟล์ CSV');
          return;
        }

        const quantityBySku = aggregateCsvQuantities(parsedRows);
        const skus = [...quantityBySku.keys()];

        setCsvImporting(true);
        setCsvImportSummary('');
        setCsvMissingSkus([]);
        try {
          const response: any = await resolveCsProductSkus(skus);
          const data = response?.data?.data ?? response?.data ?? {};
          const found = (data.found ?? []) as CsResolvedProductSku[];
          const missing = (data.missing ?? []) as string[];

          if (!found.length) {
            setCsvImportSummary(`ไม่พบ SKU ในระบบ (${missing.length} รายการ)`);
            setCsvMissingSkus(missing);
            onMessage?.('ไม่พบ SKU ในระบบ');
            return;
          }

          mergeResolvedProducts(found, quantityBySku);
          setCsvMissingSkus(missing);
          setCsvImportSummary(
            missing.length
              ? `นำเข้า ${found.length} SKU สำเร็จ — ไม่พบ ${missing.length} SKU`
              : `นำเข้า ${found.length} SKU สำเร็จ`,
          );
          onMessage?.(
            missing.length
              ? `นำเข้า CSV แล้ว — ไม่พบ SKU ${missing.length} รายการ`
              : 'นำเข้า CSV แล้ว',
          );
        } catch (error: any) {
          const message =
            error?.response?.data?.message ?? 'นำเข้า CSV ไม่สำเร็จ';
          setCsvImportSummary(message);
          setCsvMissingSkus([]);
          onMessage?.(message);
        } finally {
          setCsvImporting(false);
        }
      })();
    };
    reader.readAsText(file);
  };

  const placeOrder = async () => {
    if (!branchId) {
      onMessage?.('กรุณาเลือกสาขา');
      return;
    }
    if (lines.length === 0) {
      onMessage?.('กรุณาเพิ่มสินค้า');
      return;
    }

    setPlacing(true);
    setQrUrl(null);
    try {
      const response: any = await placeOrderOnBehalf({
        user_id: userId,
        branch_id: branchId,
        payment_method: paymentMethod,
        items: lines.map((line) => ({
          product_inventory_id: line.product_inventory_id,
          quantity: line.quantity,
        })),
        ...(couponCode.trim() ? { coupon_code: couponCode.trim() } : {}),
        ...(deliveryDate.trim() ? { delivery_date: deliveryDate.trim() } : {}),
      });
      const data = response?.data?.data ?? response?.data;
      const result: CreatedOrder = {
        orderIds: data?.orderIds ?? [],
        orderNumbers: data?.orderNumbers ?? [],
        paymentPending: Boolean(data?.paymentPending),
        paymentMethod,
      };
      setCreatedOrder(result);
      onMessage?.('สร้างออเดอร์แทนลูกค้าแล้ว');

      if (paymentMethod === 'qr' && result.orderIds[0]) {
        setQrLoading(true);
        try {
          const qrRes: any = await getOrderPaymentQr(result.orderIds[0]);
          setQrUrl(qrRes?.data?.data?.qr_code_url ?? null);
        } finally {
          setQrLoading(false);
        }
      }
    } catch (error: any) {
      onMessage?.(error?.response?.data?.message ?? 'สร้างออเดอร์ไม่สำเร็จ');
    } finally {
      setPlacing(false);
    }
  };

  const loadQrForOrder = async (orderId: string) => {
    setQrLoading(true);
    try {
      const qrRes: any = await getOrderPaymentQr(orderId);
      setQrUrl(qrRes?.data?.data?.qr_code_url ?? null);
    } catch {
      onMessage?.('สร้าง QR ไม่สำเร็จ');
    } finally {
      setQrLoading(false);
    }
  };

  if (branches.length === 0) {
    return (
      <p className="text-sm text-amber-700">
        {__uiText("ผู้ใช้ไม่มีสาขา — เพิ่มสาขาก่อนสั่งซื้อแทนลูกค้า")}</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label={__uiText("สาขา")}
          value={branchId}
          onChange={(event) => {
            setBranchId(event.target.value);
            setCreatedOrder(null);
            setQrUrl(null);
          }}
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
        {selectedBranch?.delivery_address && (
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <span className="font-medium text-gray-700">{__uiText("ที่อยู่จัดส่ง: ")}</span>
            {selectedBranch.delivery_address}
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-gray-100 p-3">
        <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
          <div className="text-sm font-medium text-gray-800">{__uiText("ค้นหา SKU / สินค้า")}</div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20">
              <MdInsertDriveFile size={16} />
              <span>{csvImporting ? __uiText("กำลังนำเข้า...") : __uiText("นำเข้า CSV")}</span>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                disabled={csvImporting}
                onChange={handleCsvUpload}
              />
            </label>
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(CS_PLACE_ORDER_CSV_TEMPLATE)}`}
              download="cs-place-order-template.csv"
              className="text-xs text-primary underline"
            >
              {__uiText("ดาวน์โหลด template")}</a>
          </div>
        </div>
        <label htmlFor="cs-place-order-search" className="mb-1 block text-sm text-gray-600">
          {__uiText("ค้นหาสินค้า")}</label>
        <div className="relative">
          <AiOutlineSearch className="pointer-events-none absolute left-3 top-2.5 text-gray-400" />
          <Input
            id="cs-place-order-search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={__uiText("พิมพ์ SKU หรือชื่อสินค้า...")}
          />
        </div>
        {searching && <p className="text-xs text-gray-400">{__uiText("กำลังค้นหา...")}</p>}
        {!searching && searchResult.length > 0 && (
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-gray-100 p-2">
            {searchResult.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => addProduct(row)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50"
              >
                <span>
                  <span className="font-mono text-xs text-gray-500">{row.sku}</span>
                  <span className="ml-2 text-gray-800">{row.name}</span>
                </span>
                <span className="text-xs font-medium text-gray-700">
                  {formatCurrency(row.price)}
                </span>
              </button>
            ))}
          </div>
        )}
        {csvImportSummary && (
          <p className="text-xs text-gray-600">{csvImportSummary}</p>
        )}
        {csvMissingSkus.length > 0 && (
          <p className="text-xs text-amber-700">
            {__uiText("SKU ไม่พบ: ")}{csvMissingSkus.join(', ')}
          </p>
        )}
      </div>

      {lines.length > 0 && (
        <TableViewport className="overflow-x-auto rounded-lg border border-gray-100">
          <table className="cp-data-table min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2" scope="col">{__uiText("SKU")}</th>
                <th className="px-3 py-2" scope="col">{__uiText("สินค้า")}</th>
                <th className="px-3 py-2" scope="col">{__uiText("ราคา/หน่วย")}</th>
                <th className="px-3 py-2" scope="col">{__uiText("จำนวน")}</th>
                <th className="px-3 py-2" scope="col">{__uiText("รวม")}</th>
                <th className="px-3 py-2" scope="col" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const quoted = quoteLines.find(
                  (row) => row.product_inventory_id === line.product_inventory_id,
                );
                return (
                  <tr key={line.product_inventory_id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono text-xs">{line.sku}</td>
                    <td className="px-3 py-2">{line.name}</td>
                    <td className="px-3 py-2">
                      {quoted
                        ? formatCurrency(quoted.unit_price_inc_vat)
                        : quoting
                          ? '...'
                          : '-'}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        aria-label={__uiText("จำนวน {0}", {"0": line.name})}
                        className="w-20 rounded border border-gray-200 px-2 py-1 text-sm"
                        value={line.quantity}
                        onChange={(event) =>
                          updateQuantity(
                            line.product_inventory_id,
                            Number(event.target.value),
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {quoted
                        ? formatCurrency(quoted.line_total_inc_vat)
                        : quoting
                          ? '...'
                          : '-'}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-xs text-red-500"
                        onClick={() => removeLine(line.product_inventory_id)}
                      >
                        {__uiText("ลบ")}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableViewport>
      )}

      {quoteError && <p className="text-sm text-red-600">{(typeof (quoteError) === 'string' ? __uiText(quoteError) : quoteError)}</p>}

      {quoteTotals && (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>{__uiText("ยอดสินค้า (รวม VAT)")}</span>
            <span>{formatCurrency(quoteTotals.subtotal_inc_vat)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>{__uiText("ค่าจัดส่ง")}</span>
            <span>{formatCurrency(quoteTotals.delivery_fee)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-emerald-100 pt-2 font-semibold text-gray-900">
            <span>{__uiText("ยอดรวมทั้งหมด")}</span>
            <span>{formatCurrency(quoteTotals.total_inc_vat)}</span>
          </div>
          {quoting && (
            <p className="mt-1 text-xs text-gray-500">{__uiText("กำลังคำนวณราคา...")}</p>
          )}
        </div>
      )}

      <div className="grid gap-3 rounded-lg border border-gray-100 p-3 md:grid-cols-2">
        <Input
          label={__uiText("คูปอง (ไม่บังคับ)")}
          value={couponCode}
          onChange={(e) => setCouponCode(e.target.value)}
          placeholder={__uiText("รหัสคูปอง")}
        />
        <Input
          label={__uiText("วันจัดส่ง (ไม่บังคับ)")}
          type="date"
          value={deliveryDate}
          onChange={(e) => setDeliveryDate(e.target.value)}
        />
      </div>

      <div className="space-y-2 rounded-lg border border-gray-100 p-3">
        <div className="text-sm font-medium text-gray-800">
          {__uiText("วิธีชำระเงินของลูกค้า")}</div>
        <div className="grid gap-2 md:grid-cols-2">
          {PAYMENT_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${
                paymentMethod === option.value
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200'
              }`}
            >
              <input
                type="radio"
                name="cs-payment-method"
                className="mr-2"
                checked={paymentMethod === option.value}
                onChange={() => setPaymentMethod(option.value)}
              />
              <span className="font-medium">{option.label}</span>
              <p className="mt-0.5 text-xs text-gray-500">{option.hint}</p>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400">
          {__uiText("Payment Link สำหรับส่งให้ลูกค้าจะเพิ่มในขั้นตอนถัดไป")}</p>
      </div>

      <button
        type="button"
        disabled={placing || quoting || lines.length === 0}
        className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
        onClick={() => void placeOrder()}
      >
        {placing ? __uiText("กำลังสร้างออเดอร์...") : __uiText("สร้างออเดอร์แทนลูกค้า")}
      </button>

      {createdOrder && (
        <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
          <p className="text-sm font-semibold text-gray-900">{__uiText("ออเดอร์ที่สร้างแล้ว")}</p>
          <ul className="space-y-1 text-sm">
            {createdOrder.orderIds.map((orderId, index) => (
              <li key={orderId}>
                <Link
                  to={ADMIN_ROUTES.orderDetail(orderId)}
                  className="text-primary underline"
                >
                  {createdOrder.orderNumbers[index] ?? orderId}
                </Link>
              </li>
            ))}
          </ul>
          {createdOrder.paymentPending && createdOrder.paymentMethod !== 'qr' && (
            <p className="text-xs text-amber-700">
              {__uiText("ออเดอร์รอชำระเงิน — ส่งลิงก์/QR ให้ลูกค้าเมื่อพร้อม")}</p>
          )}
          {createdOrder.paymentMethod === 'qr' && (
            <div className="space-y-2">
              <button
                type="button"
                disabled={qrLoading}
                className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs"
                onClick={() => void loadQrForOrder(createdOrder.orderIds[0])}
              >
                {qrLoading ? __uiText("กำลังสร้าง QR...") : __uiText("สร้าง QR ชำระเงิน")}
              </button>
              {qrUrl && (
                <div className="flex flex-col items-start gap-2">
                  <img
                    src={qrUrl}
                    alt={__uiText("Payment QR")}
                    className="h-40 w-40 rounded border bg-white"
                  />
                  <a
                    href={qrUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline"
                  >
                    {__uiText("เปิดลิงก์ QR")}</a>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CsPlaceOrderPanel;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
