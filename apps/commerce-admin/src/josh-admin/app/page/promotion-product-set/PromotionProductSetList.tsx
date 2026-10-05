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

const EMPTY_RESPONSE: PromotionProductSetListResponse = {
  data: [],
  meta: { total: 0, page: 1, limit: 20, totalPages: 1 },
};

const PromotionProductSetList = () => {
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
      setError('โหลดรายการไม่สำเร็จ ลองใหม่อีกครั้ง');
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
    if (!confirm('ยืนยันการลบ Product Set นี้?')) return;
    try {
      await deletePromotionProductSet(id);
      setError('');
      void loadData(currentPage, debouncedSearch);
    } catch (err) {
      console.error('ลบ promotion product set ไม่สำเร็จ', err);
      setError('ลบไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  };

  const columns: TableColumn<PromotionProductSetSummary>[] = [
    { key: 'name', label: 'ชื่อ' },
    { key: 'itemCount', label: 'จำนวนสินค้า' },
    {
      key: 'categoryIds',
      label: 'จำนวนหมวดหมู่',
      render: (value: string[]) => value?.length ?? 0,
    },
    {
      key: 'brandIds',
      label: 'จำนวนแบรนด์',
      render: (value: string[]) => value?.length ?? 0,
    },
    {
      key: 'isActive',
      label: 'สถานะ',
      render: (value: boolean) =>
        value ? (
          <span className="text-green-600 text-xs font-semibold">Active</span>
        ) : (
          <span className="text-gray-400 text-xs">Inactive</span>
        ),
    },
    {
      key: 'updatedAt',
      label: 'แก้ไขล่าสุด',
      render: (value: string) => (value ? new Date(value).toLocaleString('th-TH') : '-'),
    },
    {
      key: 'actions',
      label: 'เครื่องมือ',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              navigate(withReturnTo(ADMIN_ROUTES.promotionProductSetEdit(row.id)))
            }
            className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
            title="แก้ไข"
          >
            <AiOutlineEdit size={18} />
          </button>
          <button
            onClick={() => void handleDelete(row.id)}
            className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="ลบ"
            aria-label="ลบ"
          >
            <AiOutlineDelete size={18} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5 p-4">
      {returnTo && (
        <button
          type="button"
          onClick={() => navigate(withRestoreDraftMarker(returnTo))}
          className="self-start text-sm text-primary hover:underline"
        >
          ← กลับไปที่คูปอง
        </button>
      )}

      <AdminListHeader
        title="Promotion Product Set"
        subtitle="รายการ SKU แบบตั้งชื่อ ใช้เป็นเงื่อนไข include/exclude ของคูปอง"
        createLabel="สร้าง Product Set"
        createPath={withReturnTo(ADMIN_ROUTES.promotionProductSetCreate)}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded-lg bg-white p-3 shadow-level-1">
        <Input
          icon={<AiOutlineSearch size={20} />}
          className="md:w-[296px]"
          placeholder="ค้นหาชื่อ Product Set"
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
      />
    </div>
  );
};

export default PromotionProductSetList;
