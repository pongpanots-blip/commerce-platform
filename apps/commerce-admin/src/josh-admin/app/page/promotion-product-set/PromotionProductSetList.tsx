// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import {
  deletePromotionProductSet,
  getPromotionProductSets,
  type PromotionProductSetListResponse,
  type PromotionProductSetSummary,
} from '@josh/shared-api';
import { Input, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { AiOutlineDelete, AiOutlineEdit, AiOutlineSearch } from 'react-icons/ai';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { appendReturnTo, readReturnTo, withRestoreDraftMarker } from '../../utils/return-to';

// ui-copy-migration: only literal UI copy and notification templates
import { StatusChip, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const EMPTY_RESPONSE: PromotionProductSetListResponse = {
  data: [],
  meta: { total: 0, page: 1, limit: 20, totalPages: 1 },
};

const PromotionProductSetList = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Set when this page was reached from a coupon form's product-set picker — carried forward
  // into the create/edit links below, and shown as an explicit way back to the coupon.
  const returnTo = readReturnTo(searchParams);
  const withReturnTo = (path: string) => (returnTo ? appendReturnTo(path, returnTo) : path);
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [response, setResponse] = useState<PromotionProductSetListResponse>(EMPTY_RESPONSE);
  const [error, setError] = useState('');

  const loadData = async (page: number, keyword: string) => {
    try {
      const result = await getPromotionProductSets(page, 20, keyword);
      setResponse(result);
      setError('');
    } catch (err) {
      console.error('โหลด promotion product sets ไม่สำเร็จ', err);
      setError(__uiMessage("โหลดรายการไม่สำเร็จ ลองใหม่อีกครั้ง"));
    }
  };

  // debounce คำค้นก่อนยิง — กด backspace รัวๆ ไม่ยิงทุกตัวอักษร
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  // effect เดียวคุมการยิง — key ด้วย (page, คำค้นที่ debounce แล้ว) กันยิงซ้ำตอน mount/พิมพ์ค้นหา
  useEffect(() => {
    void loadData(currentPage, debouncedSearch);
  }, [currentPage, debouncedSearch]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(__uiText("ยืนยันการลบชุดสินค้านี้?"))) return;
    try {
      await deletePromotionProductSet(id);
      setError('');
      void loadData(currentPage, debouncedSearch);
    } catch (err) {
      console.error('ลบ promotion product set ไม่สำเร็จ', err);
      setError(__uiMessage("ลบไม่สำเร็จ ลองใหม่อีกครั้ง"));
    }
  };

  const columns: TableColumn<PromotionProductSetSummary>[] = [
    { key: 'name', label: __uiText("ชื่อ") },
    { key: 'itemCount', label: __uiText("จำนวนสินค้า"), align: 'right', className: 'tabular-nums' },
    {
      key: 'categoryIds',
      label: __uiText("จำนวนหมวดหมู่"),
      align: 'right',
      className: 'tabular-nums',
      render: (value: string[]) => value?.length ?? 0,
    },
    {
      key: 'brandIds',
      label: __uiText("จำนวนแบรนด์"),
      align: 'right',
      className: 'tabular-nums',
      render: (value: string[]) => value?.length ?? 0,
    },
    {
      key: 'isActive',
      label: __uiText("สถานะ"),
      render: (value: boolean) => <StatusChip status={value ? 'active' : 'inactive'} />,
    },
    {
      key: 'updatedAt',
      label: __uiText("แก้ไขล่าสุด"),
      className: 'tabular-nums whitespace-nowrap',
      render: (value: string) => (value ? new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) : '-'),
    },
    {
      key: 'actions',
      label: __uiText("เครื่องมือ"),
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              navigate(withReturnTo(ADMIN_ROUTES.promotionProductSetEdit(row.id)))
            }
            className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
            title={__uiText("แก้ไข")}
            aria-label={__uiText("แก้ไข")}
          >
            <AiOutlineEdit size={18} />
          </button>
          <button
            onClick={() => void handleDelete(row.id)}
            className="p-1.5 text-gray-500 hover:text-alert hover:bg-danger-container rounded-lg transition-colors"
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
      {returnTo && (
        <button
          type="button"
          onClick={() => navigate(withRestoreDraftMarker(returnTo))}
          className="self-start text-sm text-primary hover:underline"
        >
          {__uiText("← กลับไปที่คูปอง")}</button>
      )}

      <AdminListHeader
        title={__uiText("ชุดสินค้าโปรโมชัน")}
        subtitle={__uiText("รวมสินค้าไว้เป็นชุดที่ตั้งชื่อได้ ใช้กำหนดว่าคูปองหรือโปรใช้กับสินค้าไหน หรือไม่ใช้กับสินค้าไหน")}
        createLabel={__uiText("เพิ่มชุดสินค้า")}
        createPath={withReturnTo(ADMIN_ROUTES.promotionProductSetCreate)}
      />

      {error && <p className="text-sm text-danger">{(typeof error === 'string' ? __uiText(error) : error)}</p>}

      <div className="rounded-lg bg-white p-3 shadow-level-1">
        <Input
          icon={<AiOutlineSearch size={20} />}
          className="md:w-[296px]"
          placeholder={__uiText("ค้นหาชื่อชุดสินค้า")}
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      <Table
        columns={columns}
        data={response.data}
        idKey="id"
        totalItems={response.meta.total}
        currentPage={response.meta.page}
        totalPages={response.meta.totalPages}
        onPageChange={(newPage) => setCurrentPage(newPage)}
        emptyTitle={search.trim() ? __uiText("ไม่พบชุดสินค้าที่ตรงกับคำค้น") : __uiText("ยังไม่มีชุดสินค้า")}
        emptyDescription={search.trim() ? __uiText("ลองค้นด้วยชื่ออื่น") : __uiText("กด \"เพิ่มชุดสินค้า\" เพื่อสร้างชุดแรก")}
      />
    </div>
  );
};

export default PromotionProductSetList;
