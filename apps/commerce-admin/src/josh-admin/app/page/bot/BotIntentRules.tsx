import { BotIntentRule, deleteBotIntentRule, getBotIntentRules } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import AdminListHeader from '../../components/AdminListHeader';

const BotIntentRules = () => {
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
    if (!confirm('ยืนยันการลบ Intent Rule นี้?')) return;
    await deleteBotIntentRule(id);
    loadData();
  };

  const columns: TableColumn<BotIntentRule>[] = [
    { key: 'intent', label: 'Intent' },
    { key: 'pattern', label: 'Pattern (regex)' },
    {
      key: 'active',
      label: 'สถานะ',
      render: (value: boolean) =>
        value ? (
          <span className="text-green-600 text-xs font-semibold">Active</span>
        ) : (
          <span className="text-gray-400 text-xs">Inactive</span>
        ),
    },
    {
      key: 'actions',
      label: 'จัดการ',
      render: (_, row) => (
        <div className="flex gap-3">
          <button
            onClick={() => navigate(ADMIN_ROUTES.botIntentRuleEdit(row.id))}
            className="text-xs text-primary hover:underline"
          >
            แก้ไข
          </button>
          <button
            onClick={() => handleDelete(row.id)}
            className="text-xs text-red-500 hover:underline"
          >
            ลบ
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">กำลังโหลด...</div>;
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      <AdminListHeader
        title="Bot Intent Rules"
        createLabel="เพิ่ม Intent Rule"
        createPath={ADMIN_ROUTES.botIntentRuleCreate}
      />
      <Table columns={columns} data={rules} idKey="id" />
    </div>
  );
};

export default BotIntentRules;
