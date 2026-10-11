// ui-metadata-migration: static labels and UI notices only
import { BotIntentRule, deleteBotIntentRule, getBotIntentRules } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { Button, StatusChip, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";

/** Display labels only; the saved intent stays the code. */
const INTENT_LABEL: Record<string, () => string> = {
  order_lookup: () => __uiText("ถามเรื่องคำสั่งซื้อ"),
  product_search: () => __uiText("หาสินค้า"),
  faq_general: () => __uiText("คำถามทั่วไป"),
  escalate: () => __uiText("ขอคุยกับพนักงาน"),
};

const BotIntentRules = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [rules, setRules] = useState<BotIntentRule[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const response: any = await getBotIntentRules();
      const data = response?.data?.data ?? response?.data ?? [];
      setRules(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('load bot intent rules error:', error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm(__uiText("ลบกติกานี้? แชตบอตจะไม่ใช้กติกานี้อีก"))) return;
    await deleteBotIntentRule(id);
    loadData();
  };

  const columns: TableColumn<BotIntentRule>[] = [
    { key: 'intent', label: __uiText("ลูกค้าต้องการอะไร"), render: (value: string) => INTENT_LABEL[value]?.() ?? value },
    { key: 'pattern', label: __uiText("รูปแบบคำที่ใช้จับ"), render: (value: string) => <span className="font-mono text-xs">{value}</span> },
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
          <Button size="sm" variant="ghost" icon="edit" onClick={() => navigate(ADMIN_ROUTES.botIntentRuleEdit(row.id))}>{__uiText("แก้ไข")}</Button>
          <Button size="sm" variant="danger-ghost" icon="delete" onClick={() => handleDelete(row.id)}>{__uiText("ลบ")}</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={__uiText("คำถามที่แชตบอตเข้าใจ")}
        subtitle={__uiText("กติกาที่ช่วยให้แชตบอตเข้าใจคำถามของลูกค้า")}
        createLabel={__uiText("เพิ่มกติกา")}
        createPath={ADMIN_ROUTES.botIntentRuleCreate}
      />
      <Table
        columns={columns}
        data={rules}
        idKey="id"
        loading={loading}
        emptyTitle={__uiText("ยังไม่มีกติกา")}
        emptyDescription={__uiText("กด \"เพิ่มกติกา\" เพื่อสอนแชตบอตให้เข้าใจคำถามแบบใหม่")}
      />
    </div>
  );
};

export default BotIntentRules;
