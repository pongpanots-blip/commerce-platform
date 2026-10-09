// ui-metadata-migration: static labels and UI notices only
import { BotResponseTemplate, deleteBotTemplate, getBotTemplates } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const BotTemplates = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<BotResponseTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const response: any = await getBotTemplates();
      const data = response?.data?.data ?? response?.data ?? [];
      setTemplates(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('load bot templates error:', error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm(__uiText("ยืนยันการลบ Template นี้?"))) return;
    await deleteBotTemplate(id);
    loadData();
  };

  const columns: TableColumn<BotResponseTemplate>[] = [
    { key: 'name', label: __uiText("ชื่อ") },
    { key: 'type', label: __uiText("Type") },
    {
      key: 'active',
      label: __uiText("สถานะ"),
      render: (value: boolean) =>
        value ? (
          <span className="text-green-600 text-xs font-semibold">{__uiText("Active")}</span>
        ) : (
          <span className="text-gray-400 text-xs">{__uiText("Inactive")}</span>
        ),
    },
    {
      key: 'actions',
      label: __uiText("จัดการ"),
      render: (_, row) => (
        <div className="flex gap-3">
          <button
            onClick={() => navigate(ADMIN_ROUTES.botTemplateEdit(row.id))}
            className="text-xs text-primary hover:underline"
          >
            {__uiText("แก้ไข")}</button>
          <button
            onClick={() => handleDelete(row.id)}
            className="text-xs text-red-500 hover:underline"
          >
            {__uiText("ลบ")}</button>
        </div>
      ),
    },
  ];

  if (loading) {
    return <div className="cp-management-page text-sm text-gray-500">{__uiText("กำลังโหลด...")}</div>;
  }

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={__uiText("Bot Templates")}
        createLabel={__uiText("เพิ่ม Template")}
        createPath={ADMIN_ROUTES.botTemplateCreate}
      />
      <Table columns={columns} data={templates} idKey="id" />
    </div>
  );
};

export default BotTemplates;
