// ui-metadata-migration: static labels and UI notices only
import { getBrands, updateBrand } from '@josh/shared-api';
import { Table, TableColumn, Input, Button } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
interface BrandRow {
  id: string;
  brand_code: string;
  brand_name_th: string | null;
  brand_name_en: string | null;
}

const BrandList = () => {
  __useUiLocale();
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [onlyMissingName, setOnlyMissingName] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTh, setEditTh] = useState('');
  const [editEn, setEditEn] = useState('');

  const loadData = async (missingName: boolean) => {
    try {
      const response: any = await getBrands(missingName);
      setBrands(response?.data?.data ?? []);
    } catch (error: any) {
      console.error('load brands error:', error.message);
    }
  };

  useEffect(() => {
    loadData(onlyMissingName);
  }, [onlyMissingName]);

  const startEdit = (row: BrandRow) => {
    setEditingId(row.id);
    setEditTh(row.brand_name_th ?? '');
    setEditEn(row.brand_name_en ?? '');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await updateBrand(editingId, { brand_name_th: editTh, brand_name_en: editEn });
    setEditingId(null);
    loadData(onlyMissingName);
  };

  const columns: TableColumn<BrandRow>[] = [
    { key: 'brand_code', label: __uiText("โค้ด") },
    {
      key: 'brand_name_th',
      label: __uiText("ชื่อไทย"),
      render: (value: string | null, row) =>
        editingId === row.id ? (
          <Input value={editTh} onChange={(e: any) => setEditTh(e.target.value)} />
        ) : (
          value || <span className="text-gray-400">{__uiText("ยังไม่มีชื่อ")}</span>
        ),
    },
    {
      key: 'brand_name_en',
      label: __uiText("ชื่ออังกฤษ"),
      render: (value: string | null, row) =>
        editingId === row.id ? (
          <Input value={editEn} onChange={(e: any) => setEditEn(e.target.value)} />
        ) : (
          value || <span className="text-gray-400">-</span>
        ),
    },
    {
      key: 'actions',
      label: __uiText("จัดการ"),
      render: (_, row) =>
        editingId === row.id ? (
          <div className="flex gap-2">
            <Button onClick={saveEdit}>{__uiText("บันทึก")}</Button>
            <Button onClick={() => setEditingId(null)}>{__uiText("ยกเลิก")}</Button>
          </div>
        ) : (
          <button
            onClick={() => startEdit(row)}
            className="text-sm text-primary hover:underline"
          >
            {__uiText("แก้ไข")}</button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{__uiText("Brand Management")}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyMissingName}
            onChange={(e) => setOnlyMissingName(e.target.checked)}
          />
          {__uiText("แสดงเฉพาะที่ยังไม่มีชื่อ")}</label>
      </div>
      <Table columns={columns} data={brands} idKey="id" />
    </div>
  );
};

export default BrandList;
