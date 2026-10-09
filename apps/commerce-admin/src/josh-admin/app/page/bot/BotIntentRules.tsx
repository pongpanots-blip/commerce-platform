// ui-metadata-migration: static labels and UI notices only
import { BotIntentRule, deleteBotIntentRule, getBotIntentRules } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
    if (!confirm(__uiText("ยืนยันการลบ Intent Rule นี้?"))) return;
    await deleteBotIntentRule(id);
    loadData();
  };

  const columns: TableColumn<BotIntentRule>[] = [
    { key: 'intent', label: __uiText("Intent") },
    { key: 'pattern', label: __uiText("Pattern (regex)") },
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
            onClick={() => navigate(ADMIN_ROUTES.botIntentRuleEdit(row.id))}
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
        title={__uiText("Bot Intent Rules")}
        createLabel={__uiText("เพิ่ม Intent Rule")}
        createPath={ADMIN_ROUTES.botIntentRuleCreate}
      />
      <Table columns={columns} data={rules} idKey="id" />
    </div>
  );
};

export default BotIntentRules;
