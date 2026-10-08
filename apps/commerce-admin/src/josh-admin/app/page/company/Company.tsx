// ui-metadata-migration: static labels and UI notices only
import { getCompany } from '@josh/shared-api';
import { Input, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const Company = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [apiResponse, setApiResponse] = useState<any>({
    data: [],
    meta: { total: 0, page: 1, limit: 10, totalPages: 1 },
  });

  const getData = async (pageNumber: number, query: string) => {
    try {
      const response = await getCompany(pageNumber, 10, query);
      setApiResponse(response.data);
    } catch (error) {
      console.error('load companies error:', error);
    }
  };

  const columns: TableColumn<any>[] = [
    { key: 'name', label: __uiText("ชื่อบริษัท / องค์กร") },
    { key: 'register_number', label: __uiText("เลขทะเบียนพาณิชย์") },
    {
      key: 'credit_limit',
      label: __uiText("วงเงินเครดิตสูงสุด"),
      render: (value: any) => (
        <span className="font-semibold">
          {Number(value || 0).toLocaleString()} {__uiText(" บาท")}</span>
      ),
    },
    {
      key: 'credit_used',
      label: __uiText("วงเงินที่ใช้ไปแล้ว"),
      render: (value: any) => (
        <span className="text-gray-600">
          {Number(value || 0).toLocaleString()} {__uiText(" บาท")}</span>
      ),
    },
    {
      key: 'credit_term_days',
      label: __uiText("เครดิตเทอม (วัน)"),
      render: (value: any) => {
        const days = Number(value || 0);
        return days === 0 ? (
          <span className="text-green-600 font-medium">{__uiText("เงินสด / COD")}</span>
        ) : (
          <span>{days} {__uiText(" วัน")}</span>
        );
      },
    },
    {
      key: 'is_suspended',
      label: __uiText("สถานะการสั่งซื้อ"),
      render: (value: any) =>
        value ? (
          <span className="px-2 py-1 text-xs font-bold bg-red-100 text-red-700 rounded-full">
            {__uiText("โดนระงับสิทธิ์")}</span>
        ) : (
          <span className="px-2 py-1 text-xs font-bold bg-green-100 text-green-700 rounded-full">
            {__uiText("ปกติ")}</span>
        ),
    },
    {
      key: 'id',
      label: __uiText("จัดการ"),
      render: (id: any) => (
        <button
          onClick={() => navigate(ADMIN_ROUTES.companyEdit(id))}
          className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1.5 rounded-md font-medium transition-colors"
        >
          {__uiText("แก้ไข / ส่องดูสาขา")}</button>
      ),
    },
  ];

  React.useEffect(() => {
    void getData(currentPage, search);
  }, [currentPage, search]);

  return (
    <div className="grid mx-auto gap-5 w-full p-4">
      <AdminListHeader
        title={__uiText("Company Management")}
        subtitle={__uiText("จัดการข้อมูลเครดิตเทอม, ดูสถานะ Overdue และควบคุมสิทธิ์สั่งซื้อรายองค์กร B2B")}
        createLabel={__uiText("เพิ่มบริษัทใหม่")}
        createPath={ADMIN_ROUTES.companyCreate}
      />

      <div className="flex max-w-md items-end gap-2">
        <Input
          label={__uiText("ค้นหาบริษัท")}
          placeholder={__uiText("ค้นหาชื่อ / เลขทะเบียน...")}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setSearch(searchInput.trim());
              setCurrentPage(1);
            }
          }}
        />
        <button
          type="button"
          className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white"
          onClick={() => {
            setSearch(searchInput.trim());
            setCurrentPage(1);
          }}
        >
          {__uiText("ค้นหา")}</button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <Table
          columns={columns}
          data={apiResponse?.data || []}
          idKey="id"
          totalItems={Number(apiResponse?.meta?.total || 0)}
          currentPage={Number(apiResponse?.meta?.page || 1)}
          totalPages={Number(apiResponse?.meta?.totalPages || 1)}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
};

export default Company;
