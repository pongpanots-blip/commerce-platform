// ui-metadata-migration: static labels and UI notices only
import { getCompany } from '@josh/shared-api';
import { Input, Table, TableColumn, TableViewBar, useTableViews } from '@josh/shared-ui-web';
import React, { useState } from 'react';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { Button, ButtonLink, Chip, Panel, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const Company = () => {
  __useUiLocale();
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
    { key: 'register_number', label: __uiText("เลขทะเบียนพาณิชย์"), render: (value: any) => <span className="font-mono text-[11px]">{value || '—'}</span> },
    {
      key: 'credit_limit',
      label: __uiText("วงเงินเครดิตสูงสุด"),
      align: 'right',
      render: (value: any) => (
        <span className="font-semibold">
          {Number(value || 0).toLocaleString()} {__uiText(" บาท")}</span>
      ),
    },
    {
      key: 'credit_used',
      label: __uiText("วงเงินที่ใช้ไปแล้ว"),
      align: 'right',
      render: (value: any) => (
        <span className="text-on-surface-variant">
          {Number(value || 0).toLocaleString()} {__uiText(" บาท")}</span>
      ),
    },
    {
      key: 'credit_term_days',
      label: __uiText("เครดิตเทอม (วัน)"),
      align: 'right',
      render: (value: any) => {
        const days = Number(value || 0);
        return days === 0 ? (
          <span>{__uiText("เงินสดหรือเก็บเงินปลายทาง")}</span>
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
          <Chip tone="danger" dot>{__uiText("โดนระงับสิทธิ์")}</Chip>
        ) : (
          <Chip tone="ok" dot>{__uiText("ปกติ")}</Chip>
        ),
    },
    {
      key: 'id',
      label: __uiText("จัดการ"),
      render: (id: any) => (
        <ButtonLink to={ADMIN_ROUTES.companyEdit(id)} icon="edit">
          {__uiText("แก้ไขและดูสาขา")}</ButtonLink>
      ),
    },
  ];

  React.useEffect(() => {
    void getData(currentPage, search);
  }, [currentPage, search]);

  const views = useTableViews('j-company', { search }, (v) => {
    setSearch(v.search ?? '');
    setSearchInput(v.search ?? '');
    setCurrentPage(1);
  });

  return (
    <div className="cp-management-page grid gap-5 w-full">
      <AdminListHeader
        title={__uiText("บริษัทลูกค้า")}
        subtitle={__uiText("ข้อมูลบริษัท เครดิตเทอม วงเงิน และสิทธิ์สั่งซื้อของแต่ละบริษัท")}
        createLabel={__uiText("เพิ่มบริษัทใหม่")}
        createPath={ADMIN_ROUTES.companyCreate}
      />

      <TableViewBar views={views} columns={columns} />
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
        <Button
          icon="search"
          className="shrink-0"
          onClick={() => {
            setSearch(searchInput.trim());
            setCurrentPage(1);
          }}
        >
          {__uiText("ค้นหา")}</Button>
      </div>

      <Panel className="overflow-hidden">
        <Table
          columns={columns}
          data={apiResponse?.data || []}
          idKey="id"
          hiddenKeys={views.hidden}
          totalItems={Number(apiResponse?.meta?.total || 0)}
          currentPage={Number(apiResponse?.meta?.page || 1)}
          totalPages={Number(apiResponse?.meta?.totalPages || 1)}
          onPageChange={setCurrentPage}
          emptyTitle={search ? __uiText("ไม่พบบริษัทที่ตรงกับคำค้น") : __uiText("ยังไม่มีบริษัทลูกค้า")}
          emptyDescription={search ? __uiText("ลองค้นด้วยชื่อหรือเลขทะเบียนอื่น") : __uiText("กดเพิ่มบริษัทใหม่เพื่อเริ่มต้น")}
        />
      </Panel>
    </div>
  );
};

export default Company;
