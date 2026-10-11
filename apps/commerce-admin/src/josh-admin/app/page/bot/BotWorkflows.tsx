// ui-metadata-migration: static labels and UI notices only
import { BotWorkflow, deleteBotWorkflow, getBotWorkflows } from '@josh/shared-api';
import { Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { Button, StatusChip, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";

/** Display labels only; filter values and saved fields stay the codes. */
const EVENT_LABEL: Record<string, () => string> = {
  message: () => __uiText("เมื่อลูกค้าส่งข้อความ"),
  chat_open: () => __uiText("เมื่อลูกค้าเปิดแชต"),
};
const ACTION_LABEL: Record<string, () => string> = {
  tool: () => __uiText("ค้นข้อมูลให้ลูกค้า"),
  llm: () => __uiText("ให้ AI ตอบ"),
  escalate: () => __uiText("ส่งต่อให้พนักงาน"),
};
const TOOL_LABEL: Record<string, () => string> = {
  order_lookup: () => __uiText("ค้นคำสั่งซื้อ"),
  product_search: () => __uiText("ค้นสินค้า"),
  faq: () => __uiText("คำถามที่พบบ่อย"),
  product_recommend: () => __uiText("แนะนำสินค้า"),
};
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
    if (!confirm(__uiText("ลบลำดับการตอบนี้? แชตบอตจะไม่ใช้ลำดับนี้อีก"))) return;
    await deleteBotWorkflow(id);
    loadData();
  };

  const columns: TableColumn<BotWorkflow>[] = [
    { key: 'name', label: __uiText("ชื่อ") },
    {
      key: 'triggerEvent',
      label: __uiText("เริ่มเมื่อ"),
      render: (value: string) => EVENT_LABEL[value || 'message']?.() ?? value,
    },
    {
      key: 'trigger',
      label: __uiText("รูปแบบคำที่ใช้จับ"),
      render: (value: BotWorkflow['trigger']) => value?.pattern ? <span className="font-mono text-xs">{value.pattern}</span> : '-',
    },
    {
      key: 'action',
      label: __uiText("สิ่งที่แชตบอตทำ"),
      render: (value: BotWorkflow['action']) => {
        if (!value?.type) return '-';
        const action = ACTION_LABEL[value.type]?.() ?? value.type;
        if (value.type !== 'tool') return action;
        return `${action}: ${value.toolName ? TOOL_LABEL[value.toolName]?.() ?? value.toolName : '-'}`;
      },
    },
    {
      key: 'steps',
      label: __uiText("จำนวนขั้นตอน"),
      align: 'right',
      render: (_, row: BotWorkflow) => <span className="tabular-nums">{row.steps?.length || 0}</span>,
    },
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
          <Button size="sm" variant="ghost" icon="edit" onClick={() => navigate(ADMIN_ROUTES.botWorkflowEdit(row.id))}>{__uiText("แก้ไข")}</Button>
          <Button size="sm" variant="danger-ghost" icon="delete" onClick={() => handleDelete(row.id)}>{__uiText("ลบ")}</Button>
        </div>
      ),
    },
  ];

  const filteredWorkflows = workflows.filter(w => {
    if (triggerFilter === 'all') return true;
    return w.triggerEvent === triggerFilter;
  });

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={__uiText("ลำดับการตอบของแชตบอต")}
        subtitle={__uiText("กำหนดว่าแชตบอตตอบอะไรทีละขั้น เมื่อลูกค้าส่งข้อความหรือเปิดแชต")}
        createLabel={__uiText("เพิ่มลำดับการตอบ")}
        createPath={ADMIN_ROUTES.botWorkflowCreate}
      />
      <div className="flex items-center gap-3">
        <label htmlFor="workflow-trigger-filter" className="text-sm font-semibold text-gray-700">
          {__uiText("เริ่มเมื่อ")}</label>
        <Select
          id="workflow-trigger-filter"
          className="w-48"
          value={triggerFilter}
          onChange={(e) => setTriggerFilter(e.target.value as 'all' | 'message' | 'chat_open')}
        >
          <option value="all">{__uiText("ทุกแบบ")}</option>
          <option value="message">{EVENT_LABEL.message()}</option>
          <option value="chat_open">{EVENT_LABEL.chat_open()}</option>
        </Select>
      </div>
      <Table
        columns={columns}
        data={filteredWorkflows}
        idKey="id"
        loading={loading}
        emptyTitle={triggerFilter === 'all' ? __uiText("ยังไม่มีลำดับการตอบ") : __uiText("ไม่มีลำดับการตอบที่ตรงกับตัวกรอง")}
        emptyDescription={triggerFilter === 'all' ? __uiText("กด \"เพิ่มลำดับการตอบ\" เพื่อกำหนดว่าแชตบอตตอบอะไร") : __uiText("ลองเลือก \"ทุกแบบ\"")}
      />
    </div>
  );
};

export default BotWorkflows;
