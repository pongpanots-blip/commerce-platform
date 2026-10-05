import { getTrustedBrands, deleteTrustedBrand } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { AiOutlineEdit } from 'react-icons/ai';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

const TrustedBrandList = () => {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [apiResponse, setApiResponse] = useState<any>({
    data: [],
    meta: { total: 0, page: 1, limit: 10, totalPages: 1 },
  });

  const loadData = async (page: number) => {
    try {
      const response: any = await getTrustedBrands(page, 10);
      if (response?.status === 200 && response.data?.status === 200) {
        setApiResponse(response.data.data);
      }
    } catch (error: any) {
      console.error('load trusted brands error:', error.message);
    }
  };

  useEffect(() => {
    loadData(currentPage);
  }, [currentPage]);

  const handleDelete = async (id: string) => {
    if (!confirm('ยืนยันการลบแบรนด์นี้?')) return;
    await deleteTrustedBrand(id);
    loadData(currentPage);
  };

  const columns: TableColumn<any>[] = [
    { key: 'brand_name', label: 'ชื่อแบรนด์' },
    {
      key: 'logo_url',
      label: 'โลโก้',
      render: (value: string) =>
        value ? (
          <img
            src={value.startsWith('http') ? value : `http://localhost:3000${value}`}
            alt=""
            className="w-10 h-10 object-contain rounded border"
          />
        ) : (
          '-'
        ),
    },
    { key: 'link_type', label: 'ประเภทลิงก์' },
    { key: 'sort_order', label: 'ลำดับ' },
    {
      key: 'is_active',
      label: 'สถานะ',
      render: (value: boolean) =>
        value ? (
          <span className="text-green-600 text-xs font-semibold">Active</span>
        ) : (
          <span className="text-gray-400 text-xs">Inactive</span>
        ),
    },
    {
      key: 'actions',
      label: 'จัดการ',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(ADMIN_ROUTES.trustedBrandEdit(row.id))}
            className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg"
            title="แก้ไข"
          >
            <AiOutlineEdit size={18} />
          </button>
          <button
            onClick={() => handleDelete(row.id)}
            className="text-xs text-red-500 hover:underline"
          >
            ลบ
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5 p-4">
      <AdminListHeader
        title="Trusted Brands"
        createLabel="เพิ่มแบรนด์"
        createPath={ADMIN_ROUTES.trustedBrandCreate}
      />
      <Table
        columns={columns}
        data={apiResponse?.data || []}
        idKey="id"
        totalItems={Number(apiResponse?.meta?.total || 0)}
        currentPage={Number(apiResponse?.meta?.page || 1)}
        totalPages={Number(apiResponse?.meta?.totalPages || 1)}
        onPageChange={(newPage) => setCurrentPage(newPage)}
      />
    </div>
  );
};

export default TrustedBrandList;
