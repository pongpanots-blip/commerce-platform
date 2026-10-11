// ui-metadata-migration: static labels and UI notices only
import { BotResponseTemplate, deleteBotTemplate, getBotTemplates } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { Button, StatusChip, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";

/** Display labels only; the saved type stays the code. */
const TYPE_LABEL: Record<string, () => string> = {
  card: () => __uiText("การ์ด"),
  card_list: () => __uiText("การ์ดหลายใบ"),
  text: () => __uiText("ข้อความ"),
  rich_text: () => __uiText("ข้อความจัดรูปแบบ"),
  options: () => __uiText("ตัวเลือกให้กด"),
};
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
    if (!confirm(__uiText("ลบข้อความสำเร็จรูปนี้? แชตบอตจะใช้ข้อความนี้ไม่ได้อีก"))) return;
    await deleteBotTemplate(id);
    loadData();
  };

  const columns: TableColumn<BotResponseTemplate>[] = [
    { key: 'name', label: __uiText("ชื่อ") },
    { key: 'type', label: __uiText("รูปแบบ"), render: (value: string) => TYPE_LABEL[value]?.() ?? value },
    {
      key: 'active',
      label: __uiText("สถานะ"),
      render: (value: boolean) => <StatusChip status={value ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (_, row) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" icon="edit" onClick={() => navigate(ADMIN_ROUTES.botTemplateEdit(row.id))}>{__uiText("แก้ไข")}</Button>
          <Button size="sm" variant="danger-ghost" icon="delete" onClick={() => handleDelete(row.id)}>{__uiText("ลบ")}</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={__uiText("ข้อความสำเร็จรูปของแชตบอต")}
        subtitle={__uiText("ข้อความและการ์ดที่แชตบอตใช้ตอบลูกค้า")}
        createLabel={__uiText("เพิ่มข้อความสำเร็จรูป")}
        createPath={ADMIN_ROUTES.botTemplateCreate}
      />
      <Table
        columns={columns}
        data={templates}
        idKey="id"
        loading={loading}
        emptyTitle={__uiText("ยังไม่มีข้อความสำเร็จรูป")}
        emptyDescription={__uiText("กด \"เพิ่มข้อความสำเร็จรูป\" เพื่อสร้างข้อความหรือการ์ดให้แชตบอตใช้ตอบ")}
      />
    </div>
  );
};

export default BotTemplates;
