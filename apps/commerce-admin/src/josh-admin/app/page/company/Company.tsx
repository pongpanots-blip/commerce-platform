import { getCompany } from '@josh/shared-api';
import { Input, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

const Company = () => {
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
    { key: 'name', label: 'ชื่อบริษัท / องค์กร' },
    { key: 'register_number', label: 'เลขทะเบียนพาณิชย์' },
    {
      key: 'credit_limit',
      label: 'วงเงินเครดิตสูงสุด',
      render: (value: any) => (
        <span className="font-semibold">
          {Number(value || 0).toLocaleString()} บาท
        </span>
      ),
    },
    {
      key: 'credit_used',
      label: 'วงเงินที่ใช้ไปแล้ว',
      render: (value: any) => (
        <span className="text-gray-600">
          {Number(value || 0).toLocaleString()} บาท
        </span>
      ),
    },
    {
      key: 'credit_term_days',
      label: 'เครดิตเทอม (วัน)',
      render: (value: any) => {
        const days = Number(value || 0);
        return days === 0 ? (
          <span className="text-green-600 font-medium">เงินสด / COD</span>
        ) : (
          <span>{days} วัน</span>
        );
      },
    },
    {
      key: 'is_suspended',
      label: 'สถานะการสั่งซื้อ',
      render: (value: any) =>
        value ? (
          <span className="px-2 py-1 text-xs font-bold bg-red-100 text-red-700 rounded-full">
            โดนระงับสิทธิ์
          </span>
        ) : (
          <span className="px-2 py-1 text-xs font-bold bg-green-100 text-green-700 rounded-full">
            ปกติ
          </span>
        ),
    },
    {
      key: 'id',
      label: 'จัดการ',
      render: (id: any) => (
        <button
          onClick={() => navigate(ADMIN_ROUTES.companyEdit(id))}
          className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1.5 rounded-md font-medium transition-colors"
        >
          แก้ไข / ส่องดูสาขา
        </button>
      ),
    },
  ];

  React.useEffect(() => {
    void getData(currentPage, search);
  }, [currentPage, search]);

  return (
    <div className="grid mx-auto gap-5 w-full p-4">
      <AdminListHeader
        title="Company Management"
        subtitle="จัดการข้อมูลเครดิตเทอม, ดูสถานะ Overdue และควบคุมสิทธิ์สั่งซื้อรายองค์กร B2B"
        createLabel="เพิ่มบริษัทใหม่"
        createPath={ADMIN_ROUTES.companyCreate}
      />

      <div className="flex max-w-md items-end gap-2">
        <Input
          label="ค้นหาบริษัท"
          placeholder="ค้นหาชื่อ / เลขทะเบียน..."
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
          ค้นหา
        </button>
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
