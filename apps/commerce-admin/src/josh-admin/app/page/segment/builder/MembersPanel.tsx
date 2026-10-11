// ui-metadata-migration: static labels and UI notices only
import { getSegmentMembers, type SegmentMemberRow } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { Chip, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const PAGE_LIMIT = 20;

const TIER_LABELS: Record<string, string> = {
  get platinum() { return __uiText("แพลทินัม"); },
  get gold() { return __uiText("โกลด์"); },
  get silver() { return __uiText("ซิลเวอร์"); },
  get bronze() { return __uiText("บรอนซ์"); },
};

function formatBaht(value: number): string {
  return `฿${value.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`;
}

type Props = {
  segmentId: string;
};

/**
 * "ดูรายชื่อ" panel (Task 9 step 4) — paginated members matching a *saved*
 * segment. `GET /user-segments/:id/members` needs a persisted segment id, so
 * this only renders once the segment has been saved (see SegmentBuilder).
 */
export function MembersPanel({ segmentId }: Props) {
  __useUiLocale();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SegmentMemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (id: string, pageNum: number) => {
    setLoading(true);
    try {
      const { items, total: totalCount } = await getSegmentMembers(
        id,
        pageNum,
        PAGE_LIMIT,
      );
      setRows(items);
      setTotal(totalCount);
    } catch {
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    void load(segmentId, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentId]);

  useEffect(() => {
    void load(segmentId, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const columns: TableColumn<SegmentMemberRow>[] = [
    { key: 'name', label: __uiText("ชื่อ") },
    { key: 'email', label: __uiText("อีเมล") },
    {
      key: 'tier',
      label: __uiText("ระดับสมาชิก"),
      render: (value: string | null) =>
        value ? (
          <Chip>{TIER_LABELS[value] ?? value}</Chip>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        ),
    },
    {
      key: 'lifetime_spend',
      label: __uiText("ยอดใช้จ่ายสะสม"),
      align: 'right',
      className: 'tabular-nums whitespace-nowrap',
      render: (value: number) => formatBaht(Number(value ?? 0)),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      {loading && rows.length === 0 ? (
        <p className="text-sm text-gray-400">{__uiText("กำลังโหลดรายชื่อ...")}</p>
      ) : (
        <Table
          columns={columns}
          data={rows}
          idKey="id"
          totalItems={total}
          currentPage={page}
          pageSize={PAGE_LIMIT}
          onPageChange={setPage}
          emptyTitle={__uiText("ยังไม่มีลูกค้าที่ตรงเงื่อนไข")}
          emptyDescription={__uiText("ลองปรับเงื่อนไขด้านบนแล้วบันทึกอีกครั้ง")}
        />
      )}
    </div>
  );
}

export default MembersPanel;
