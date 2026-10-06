import { getSuppliers, deleteSupplier } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { AiOutlineEdit } from 'react-icons/ai';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

const SupplierList = () => {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [apiResponse, setApiResponse] = useState<any>({
    data: [],
    meta: { total: 0, page: 1, limit: 10, totalPages: 1 },
  });

  const loadData = async (page: number) => {
    try {
      const response: any = await getSuppliers(page, 10);
      if (response?.status === 200 && response.data?.status === 200) {
        setApiResponse(response.data.data);
      }
    } catch (error: any) {
      console.error('load suppliers error:', error.message);
    }
  };

  useEffect(() => {
    loadData(currentPage);
  }, [currentPage]);

  const handleDelete = async (id: string) => {
    if (!confirm('ยืนยันการลบ supplier นี้?')) return;
    await deleteSupplier(id);
    loadData(currentPage);
  };

  const columns: TableColumn<any>[] = [
    { key: 'supplier_name', label: 'ชื่อ Supplier' },
    { key: 'contact_name', label: 'ผู้ติดต่อ' },
    { key: 'phone', label: 'เบอร์โทร' },
    { key: 'email', label: 'อีเมล' },
    {
      key: 'actions',
      label: 'จัดการ',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(ADMIN_ROUTES.supplierEdit(row.id || row.supplier_id))}
            className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg"
            title="แก้ไข"
          >
            <AiOutlineEdit size={18} />
          </button>
          <button
            onClick={() => handleDelete(row.id || row.supplier_id)}
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
        title="Suppliers"
        createLabel="เพิ่ม Supplier"
        createPath={ADMIN_ROUTES.supplierCreate}
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

export default SupplierList;
