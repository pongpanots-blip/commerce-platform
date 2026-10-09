import { getBrands, updateBrand } from '@josh/shared-api';
import { Table, TableColumn, Input } from '@josh/shared-ui-web';
import { Button, ErrorText, PageHeader, uiText, useUiLocale } from '@cp/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { session } from '../../../../lib/auth';

interface BrandRow {
  id: string;
  brand_code: string;
  brand_name_th: string | null;
  brand_name_en: string | null;
}

export default function BrandList() {
  useUiLocale();
  const canEdit = ['admin', 'marketing', 'merchandising'].includes(
    session.claims()?.role ?? '',
  );
  const [onlyMissingName, setOnlyMissingName] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTh, setEditTh] = useState('');
  const [editEn, setEditEn] = useState('');
  const {
    data = [],
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin-brands', onlyMissingName],
    queryFn: async (): Promise<BrandRow[]> =>
      (await getBrands(onlyMissingName)).data?.data ?? [],
  });
  const save = useMutation({
    mutationFn: ({ id, th, en }: { id: string; th: string; en: string }) =>
      updateBrand(id, { brand_name_th: th, brand_name_en: en }),
    onSuccess: () => {
      setEditingId(null);
      void refetch();
    },
  });
  const busy = isFetching || save.isPending;
  const startEdit = (row: BrandRow) => {
    save.reset();
    setEditingId(row.id);
    setEditTh(row.brand_name_th ?? '');
    setEditEn(row.brand_name_en ?? '');
  };
  const columns: TableColumn<BrandRow>[] = [
    { key: 'brand_code', label: uiText('โค้ด') },
    {
      key: 'brand_name_th',
      label: uiText('ชื่อไทย'),
      render: (value, row) =>
        editingId === row.id ? (
          <Input
            aria-label={uiText('ชื่อไทย')}
            disabled={save.isPending}
            value={editTh}
            onChange={(event) => setEditTh(event.target.value)}
          />
        ) : (
          value || (
            <span className="text-gray-400">{uiText('ยังไม่มีชื่อ')}</span>
          )
        ),
    },
    {
      key: 'brand_name_en',
      label: uiText('ชื่ออังกฤษ'),
      render: (value, row) =>
        editingId === row.id ? (
          <Input
            aria-label={uiText('ชื่ออังกฤษ')}
            disabled={save.isPending}
            value={editEn}
            onChange={(event) => setEditEn(event.target.value)}
          />
        ) : (
          value || '—'
        ),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            label: uiText('จัดการ'),
            render: (_: unknown, row: BrandRow) => (
              <div className="flex flex-wrap gap-2">
                {editingId === row.id ? (
                  <>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        save.mutate({ id: row.id, th: editTh, en: editEn })
                      }
                    >
                      {uiText('บันทึก')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={save.isPending}
                      onClick={() => {
                        setEditingId(null);
                        save.reset();
                      }}
                    >
                      {uiText('ยกเลิก')}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    icon="edit"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => startEdit(row)}
                  >
                    {uiText('แก้ไข')}
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];
  return (
    <div className="cp-management-page flex flex-col gap-5">
      <PageHeader
        title={uiText('Brand Management')}
        subtitle={uiText('ตรวจชื่อแบรนด์ภาษาไทยและอังกฤษ แก้ไขได้จากรายการ')}
        actions={
          <Button
            icon="refresh"
            variant="secondary"
            disabled={busy}
            onClick={() => void refetch()}
          >
            {uiText('รีเฟรช')}
          </Button>
        }
      />
      <div className="cp-list-filter">
        <label>
          <input
            type="checkbox"
            checked={onlyMissingName}
            disabled={save.isPending}
            onChange={(event) => {
              setOnlyMissingName(event.target.checked);
              setEditingId(null);
              save.reset();
            }}
          />
          {uiText('แสดงเฉพาะที่ยังไม่มีชื่อ')}
        </label>
        <span>
          {data.length.toLocaleString()} {uiText('รายการ')}
        </span>
      </div>
      {save.isError && (
        <ErrorText error="บันทึกไม่สำเร็จ ข้อมูลที่แก้ไขยังอยู่ ลองบันทึกอีกครั้ง" />
      )}
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
          data={data}
          loading={isFetching}
          idKey="id"
          emptyTitle="ยังไม่มีแบรนด์ในรายการนี้"
        />
      )}
    </div>
  );
}
