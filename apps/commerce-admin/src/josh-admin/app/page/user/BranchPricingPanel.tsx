import {
  bulkDeleteBranchContractPrices,
  createBranchContractPrice,
  deleteBranchContractPrice,
  getBranchContractPrices,
  type BranchContractPriceListItem,
  updateBranchContractPrice,
} from '@josh/shared-api';
import { DateRangeInput, Input, Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const STATUS_LABELS = {
  active: 'ใช้งาน',
  scheduled: 'รอเริ่ม',
  expired: 'หมดอายุ',
} as const;

const STATUS_STYLES = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  scheduled: 'bg-amber-50 text-amber-700 border-amber-200',
  expired: 'bg-gray-100 text-gray-600 border-gray-200',
} as const;

type BranchOption = { id: string; name: string };

type Props = {
  branches: BranchOption[];
  /** When set, show a hint that special prices are managed on the company page. */
  companyEditHref?: string;
};

/** Branch-scoped contract prices only. Special/private prices live on the company. */
export function BranchPricingPanel({ branches, companyEditHref }: Props) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [contractRows, setContractRows] = useState<BranchContractPriceListItem[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    sku: '',
    price: '',
    contract_ref: '',
    start_date: '',
    end_date: '',
  });

  useEffect(() => {
    if (!branchId && branches[0]?.id) {
      setBranchId(branches[0].id);
    }
  }, [branchId, branches]);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError('');
    try {
      const contractRes = await getBranchContractPrices(branchId);
      setContractRows(contractRes?.data ?? []);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      setError(message ?? 'โหลดราคาสัญญาไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`ลบ ${selectedIds.length} รายการ?`)) return;
    await bulkDeleteBranchContractPrices(selectedIds);
    setSelectedIds([]);
    await load();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId) return;
    const price = Number(form.price);
    if (!form.sku.trim() || Number.isNaN(price)) {
      setError('กรุณาระบุ SKU และราคา');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await createBranchContractPrice(branchId, {
        sku: form.sku.trim(),
        contract_price: price,
        contract_ref: form.contract_ref || undefined,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
      });
      setForm({
        sku: '',
        price: '',
        contract_ref: '',
        start_date: '',
        end_date: '',
      });
      await load();
    } catch {
      setError('บันทึกราคาสัญญาไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const contractColumns: TableColumn<BranchContractPriceListItem>[] = useMemo(
    () => [
      {
        key: 'id',
        label: '',
        render: (_, row) => (
          <input
            type="checkbox"
            aria-label={`เลือกราคาสัญญาของ ${row.sku}`}
            checked={selectedIds.includes(row.id)}
            onChange={() => toggleSelect(row.id)}
          />
        ),
      },
      { key: 'sku', label: 'SKU' },
      { key: 'contract_ref', label: 'เลขสัญญา' },
      {
        key: 'contract_price',
        label: 'ราคาสัญญา',
        render: (value, row) => (
          <button
            type="button"
            className="font-semibold text-primary hover:underline"
            onClick={async () => {
              const next = window.prompt('ราคาใหม่ (บาท)', String(value));
              if (next == null) return;
              const parsed = Number(next);
              if (Number.isNaN(parsed)) return;
              await updateBranchContractPrice(row.id, {
                contract_price: parsed,
              });
              await load();
            }}
          >
            ฿{Number(value).toLocaleString()}
          </button>
        ),
      },
      {
        key: 'start_date',
        label: 'ช่วงเวลา',
        render: (_, row) =>
          `${row.start_date} – ${row.end_date ?? 'ไม่กำหนด'}`,
      },
      {
        key: 'status',
        label: 'สถานะ',
        render: (value: BranchContractPriceListItem['status']) => (
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[value]}`}
          >
            {STATUS_LABELS[value]}
          </span>
        ),
      },
      {
        key: 'id',
        label: '',
        render: (_, row) => (
          <button
            type="button"
            className="text-xs text-red-600 hover:underline"
            onClick={async () => {
              if (!window.confirm('ลบราคาสัญญานี้?')) return;
              await deleteBranchContractPrice(row.id);
              await load();
            }}
          >
            ลบ
          </button>
        ),
      },
    ],
    [load, selectedIds],
  );

  if (!branches.length) {
    return (
      <p className="p-4 text-sm text-gray-500">
        ยังไม่มีสาขา — ไม่สามารถกำหนดราคาสัญญาตาม branch ได้
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-gray-500">
        ราคาสัญญาต่อสาขา · ราคาพิเศษ (Customer SKU) จัดการที่หน้าบริษัท
        {companyEditHref ? (
          <>
            {' '}
            <Link to={companyEditHref} className="text-primary hover:underline">
              ไปที่บริษัท
            </Link>
          </>
        ) : null}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-48">
          <Select
            label="สาขา"
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setSelectedIds([]);
            }}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {selectedIds.length > 0 && (
        <button
          type="button"
          onClick={() => void handleBulkDelete()}
          className="w-fit rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          ลบที่เลือก ({selectedIds.length})
        </button>
      )}

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="grid gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4 md:grid-cols-[1fr_1fr_1fr_2fr_auto]"
      >
        <Input
          label="รหัสสินค้า (SKU)"
          value={form.sku}
          onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
        />
        <Input
          label="ราคาสัญญา (บาท)"
          type="number"
          value={form.price}
          onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
        />
        <Input
          label="เลขที่สัญญา (ถ้ามี)"
          value={form.contract_ref}
          onChange={(e) =>
            setForm((f) => ({ ...f, contract_ref: e.target.value }))
          }
        />
        <DateRangeInput
          label="ช่วงวันที่มีผล"
          startDate={form.start_date}
          endDate={form.end_date}
          onStartDateChange={(v) => setForm((f) => ({ ...f, start_date: v }))}
          onEndDateChange={(v) => setForm((f) => ({ ...f, end_date: v }))}
          className="h-10"
        />
        <button
          type="submit"
          disabled={saving}
          className="h-10 self-end rounded-lg bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'กำลังบันทึก...' : 'เพิ่มราคาสัญญา'}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-500">กำลังโหลด...</p>
      ) : contractRows.length === 0 ? (
        <p className="text-sm text-gray-500">ยังไม่มีราคาสัญญาสำหรับสาขานี้</p>
      ) : (
        <Table columns={contractColumns} data={contractRows} idKey="id" />
      )}
    </div>
  );
}

export default BranchPricingPanel;
