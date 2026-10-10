import {
  approveProducts,
  getAdminProducts,
  rejectErpPending,
} from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import {
  Button,
  ButtonLink,
  Chip,
  Icon,
  PageHeader,
  confirmAction,
  uiText,
  useUiLocale,
} from '@cp/ui';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { session } from '../../../../lib/auth';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { catalogSellingPrice } from './catalog-price';
import { commerceText } from '../../../../app/commerce-copy';
import {
  PRODUCT_STATUS_OPTIONS,
  normalizeProductStatus,
} from './product-status.helpers';
import { resolveMediaUrl } from './product-media.helpers';

const LIMIT = 10;
type ProductStatusFilter = 'active' | 'inactive' | 'draft' | 'all';
const hasErpPending = (row: any) => row?.erp_pending_payload != null;
const approvable = (row: any) =>
  normalizeProductStatus(row.product_status) === 'draft' || hasErpPending(row);

function ProductThumb({
  media,
}: {
  media?: { source?: string; media_type?: string }[];
}) {
  const [failed, setFailed] = useState(false);
  const source = media?.find((m) => m.media_type === 'image')?.source;
  const url = source ? resolveMediaUrl(source) : '';
  return url && !failed ? (
    <img
      src={url}
      alt=""
      width={48}
      height={48}
      loading="lazy"
      decoding="async"
      className="cp-catalog-thumb"
      onError={() => setFailed(true)}
    />
  ) : (
    <span
      className="cp-catalog-thumb cp-catalog-thumb-empty"
      aria-hidden="true"
    >
      <Icon name="inventory_2" size={22} />
    </span>
  );
}

export default function AllProduct() {
  const locale = useUiLocale();
  const role = session.claims()?.role;
  const canManage = ['admin', 'marketing', 'merchandising'].includes(
    role ?? '',
  );
  const canOpen = role !== 'graphic';
  const canEditContent = ['admin', 'merchandising', 'graphic'].includes(role ?? '');
  const [sortKey, setSortKey] = useState('');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('ASC');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<ProductStatusFilter>('active');
  const [allDrafts, setAllDrafts] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'ok' | 'danger';
    text: string;
  } | null>(null);
  const search = filter.trim().length >= 4 ? filter.trim() : '';
  const resetSelection = () => {
    setSelectedIds([]);
    setAllDrafts(false);
  };
  const resetView = () => {
    setPage(1);
    resetSelection();
    setFeedback(null);
  };
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['admin-products', page, LIMIT, search, status],
    queryFn: async () => {
      const response = await getAdminProducts({
        page,
        limit: LIMIT,
        search,
        status,
      });
      const payload = response.data;
      return {
        rows: Array.isArray(payload.data) ? payload.data : [],
        total: Number(payload.totalCount) || 0,
        page: Number(payload.page) || page,
      };
    },
    placeholderData: keepPreviousData,
  });
  const formatBaht = (value: unknown) =>
    Number.isFinite(Number(value)) && Number(value) > 0
      ? new Intl.NumberFormat(locale === 'th' ? 'th-TH' : 'en-GB', {
          style: 'currency',
          currency: 'THB',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(Number(value))
      : uiText('รอระบุราคา');
  const rows = useMemo(() => {
    const result = [...(data?.rows ?? [])];
    if (!sortKey) return result;
    return result.sort((a, b) => {
      const av =
        sortKey === 'price'
          ? Number(catalogSellingPrice(a) ?? a.selling_unit_price ?? 0)
          : Number(a.product_inventory_quantity ?? 0);
      const bv =
        sortKey === 'price'
          ? Number(catalogSellingPrice(b) ?? b.selling_unit_price ?? 0)
          : Number(b.product_inventory_quantity ?? 0);
      return (av - bv) * (sortOrder === 'ASC' ? 1 : -1);
    });
  }, [data?.rows, sortKey, sortOrder]);
  const approve = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) =>
      approveProducts(body),
    onMutate: () => setFeedback(null),
    onSuccess: (response: any) => {
      setFeedback({
        tone: 'ok',
        text: uiText('อนุมัติแล้ว {0} รายการ', {
          0: response?.data?.data?.approved ?? 0,
        }),
      });
      resetSelection();
      void refetch();
    },
    onError: () =>
      setFeedback({ tone: 'danger', text: uiText('อนุมัติสินค้าไม่สำเร็จ') }),
  });
  const reject = useMutation({
    mutationFn: (body: { ids: string[] }) => rejectErpPending(body),
    onMutate: () => setFeedback(null),
    onSuccess: (response: any) => {
      setFeedback({
        tone: 'ok',
        text: uiText('ปฏิเสธการอัปเดตจาก ERP แล้ว {0} รายการ', {
          0: response?.data?.data?.rejected ?? 0,
        }),
      });
      resetSelection();
      void refetch();
    },
    onError: () =>
      setFeedback({
        tone: 'danger',
        text: uiText('ปฏิเสธการอัปเดตจาก ERP ไม่สำเร็จ'),
      }),
  });
  const busy = isFetching || approve.isPending || reject.isPending;
  const total = data?.total ?? 0;
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(total / LIMIT));
    if (data && !isFetching && page > lastPage) {
      setPage(lastPage);
      setSelectedIds([]);
      setAllDrafts(false);
    }
  }, [data, isFetching, page, total]);
  const selectedPendingIds = rows
    .filter(
      (row) =>
        selectedIds.includes(row.product_inventory_id) && hasErpPending(row),
    )
    .map((row) => row.product_inventory_id);
  const toggleRow = (id: string) => {
    setAllDrafts(false);
    setSelectedIds((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id],
    );
  };
  const selectable = rows.filter(approvable);
  const allPageSelected =
    selectable.length > 0 &&
    selectable.every((row) => selectedIds.includes(row.product_inventory_id));
  const togglePage = () => {
    setAllDrafts(false);
    setSelectedIds(
      allPageSelected ? [] : selectable.map((row) => row.product_inventory_id),
    );
  };
  const rejectRows = async (ids: string[]) => {
    if (
      await confirmAction({
        title: uiText('ปฏิเสธการอัปเดตจาก ERP'),
        body: uiText('ปฏิเสธการอัปเดตจาก ERP สำหรับ {0} รายการ?', {
          0: ids.length,
        }),
        confirmLabel: uiText('ปฏิเสธ'),
        danger: true,
      })
    )
      reject.mutate({ ids });
  };
  const productStatus = (row: any) => {
    const value = normalizeProductStatus(row.product_status);
    return (
      <div className="cp-catalog-status">
        <Chip
          tone={
            value === 'active' ? 'ok' : value === 'draft' ? 'warn' : 'muted'
          }
        >
          {uiText(
            value === 'active'
              ? 'ใช้งาน'
              : value === 'draft'
                ? 'รออนุมัติ'
                : 'ไม่ได้ใช้งาน',
          )}
        </Chip>
        {hasErpPending(row) && (
          <Chip tone="warn">{uiText('รออนุมัติ ERP')}</Chip>
        )}
      </div>
    );
  };
  const productInfo = (row: any) => (
    <div className="cp-catalog-product">
      <ProductThumb media={row.media} />
      <div className="cp-catalog-product-copy">
        {canOpen ? (
          <Link
            className="cp-catalog-name"
            to={ADMIN_ROUTES.productDetail(row.product_inventory_id)}
            title={row.product_name}
          >
            {row.product_name || uiText('ไม่มีชื่อสินค้า')}
          </Link>
        ) : (
          <span className="cp-catalog-name" title={row.product_name}>
            {row.product_name || uiText('ไม่มีชื่อสินค้า')}
          </span>
        )}
        <span className="cp-catalog-sku">
          {row.product_inventory_sku || row.sku || '—'}
        </span>
        <span className="cp-catalog-category">
          {(locale === 'en'
            ? (row.category_name_en ?? row.category_name_th)
            : (row.category_name_th ?? row.category_name_en)) ||
            uiText('ไม่มีหมวดหมู่')}
        </span>
      </div>
    </div>
  );
  const price = (row: any) => (
    <div className="cp-catalog-price">
      <strong>
        {formatBaht(catalogSellingPrice(row) ?? row.selling_unit_price)}
      </strong>
      {(row.erp_pending_payload?.selling_unit_price != null ||
        row.erp_pending_payload?.ordering_price != null) && (
        <small>
          {uiText('ERP →')}{' '}
          {formatBaht(
            row.erp_pending_payload.selling_unit_price ??
              row.erp_pending_payload.ordering_price,
          )}
        </small>
      )}
    </div>
  );
  const stock = (row: any) => (
    <span
      className={
        Number(row.product_inventory_quantity) > 0
          ? 'cp-catalog-stock'
          : 'cp-catalog-stock cp-catalog-stock-empty'
      }
    >
      {(Number(row.product_inventory_quantity) || 0).toLocaleString()}{' '}
      <small>{uiText('ชิ้น')}</small>
    </span>
  );
  const actions = (row: any) => (
    <div className="cp-catalog-actions">
      {canEditContent && (
        <ButtonLink
          to={ADMIN_ROUTES.productContent(row.product_inventory_id)}
          variant="ghost"
          icon="edit_note"
        >
          {commerceText('แก้ไขเนื้อหาสินค้า', 'Edit product content')}
        </ButtonLink>
      )}
      {canOpen && (
        <ButtonLink
          to={ADMIN_ROUTES.productDetail(row.product_inventory_id)}
          variant="ghost"
          icon="visibility"
        >
          {uiText('ดูรายละเอียด')}
        </ButtonLink>
      )}
      {canManage && (
        <ButtonLink
          to={ADMIN_ROUTES.productEdit(row.product_inventory_id)}
          variant="ghost"
          icon="edit"
        >
          {uiText('แก้ไข')}
        </ButtonLink>
      )}
      {canManage && approvable(row) && (
        <Button
          size="sm"
          variant="secondary"
          icon="check"
          disabled={busy}
          aria-label={uiText(
            hasErpPending(row) ? 'อนุมัติการอัปเดตจาก ERP' : 'อนุมัติสินค้า',
          )}
          title={uiText('อนุมัติสินค้า')}
          onClick={() => approve.mutate({ ids: [row.product_inventory_id] })}
        >
          <span className="cp-catalog-action-label">{uiText('อนุมัติ')}</span>
        </Button>
      )}
      {canManage && hasErpPending(row) && (
        <Button
          size="sm"
          variant="danger-ghost"
          icon="close"
          disabled={busy}
          aria-label={uiText('ปฏิเสธการอัปเดตจาก ERP')}
          title={uiText('ปฏิเสธการอัปเดตจาก ERP')}
          onClick={() => void rejectRows([row.product_inventory_id])}
        />
      )}
    </div>
  );
  const columns: TableColumn<any>[] = [
    {
      key: 'product_name',
      label: uiText('สินค้า'),
      className: 'cp-catalog-product-column',
      render: (_, row) => productInfo(row),
    },
    {
      key: 'price',
      label: uiText('ราคาขายเริ่มต้น'),
      align: 'right',
      sortable: true,
      render: (_, row) => price(row),
    },
    {
      key: 'stock',
      label: uiText('จำนวนสต็อก'),
      align: 'right',
      sortable: true,
      render: (_, row) => stock(row),
    },
    {
      key: 'product_status',
      label: uiText('สถานะ'),
      render: (_, row) => productStatus(row),
    },
    {
      key: 'actions',
      label: uiText('จัดการ'),
      render: (_, row) => actions(row),
    },
  ];
  return (
    <div className="cp-management-page cp-catalog-page">
      <PageHeader
        title={uiText('สินค้าบนร้านค้า')}
        subtitle={uiText('ดูข้อมูล ราคา และสต็อก พร้อมตรวจรายการที่รออนุมัติ')}
        actions={
          <>
            <Button
              variant="secondary"
              icon="refresh"
              disabled={busy}
              onClick={() => {
                resetSelection();
                void refetch();
              }}
            >
              {uiText('รีเฟรช')}
            </Button>
            {canManage ? (
              <ButtonLink
                to={ADMIN_ROUTES.productCreate}
                variant="primary"
                icon="add"
              >
                {uiText('เพิ่มสินค้า')}
              </ButtonLink>
            ) : (
              role === 'graphic' && (
                <ButtonLink
                  to="/j/product/bulk-image-upload"
                  variant="primary"
                  icon="image"
                >
                  {uiText('อัปโหลดรูปสินค้า')}
                </ButtonLink>
              )
            )}
          </>
        }
      />
      <div className="cp-catalog-toolbar">
        <div className="cp-catalog-filter-top">
          <div className="cp-catalog-search">
            <label htmlFor="catalog-search">{uiText('ค้นหาสินค้า')}</label>
            <div>
              <Icon name="search" size={18} />
              <input
                id="catalog-search"
                type="search"
                value={filter}
                placeholder={uiText('ค้นหาด้วยชื่อสินค้า')}
                onChange={(event) => {
                  setFilter(event.target.value);
                  resetView();
                }}
              />
            </div>
          </div>
          <div className="cp-catalog-result-count" aria-live="polite">
            {isFetching ? (
              uiText('กำลังโหลดรายการ…')
            ) : isError ? (
              '—'
            ) : (
              <>
                <strong>{total.toLocaleString()}</strong>{' '}
                {uiText('รายการที่ตรงกับตัวกรอง')}
              </>
            )}
          </div>
        </div>
        {filter.trim().length > 0 && filter.trim().length < 4 && (
          <p className="cp-catalog-search-hint">
            {uiText('พิมพ์อย่างน้อย 4 ตัวอักษรเพื่อค้นหา')}
          </p>
        )}
        <div
          className="cp-catalog-tabs"
          role="group"
          aria-label={uiText('สถานะสินค้า')}
        >
          {PRODUCT_STATUS_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              aria-pressed={status === option.value}
              onClick={() => {
                setStatus(option.value as ProductStatusFilter);
                resetView();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="cp-catalog-mobile-sort">
          <span>{uiText('เรียงรายการในหน้านี้')}</span>
          <select
            value={sortKey ? `${sortKey}:${sortOrder}` : ''}
            onChange={(event) => {
              const [key, order] = event.target.value.split(':');
              setSortKey(key);
              setSortOrder(order === 'DESC' ? 'DESC' : 'ASC');
              resetSelection();
            }}
          >
            <option value="">{uiText('ลำดับเดิม')}</option>
            <option value="price:ASC">{uiText('ราคา: ต่ำไปสูง')}</option>
            <option value="price:DESC">{uiText('ราคา: สูงไปต่ำ')}</option>
            <option value="stock:ASC">{uiText('สต็อก: น้อยไปมาก')}</option>
            <option value="stock:DESC">{uiText('สต็อก: มากไปน้อย')}</option>
          </select>
        </label>
      </div>
      {feedback && (
        <div
          role={feedback.tone === 'danger' ? 'alert' : 'status'}
          className={`cp-catalog-feedback cp-catalog-feedback-${feedback.tone}`}
        >
          <Icon name={feedback.tone === 'danger' ? 'error' : 'check_circle'} />
          {feedback.text}
        </div>
      )}
      {selectedIds.length > 0 && (
        <div className="cp-catalog-bulk">
          <span>
            <strong>{allDrafts ? total : selectedIds.length}</strong>{' '}
            {uiText('รายการที่เลือก')}
          </span>
          <Button
            variant="primary"
            icon="check"
            disabled={busy}
            onClick={async () => {
              if (allDrafts) {
                if (
                  await confirmAction({
                    title: uiText('อนุมัติสินค้า'),
                    body: uiText(
                      'ยืนยันอนุมัติสินค้ารออนุมัติทั้งหมด {0} รายการ?',
                      { 0: total },
                    ),
                    confirmLabel: uiText('อนุมัติทั้งหมด'),
                  })
                )
                  approve.mutate({ all: true });
              } else approve.mutate({ ids: selectedIds });
            }}
          >
            {uiText('อนุมัติที่เลือก ({0})', {
              0: allDrafts ? total : selectedIds.length,
            })}
          </Button>
          {!allDrafts && selectedPendingIds.length > 0 && (
            <Button
              variant="danger-ghost"
              disabled={busy}
              onClick={() => void rejectRows(selectedPendingIds)}
            >
              {uiText('ปฏิเสธข้อมูล ERP ที่เลือก')}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={resetSelection}>
            {uiText('ล้างการเลือก')}
          </Button>
          {status === 'draft' &&
            !search &&
            !allDrafts &&
            allPageSelected &&
            total > rows.length && (
              <button
                type="button"
                className="cp-catalog-select-global"
                disabled={busy}
                onClick={() => setAllDrafts(true)}
              >
                {uiText('เลือกสินค้ารออนุมัติทั้งหมด {0} รายการ', { 0: total })}
              </button>
            )}
        </div>
      )}
      {isError ? (
        <div role="alert" className="cp-catalog-error">
          <Icon name="error" size={24} />
          <div>
            <strong>{uiText('โหลดข้อมูลไม่สำเร็จ')}</strong>
            <p>{uiText('ลองรีเฟรชอีกครั้งเพื่อโหลดรายการสินค้า')}</p>
          </div>
          <Button onClick={() => void refetch()} icon="refresh">
            {uiText('ลองใหม่')}
          </Button>
        </div>
      ) : (
        <Table
          columns={columns}
          data={rows}
          loading={isFetching}
          idKey="product_inventory_id"
          currentPage={data?.page ?? page}
          totalPages={Math.ceil(total / LIMIT) || 1}
          totalItems={total}
          pageSize={LIMIT}
          onPageChange={(next) => {
            setPage(next);
            resetSelection();
            setFeedback(null);
          }}
          sortKey={sortKey}
          sortOrder={sortOrder}
          onSort={(key) => {
            setSortKey(key);
            setSortOrder(
              key === sortKey && sortOrder === 'ASC' ? 'DESC' : 'ASC',
            );
            resetSelection();
          }}
          selectedIds={selectedIds}
          onSelectRow={canManage ? toggleRow : undefined}
          onSelectAll={canManage ? togglePage : undefined}
          isRowSelectable={approvable}
          emptyTitle={
            search ? 'ไม่พบสินค้าที่ค้นหา' : 'ยังไม่มีสินค้าในสถานะนี้'
          }
          emptyDescription={
            <>
              {uiText('เปลี่ยนตัวกรองหรือค้นหาด้วยชื่อสินค้าอื่น')}
              {filter && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFilter('');
                    resetView();
                  }}
                >
                  {uiText('ล้างการค้นหา')}
                </Button>
              )}
            </>
          }
          renderMobileRow={(row, selection) => (
            <article
              className={`cp-catalog-mobile-card ${selection.selected ? 'cp-catalog-mobile-selected' : ''}`}
            >
              <div className="cp-catalog-mobile-top">
                {canManage && (
                  <input
                    type="checkbox"
                    checked={selection.selected}
                    disabled={selection.disabled}
                    onChange={selection.onSelect}
                    aria-label={uiText('เลือกแถว {0}', {
                      0: row.product_inventory_id,
                    })}
                  />
                )}
                {productInfo(row)}
              </div>
              <div className="cp-catalog-mobile-values">
                <div>
                  <span>{uiText('ราคาขายเริ่มต้น')}</span>
                  {price(row)}
                </div>
                <div>
                  <span>{uiText('จำนวนสต็อก')}</span>
                  {stock(row)}
                </div>
              </div>
              {productStatus(row)}
              {actions(row)}
            </article>
          )}
        />
      )}
      <p className="cp-catalog-scope">
        {uiText('การเรียงราคาและสต็อกใช้กับรายการในหน้าปัจจุบัน')}
        {sortKey && (
          <button
            type="button"
            onClick={() => {
              setSortKey('');
              resetSelection();
            }}
          >
            {uiText('คืนลำดับเดิม')}
          </button>
        )}
      </p>
    </div>
  );
}
