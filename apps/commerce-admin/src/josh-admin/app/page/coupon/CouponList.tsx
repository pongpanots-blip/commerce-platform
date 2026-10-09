// ui-metadata-migration: static labels and UI notices only
import { getCoupons, deleteCoupon, formatBangkokDateTime } from '@josh/shared-api';
import { Input, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { AiOutlineCopy, AiOutlineEdit, AiOutlineDelete } from 'react-icons/ai';
import { Link, useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';
import { COUPON_CODE_MAX_LENGTH } from './coupon-core-form.helpers';
import { extractApiError } from './coupon-error.helpers';
import CouponConfirmDialog from './CouponConfirmDialog';
import CouponStatusPill from './CouponStatusPill';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const DISCOUNT_SCOPE_LABELS: Record<string, string> = {
  get all(){return __uiText("ทุกสินค้า");},
  get product(){return __uiText("เฉพาะสินค้า");},
  get brand(){return __uiText("เฉพาะแบรนด์");},
  get category(){return __uiText("เฉพาะหมวดหมู่");},
};

const CouponList = () => {
  __useUiLocale();
  const navigate = useNavigate();
  // Coupon being copied — non-null while the "enter the new code" dialog is open.
  const [duplicateSource, setDuplicateSource] = useState<any>(null);
  const [newCode, setNewCode] = useState('');
  const [newCodeError, setNewCodeError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState('');
  const [apiResponse, setApiResponse] = useState<any>({
    data: [],
    meta: { total: 0, page: 1, limit: 10, totalPages: 1 },
  });

  const loadData = async (page: number) => {
    try {
      const response: any = await getCoupons(page, 10);
      if (response?.status === 200 && response.data?.status === true) {
        setApiResponse(response.data.data);
      }
    } catch (error: any) {
      console.error('load coupons error:', error.message);
    }
  };

  useEffect(() => {
    loadData(currentPage);
  }, [currentPage]);

  const handleDelete = async (id: string) => {
    if (!confirm(__uiText("ยืนยันการลบคูปองนี้?"))) return;
    setError('');
    try {
      await deleteCoupon(id);
      await loadData(currentPage);
    } catch (err: unknown) {
      setError(extractApiError(err, 'ลบคูปองไม่สำเร็จ'));
    }
  };

  const openDuplicate = (row: any) => {
    setNewCode('');
    setNewCodeError('');
    setDuplicateSource(row);
  };

  const confirmDuplicate = () => {
    const code = newCode.trim();
    if (!code) {
      setNewCodeError(__uiMessage("กรุณากรอกรหัสคูปองใหม่"));
      return;
    }
    // Create page does the actual copy (loads the source by id) — see CreateCoupon.tsx.
    navigate(
      `${ADMIN_ROUTES.couponCreate}?duplicateFrom=${duplicateSource.id}&code=${encodeURIComponent(code)}`,
    );
  };

  const columns: TableColumn<any>[] = [
    {
      key: 'coupon_code',
      label: __uiText("รหัสคูปอง"),
      render: (value: string, row) => (
        <Link
          to={ADMIN_ROUTES.couponDetail(row.id)}
          className="font-semibold text-blue-600 hover:underline"
        >
          {value}
        </Link>
      ),
    },
    { key: 'title', label: __uiText("ชื่อ") },
    { key: 'discount_type', label: __uiText("ประเภทส่วนลด") },
    {
      key: 'discount_value',
      label: __uiText("มูลค่า"),
      render: (value: number, row) =>
        row.discount_type === 'PERCENTAGE' ? `${value}%` : `${Number(value).toLocaleString()} บาท`,
    },
    {
      key: 'discount_scope',
      label: __uiText("ขอบเขตส่วนลด"),
      // rows from the pre-`discount_scope` Redis cache have no field → same 'all' default as the column
      render: (value: string | undefined) => DISCOUNT_SCOPE_LABELS[value ?? 'all'] ?? value,
    },
    {
      key: 'minimum_order_amount',
      label: __uiText("ยอดขั้นต่ำ"),
      render: (value: number | string | null | undefined) =>
        Number(value) > 0 ? `${Number(value).toLocaleString()} บาท` : '-',
    },
    {
      key: 'start_date',
      label: __uiText("เริ่ม"),
      render: (value: string) => formatBangkokDateTime(value, 'th'),
    },
    {
      key: 'end_date',
      label: __uiText("สิ้นสุด"),
      render: (value: string) => formatBangkokDateTime(value, 'th'),
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (_value: string | undefined, row) => <CouponStatusPill coupon={row} />,
    },
    {
      key: 'actions',
      label: __uiText("จัดการ"),
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <Link
            to={ADMIN_ROUTES.couponDetail(row.id)}
            className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
            title={__uiText("แก้ไข")}
            aria-label={__uiText("แก้ไข")}
          >
            <AiOutlineEdit size={18} />
          </Link>
          <button
            onClick={() => openDuplicate(row)}
            className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
            title={__uiText("คัดลอกเป็นคูปองใหม่")}
            aria-label={__uiText("คัดลอกเป็นคูปองใหม่")}
          >
            <AiOutlineCopy size={18} />
          </button>
          <button
            onClick={() => handleDelete(row.id)}
            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title={__uiText("ลบ")}
            aria-label={__uiText("ลบ")}
          >
            <AiOutlineDelete size={18} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={__uiText("Coupons")}
        subtitle={__uiText("Promotions → จัดการรายชื่อและแจ้งเตือนได้ที่หน้ารายละเอียดคูปอง")}
        createLabel={__uiText("เพิ่มคูปอง")}
        createPath={ADMIN_ROUTES.couponCreate}
      />
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {(typeof error === 'string' ? __uiText(error) : error)}
        </div>
      ) : null}
      <Table
        columns={columns}
        data={apiResponse?.data || []}
        idKey="id"
        totalItems={Number(apiResponse?.meta?.total || 0)}
        currentPage={Number(apiResponse?.meta?.page || 1)}
        totalPages={Number(apiResponse?.meta?.totalPages || 1)}
        onPageChange={(newPage) => setCurrentPage(newPage)}
      />
      <CouponConfirmDialog
        open={duplicateSource !== null}
        title={__uiText("คัดลอกเป็นคูปองใหม่")}
        confirmLabel="ไปหน้าสร้างคูปอง"
        onConfirm={confirmDuplicate}
        onCancel={() => setDuplicateSource(null)}
        body={
          <div className="space-y-3">
            <p>
              {__uiText("คัดลอกจาก ")}<span className="font-semibold">{duplicateSource?.coupon_code}</span>
              {duplicateSource?.title ? ` — ${duplicateSource.title}` : ''}
              <br />
              {__uiText("วันที่เริ่ม/สิ้นสุดจะถูกรีเซ็ตเป็นค่าเริ่มต้น แก้ไขได้ในหน้าถัดไป")}</p>
            <Input
              label={__uiText("รหัสคูปองใหม่")}
              required
              autoFocus
              value={newCode}
              maxLength={COUPON_CODE_MAX_LENGTH}
              error={newCodeError}
              hint={__uiText("สูงสุด {0} ตัวอักษร", {"0": COUPON_CODE_MAX_LENGTH})}
              placeholder={__uiText("เช่น SUMMER26")}
              onChange={(event) => {
                setNewCode(event.target.value.toUpperCase().replace(/\s+/g, ''));
                setNewCodeError('');
              }}
              onKeyDown={(event) => {
                // Enter confirms (skip while an IME composition is still being committed).
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) confirmDuplicate();
              }}
            />
          </div>
        }
      />
    </div>
  );
};

export default CouponList;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
