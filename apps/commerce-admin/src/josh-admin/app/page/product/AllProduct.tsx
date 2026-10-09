// ui-metadata-migration: static labels and UI notices only
import { approveProducts, getAdminProducts, rejectErpPending } from '@josh/shared-api';
import { Button, Input, Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useState } from 'react';
import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query';
import {
  AiOutlineEye,
  AiOutlineEdit,
  AiOutlineCheckCircle,
  AiOutlineCloseCircle,
  AiOutlineFilter,
} from 'react-icons/ai';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';
import { catalogSellingPrice } from './catalog-price';
import { PRODUCT_STATUS_OPTIONS, normalizeProductStatus, productStatusBadge } from './product-status.helpers';
import { resolveMediaUrl } from './product-media.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const LIMIT = 10;

type ProductStatusFilter = 'active' | 'inactive' | 'draft' | 'all';

function formatBaht(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return `฿${num.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function hasErpPending(row: any): boolean {
  return row?.erp_pending_payload != null;
}

/** `media[]` from the list endpoint is already sorted; backend swaps in `_thumb.webp` when one exists (see docs/product-image-frontend.md). */
function ProductThumb({ media }: { media?: { source?: string; media_type?: string }[] }) {
  const [failed, setFailed] = useState(false);
  const source = media?.filter((m) => m.media_type === 'image')[0]?.source;
  const url = source ? resolveMediaUrl(source) : '';

  if (!url || failed) {
    return <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200" />;
  }
  return (
    <img
      src={url}
      alt=""
      width={48}
      height={48}
      loading="lazy"
      decoding="async"
      className="w-12 h-12 rounded-lg object-cover bg-gray-100 border border-gray-200"
      onError={() => setFailed(true)}
    />
  );
}

const AllProduct = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState('product_inventory_id');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('ASC');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<ProductStatusFilter>('active');
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [approvedMessage, setApprovedMessage] = useState('');
  const [approveError, setApproveError] = useState('');

  const effectiveFilter = !filter || filter.length > 3 ? filter : '';

  const { data: apiResponse, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-products', currentPage, LIMIT, effectiveFilter, status],
    queryFn: async () => {
      const response: any = await getAdminProducts({
        page: currentPage,
        limit: LIMIT,
        search: effectiveFilter,
        status,
      });
      const backendPayload = response.data;
      return {
        data: backendPayload.data || [],
        totalCount: backendPayload.totalCount || 0,
        page: backendPayload.page || currentPage,
        limit: backendPayload.limit || LIMIT,
      };
    },
    placeholderData: keepPreviousData,
  });

  const approveMutation = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => approveProducts(body),
    onMutate: () => {
      setApprovedMessage('');
      setApproveError('');
    },
    onSuccess: (response: any) => {
      const approved = response?.data?.data?.approved ?? 0;
      setApprovedMessage(`อนุมัติแล้ว ${approved} รายการ`);
      setSelectedIds([]);
      setSelectAllMatching(false);
      refetch();
    },
    onError: () => {
      setApproveError(__uiMessage("อนุมัติสินค้าไม่สำเร็จ"));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => rejectErpPending(body),
    onMutate: () => {
      setApprovedMessage('');
      setApproveError('');
    },
    onSuccess: (response: any) => {
      const rejected = response?.data?.data?.rejected ?? 0;
      setApprovedMessage(`ปฏิเสธการอัปเดตจาก ERP แล้ว ${rejected} รายการ`);
      setSelectedIds([]);
      setSelectAllMatching(false);
      refetch();
    },
    onError: () => {
      setApproveError(__uiMessage("ปฏิเสธการอัปเดตจาก ERP ไม่สำเร็จ"));
    },
  });

  const actionPending = approveMutation.isPending || rejectMutation.isPending;

  const clearApproveFeedback = () => {
    setApprovedMessage('');
    setApproveError('');
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortKey(key);
      setSortOrder('ASC');
    }
  };

  const resetSelection = () => {
    setSelectedIds([]);
    setSelectAllMatching(false);
  };

  const handleStatusChange = (value: string) => {
    setStatus(value as ProductStatusFilter);
    setCurrentPage(1);
    resetSelection();
    clearApproveFeedback();
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    resetSelection();
    clearApproveFeedback();
  };

  const handleSelectRow = (id: string) => {
    setSelectAllMatching(false);
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSelectAll = () => {
    const productList = apiResponse?.data || [];
    if (productList.length === 0) return;

    const allIds = productList.map((o: any) => o.product_inventory_id);
    const isAllSelected = productList.every((row: any) =>
      selectedIds.includes(row.product_inventory_id),
    );

    setSelectAllMatching(false);
    setSelectedIds(isAllSelected ? [] : allIds);
  };

  const totalCount = Number(apiResponse?.totalCount || 0);
  const pageData = apiResponse?.data || [];
  const allPageRowsSelected =
    pageData.length > 0 &&
    pageData.every((row: any) => selectedIds.includes(row.product_inventory_id));
  const showSelectAllMatchingNotice =
    status === 'draft' && allPageRowsSelected && totalCount > pageData.length && !selectAllMatching;

  const columns: TableColumn<any>[] = [
    {
      key: 'media',
      label: __uiText("รูป"),
      render: (value: any) => <ProductThumb media={value} />,
    },
    {
      key: 'product_name',
      label: __uiText("ชื่อสินค้า"),
      render: (value: any) => {
        return (
          <span className="font-semibold text-gray-800 truncate max-w-[200px] block">
            {value ?? __uiText("ไม่มีชื่อสินค้า")}
          </span>
        );
      },
    },
    {
      key: 'category_name_th',
      label: __uiText("หมวดหมู่"),
      render: (_value: any, row: any) => {
        const categoryName = row.category_name_th ?? row.category_name_en ?? null;
        return (
          <span
            className={`font-medium ${!categoryName ? 'text-gray-400 italic' : 'text-gray-700'}`}
          >
            {categoryName ?? __uiText("ไม่มีหมวดหมู่")}
          </span>
        );
      },
    },
    {
      key: 'product_inventory_quantity',
      label: __uiText("จำนวนสต็อก"),
      render: (value: any) => {
        const totalStock = Number(value) || 0;

        return (
          <span
            className={`font-semibold ${totalStock === 0 ? 'text-red-500' : 'text-gray-700'}`}
          >
            {totalStock.toLocaleString()} {__uiText(" ชิ้น")}</span>
        );
      },
    },
    {
      key: 'selling_unit_price',
      label: __uiText("ราคาขายเริ่มต้น"),
      sortable: true,
      render: (value: any, row: any) => {
        const pending = row.erp_pending_payload;
        const pendingSell = pending?.selling_unit_price;
        const pendingOrder = pending?.ordering_price;
        const hasPendingPrice = pendingSell != null || pendingOrder != null;
        // Catalog price — the list is priced like the shop, so a promotion would lower `value`.
        const catalogPrice = catalogSellingPrice(row) ?? value;

        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-gray-900">
              {Number(catalogPrice) > 0 ? formatBaht(catalogPrice) : __uiText("⏳ รอระบุราคา")}
            </span>
            {hasPendingPrice && (
              <span className="text-xs font-medium text-amber-700">
                {__uiText("ERP →")}{' '}
                {pendingSell != null
                  ? formatBaht(pendingSell)
                  : formatBaht(pendingOrder)}
                {row.erp_pending_source ? ` (${row.erp_pending_source})` : ''}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'product_status',
      label: __uiText("สถานะ"),
      render: (value: any, row: any) => {
        const badge = productStatusBadge(normalizeProductStatus(value));
        const pending = hasErpPending(row);

        return (
          <div className="flex flex-col gap-1">
            <span
              className={`px-2.5 py-1 text-xs font-bold rounded-full border ${badge.className}`}
            >
              {badge.label}
            </span>
            {pending && (
              <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full border border-amber-200 bg-amber-50 text-amber-800 w-fit">
                {__uiText("รออนุมัติ ERP")}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: __uiText("เครื่องมือ"),
      render: (_, row) => {
        const productId = row.product_inventory_id;
        const isDraft = normalizeProductStatus(row.product_status) === 'draft';
        const pending = hasErpPending(row);
        const canApprove = isDraft || pending;

        return (
          <div className="flex items-center gap-2">
            <button
              onClick={() => productId && navigate(ADMIN_ROUTES.productDetail(productId))}
              className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
              title={__uiText("ดูรายละเอียด")}
            >
              <AiOutlineEye size={18} />
            </button>

            <button
              onClick={() => productId && navigate(ADMIN_ROUTES.productEdit(productId))}
              className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
              title={__uiText("แก้ไขรายละเอียด")}
            >
              <AiOutlineEdit size={18} />
            </button>

            {canApprove && (
              <button
                onClick={() =>
                  productId && approveMutation.mutate({ ids: [productId] })
                }
                disabled={actionPending}
                className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-30"
                title={pending ? __uiText("อนุมัติการอัปเดตจาก ERP") : __uiText("อนุมัติสินค้า")}
              >
                <AiOutlineCheckCircle size={18} />
              </button>
            )}

            {pending && (
              <button
                onClick={() => {
                  if (!productId) return;
                  if (!window.confirm(__uiText("ปฏิเสธการอัปเดตจาก ERP สำหรับสินค้านี้?"))) return;
                  rejectMutation.mutate({ ids: [productId] });
                }}
                disabled={actionPending}
                className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-30"
                title={__uiText("ปฏิเสธการอัปเดตจาก ERP")}
              >
                <AiOutlineCloseCircle size={18} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-4">
      <AdminListHeader
        title={__uiText("Product List")}
        subtitle={__uiText("รายการสินค้าทั้งหมด")}
        createLabel={__uiText("เพิ่มสินค้า")}
        createPath={ADMIN_ROUTES.productCreate}
      />
      <div className="flex flex-wrap items-end gap-4">
        <Input
          label={__uiText("ค้นหาสินค้า")}
          placeholder={__uiText("ค้นหาด้วยชื่อสินค้า")}
          onChange={(e) => {
            setFilter(e.target.value);
            setSelectAllMatching(false);
            clearApproveFeedback();
          }}
        />
        <div className="flex items-center gap-2">
          <AiOutlineFilter size={24} />
          <div className="w-48">
            <Select
              label={__uiText("สถานะสินค้า")}
              data={PRODUCT_STATUS_OPTIONS}
              value={status}
              onChange={(e) => handleStatusChange(e.target.value)}
            />
          </div>
        </div>
      </div>

      {approvedMessage && (
        <div className="px-4 py-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg">
          {approvedMessage}
        </div>
      )}
      {approveError && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {(typeof (approveError) === 'string' ? __uiText(approveError) : approveError)}
        </div>
      )}

      {status === 'draft' && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
          {selectAllMatching ? (
            <>
              <Button
                text={__uiText("อนุมัติทั้งหมด ({0})", {"0": totalCount})}
                icon={<AiOutlineCheckCircle size={18} />}
                disabled={actionPending}
                onClick={() => {
                  if (!window.confirm(__uiText("ยืนยันอนุมัติสินค้าทั้งหมด {0} รายการ?", {"0": totalCount}))) return;
                  approveMutation.mutate({ all: true });
                }}
              />
              <Button
                text={__uiText("ปฏิเสธ pending ทั้งหมด")}
                icon={<AiOutlineCloseCircle size={18} />}
                disabled={actionPending}
                onClick={() => {
                  if (
                    !window.confirm(
                      __uiText("ปฏิเสธการอัปเดตจาก ERP ที่ค้างทั้งหมด (สถานะสินค้าไม่เปลี่ยน)?"),
                    )
                  ) {
                    return;
                  }
                  rejectMutation.mutate({ all: true });
                }}
              />
            </>
          ) : (
            <>
              <Button
                text={__uiText("อนุมัติที่เลือก ({0})", {"0": selectedIds.length})}
                icon={<AiOutlineCheckCircle size={18} />}
                disabled={actionPending}
                onClick={() => approveMutation.mutate({ ids: selectedIds })}
              />
              <Button
                text={__uiText("ปฏิเสธ pending ที่เลือก")}
                icon={<AiOutlineCloseCircle size={18} />}
                disabled={actionPending}
                onClick={() => {
                  if (
                    !window.confirm(
                      __uiText("ปฏิเสธการอัปเดตจาก ERP สำหรับ {0} รายการ?", {"0": selectedIds.length}),
                    )
                  ) {
                    return;
                  }
                  rejectMutation.mutate({ ids: selectedIds });
                }}
              />
            </>
          )}

          {showSelectAllMatchingNotice && (
            <span className="text-sm text-gray-600">
              {__uiText("เลือกแล้ว ")}{selectedIds.length} {__uiText(" รายการในหน้านี้ —")}{' '}
              <button
                type="button"
                className="font-semibold text-primary hover:underline"
                onClick={() => setSelectAllMatching(true)}
              >
                {__uiText("เลือกทั้งหมด ")}{totalCount} {__uiText(" รายการ")}</button>
            </span>
          )}
        </div>
      )}

      {isError && (
        <div className="flex items-center justify-between rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">
          <span>{__uiText("โหลดข้อมูลไม่สำเร็จ")}</span>
          <button onClick={() => refetch()} className="font-semibold underline">
            {__uiText("ลองใหม่")}</button>
        </div>
      )}
      {isLoading && (
        <div className="px-4 py-2 text-sm text-gray-500">{__uiText("กำลังโหลด…")}</div>
      )}
      <Table
        columns={columns}
        data={pageData}
        idKey="product_inventory_id"
        sortKey={sortKey}
        sortOrder={sortOrder}
        onSort={handleSort}
        totalItems={totalCount}
        currentPage={Number(apiResponse?.page || 1)}
        totalPages={Math.ceil(totalCount / Number(apiResponse?.limit || 10)) || 1}
        onPageChange={handlePageChange}
        selectedIds={selectedIds}
        onSelectRow={handleSelectRow}
        onSelectAll={handleSelectAll}
      />
    </div>
  );
};

export default AllProduct;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
