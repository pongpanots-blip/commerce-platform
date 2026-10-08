// ui-metadata-migration: static labels and UI notices only
import { BotWorkflow, deleteBotWorkflow, getBotWorkflows } from '@josh/shared-api';
import { Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const BotWorkflows = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<BotWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggerFilter, setTriggerFilter] = useState<'all' | 'message' | 'chat_open'>('all');

  const loadData = async () => {
    setLoading(true);
    try {
      const response: any = await getBotWorkflows();
      const data = response?.data?.data ?? response?.data ?? [];
      setWorkflows(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('load bot workflows error:', error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm(__uiText("ยืนยันการลบ Workflow นี้?"))) return;
    await deleteBotWorkflow(id);
    loadData();
  };

  const columns: TableColumn<BotWorkflow>[] = [
    { key: 'name', label: __uiText("ชื่อ") },
    {
      key: 'trigger',
      label: __uiText("Trigger Pattern"),
      render: (value: BotWorkflow['trigger']) => value?.pattern ?? '-',
    },
    {
      key: 'action',
      label: __uiText("Action"),
      render: (value: BotWorkflow['action']) =>
        value?.type === 'tool' ? `tool: ${value.toolName ?? '-'}` : value?.type ?? '-',
    },
    {
      key: 'steps',
      label: __uiText("Steps"),
      render: (_, row: BotWorkflow) => row.steps?.length || 0,
    },
    {
      key: 'triggerEvent',
      label: __uiText("Trigger"),
      render: (value: string) => value || 'message',
    },
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
            onClick={() => navigate(ADMIN_ROUTES.botWorkflowEdit(row.id))}
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
    return <div className="p-6 text-sm text-gray-500">{__uiText("กำลังโหลด...")}</div>;
  }

  const filteredWorkflows = workflows.filter(w => {
    if (triggerFilter === 'all') return true;
    return w.triggerEvent === triggerFilter;
  });

  return (
    <div className="flex flex-col gap-5 p-4">
      <AdminListHeader
        title={__uiText("Bot Workflows")}
        createLabel={__uiText("เพิ่ม Workflow")}
        createPath={ADMIN_ROUTES.botWorkflowCreate}
      />
      <div className="flex items-center gap-3">
        <label htmlFor="workflow-trigger-filter" className="text-sm font-semibold text-gray-700">
          {__uiText("กรองตาม Trigger")}</label>
        <Select
          id="workflow-trigger-filter"
          className="w-48"
          value={triggerFilter}
          onChange={(e) => setTriggerFilter(e.target.value as 'all' | 'message' | 'chat_open')}
        >
          <option value="all">{__uiText("All Triggers")}</option>
          <option value="message">{__uiText("Message")}</option>
          <option value="chat_open">{__uiText("Chat Open")}</option>
        </Select>
      </div>
      <Table columns={columns} data={filteredWorkflows} idKey="id" />
    </div>
  );
};

export default BotWorkflows;
