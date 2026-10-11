import { getSuppliers, deleteSupplier } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import {
  Button,
  ButtonLink,
  ErrorText,
  confirmAction,
  uiText,
  useUiLocale,
} from '@cp/ui';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

export default function SupplierList() {
  useUiLocale();
  const [page, setPage] = useState(1);
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['admin-suppliers', page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await getSuppliers(page, 10);
      if (response.data?.status !== 200)
        throw new Error('Supplier list unavailable');
      return response.data.data;
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSupplier(id),
    onSuccess: () => {
      if (data?.data?.length === 1 && page > 1) setPage(page - 1);
      else void refetch();
    },
  });
  const busy = isFetching || remove.isPending;
  const handleDelete = async (row: any) => {
    if (
      await confirmAction({
        title: uiText('ลบซัพพลายเออร์'),
        body: uiText('ยืนยันการลบซัพพลายเออร์นี้?') + '\n' + row.supplier_name,
        confirmLabel: uiText('ลบ'),
        danger: true,
      })
    )
      remove.mutate(row.id || row.supplier_id);
  };
  const columns: TableColumn<any>[] = [
    { key: 'supplier_name', label: uiText('ชื่อซัพพลายเออร์') },
    { key: 'contact_name', label: uiText('ผู้ติดต่อ') },
    { key: 'phone', label: uiText('เบอร์โทร') },
    { key: 'email', label: uiText('อีเมล') },
    {
      key: 'actions',
      label: uiText('จัดการ'),
      render: (_, row) => (
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink
            to={ADMIN_ROUTES.supplierEdit(row.id || row.supplier_id)}
            icon="edit"
            variant="ghost"
          >
            {uiText('แก้ไข')}
          </ButtonLink>
          <Button
            size="sm"
            variant="danger-ghost"
            disabled={busy}
            onClick={() => void handleDelete(row)}
          >
            {uiText('ลบ')}
          </Button>
        </div>
      ),
    },
  ];
  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={uiText('ซัพพลายเออร์')}
        subtitle={uiText('ซัพพลายเออร์ที่ส่งสินค้าให้ร้านและข้อมูลติดต่อ')}
        createLabel={uiText('เพิ่มซัพพลายเออร์')}
        createPath={ADMIN_ROUTES.supplierCreate}
      >
        <Button
          icon="refresh"
          variant="secondary"
          disabled={busy}
          onClick={() => void refetch()}
        >
          {uiText('รีเฟรช')}
        </Button>
      </AdminListHeader>
      {remove.isError && <ErrorText error={uiText('ลบไม่สำเร็จ ลองอีกครั้ง')} />}
      {isError ? (
        <div className="cp-list-error" role="alert">
          <span>{uiText('โหลดข้อมูลไม่สำเร็จ')}</span>
          <Button icon="refresh" onClick={() => void refetch()}>
            {uiText('ลองใหม่')}
          </Button>
        </div>
      ) : (
        <Table
          columns={columns}
          data={(data?.data ?? []).map((row: any) => ({
            ...row,
            id: row.id || row.supplier_id,
          }))}
          loading={isFetching}
          idKey="id"
          pageSize={10}
          totalItems={Number(data?.meta?.total ?? 0)}
          currentPage={Number(data?.meta?.page ?? page)}
          totalPages={Number(data?.meta?.totalPages ?? 1)}
          onPageChange={setPage}
          emptyTitle={uiText('ยังไม่มีซัพพลายเออร์')}
          emptyDescription={uiText('กด "เพิ่มซัพพลายเออร์" เพื่อเพิ่มรายแรก')}
        />
      )}
    </div>
  );
}
