// ui-render-cache-locale: refresh memoized UI labels when the language changes
import { getUiLocale as __getUiLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
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

// ui-copy-migration: only literal UI copy and notification templates
import { Alert, Button, Chip, Empty, Loading, type Tone, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS_LABELS = {
  get active(){return __uiText("ใช้งาน");},
  get scheduled(){return __uiText("รอเริ่ม");},
  get expired(){return __uiText("หมดอายุ");},
} as const;

const STATUS_STYLES: Record<string, Tone> = {
  active: 'ok',
  scheduled: 'warn',
  expired: 'muted',
};

type BranchOption = { id: string; name: string };

type Props = {
  branches: BranchOption[];
  /** When set, show a hint that special prices are managed on the company page. */
  companyEditHref?: string;
};

/** Branch-scoped contract prices only. Special/private prices live on the company. */
export function BranchPricingPanel({ branches, companyEditHref }: Props) {
  __useUiLocale();
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
      setError(message ?? __uiMessage("โหลดราคาสัญญาไม่สำเร็จ"));
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
    if (!window.confirm(__uiText("ลบ {0} รายการ?", {"0": selectedIds.length}))) return;
    await bulkDeleteBranchContractPrices(selectedIds);
    setSelectedIds([]);
    await load();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId) return;
    const price = Number(form.price);
    if (!form.sku.trim() || Number.isNaN(price)) {
      setError(__uiMessage("กรุณาระบุ SKU และราคา"));
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
      setError(__uiMessage("บันทึกราคาสัญญาไม่สำเร็จ"));
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
            aria-label={__uiText("เลือกราคาสัญญาของ {0}", {"0": row.sku})}
            checked={selectedIds.includes(row.id)}
            onChange={() => toggleSelect(row.id)}
          />
        ),
      },
      { key: 'sku', label: __uiText("รหัสสินค้า"), render: (value) => <span className="font-mono text-[11px]">{value}</span> },
      { key: 'contract_ref', label: __uiText("เลขสัญญา") },
      {
        key: 'contract_price',
        label: __uiText("ราคาสัญญา"),
        align: 'right',
        render: (value, row) => (
          <button
            type="button"
            className="font-semibold tabular-nums text-primary hover:underline"
            onClick={async () => {
              const next = window.prompt(__uiText('ราคาใหม่ (บาท)'), String(value));
              if (next == null) return;
              const parsed = Number(next);
              if (Number.isNaN(parsed)) return;
              await updateBranchContractPrice(row.id, {
                contract_price: parsed,
              });
              await load();
            }}
          >
            {__uiText("฿")}{Number(value).toLocaleString()}
          </button>
        ),
      },
      {
        key: 'start_date',
        label: __uiText("ช่วงเวลา"),
        render: (_, row) =>
          `${row.start_date} – ${row.end_date ?? __uiText('ไม่กำหนด')}`,
      },
      {
        key: 'status',
        label: __uiText("สถานะ"),
        render: (value: BranchContractPriceListItem['status']) => (
          <Chip tone={STATUS_STYLES[value] ?? 'muted'} statusCode={value} dot>{STATUS_LABELS[value] ?? value}</Chip>
        ),
      },
      {
        key: 'id',
        label: '',
        render: (_, row) => (
          <Button
            size="sm"
            variant="danger-ghost"
            onClick={async () => {
              if (!window.confirm(__uiText("ลบราคาสัญญานี้?"))) return;
              await deleteBranchContractPrice(row.id);
              await load();
            }}
          >
            {__uiText("ลบ")}</Button>
        ),
      },
    ],
    [load, selectedIds, __getUiLocale()],
  );

  if (!branches.length) {
    return (
      <Empty icon="storefront">{__uiText("ยังไม่มีสาขา จึงยังกำหนดราคาสัญญาตามสาขาไม่ได้")}</Empty>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-on-surface-variant">
        {__uiText("ราคาสัญญาของแต่ละสาขา ส่วนราคาพิเศษของบริษัทจัดการที่หน้าบริษัท")}{companyEditHref ? (
          <>
            {' '}
            <Link to={companyEditHref} className="text-primary hover:underline">
              {__uiText("ไปที่บริษัท")}</Link>
          </>
        ) : null}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-48">
          <Select
            label={__uiText("สาขา")}
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

      {error && <Alert tone="danger">{(typeof error === 'string' ? __uiText(error) : error)}</Alert>}

      {selectedIds.length > 0 && (
        <Button
          variant="danger-ghost"
          icon="delete"
          className="w-fit"
          onClick={() => void handleBulkDelete()}
        >
          {__uiText("ลบที่เลือก (")}{selectedIds.length})
        </Button>
      )}

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="grid gap-3 rounded-lg border border-secondary-container bg-surface-container-low p-4 md:grid-cols-[1fr_1fr_1fr_2fr_auto]"
      >
        <Input
          label={__uiText("รหัสสินค้า")}
          value={form.sku}
          onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
        />
        <Input
          label={__uiText("ราคาสัญญา (บาท)")}
          type="number"
          value={form.price}
          onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
        />
        <Input
          label={__uiText("เลขที่สัญญา (ถ้ามี)")}
          value={form.contract_ref}
          onChange={(e) =>
            setForm((f) => ({ ...f, contract_ref: e.target.value }))
          }
        />
        <DateRangeInput
          label={__uiText("ช่วงวันที่มีผล")}
          startDate={form.start_date}
          endDate={form.end_date}
          onStartDateChange={(v) => setForm((f) => ({ ...f, start_date: v }))}
          onEndDateChange={(v) => setForm((f) => ({ ...f, end_date: v }))}
          className="h-10"
        />
        <Button
          type="submit"
          variant="primary"
          icon="add"
          disabled={saving}
          className="self-end"
        >
          {saving ? __uiText("กำลังบันทึก...") : __uiText("เพิ่มราคาสัญญา")}
        </Button>
      </form>

      {loading ? (
        <Loading variant="table" />
      ) : contractRows.length === 0 ? (
        <Empty icon="sell">{__uiText("ยังไม่มีราคาสัญญาสำหรับสาขานี้")}</Empty>
      ) : (
        <Table columns={contractColumns} data={contractRows} idKey="id" />
      )}
    </div>
  );
}

export default BranchPricingPanel;
