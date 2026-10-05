import {
  deleteUserSegment,
  getUserSegments,
  previewUserSegmentCount,
  type UserSegmentListItem,
} from '@josh/shared-api';
import { Button, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AiOutlineDelete, AiOutlineEdit, AiOutlineEye } from 'react-icons/ai';
import { Link, useNavigate } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { getRuleTypeLabel, isLiveSegment, summarizeRuleConfig } from './segment-rule.helpers';

const SegmentList = () => {
  const navigate = useNavigate();
  const [segments, setSegments] = useState<UserSegmentListItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Legacy non-live segments only — `frozen_at === null` means never previewed since the
  // freeze-on-read change, so one preview call freezes them. Live rows and already-frozen
  // rows never call this; `member_count` from the list response covers them.
  const [lazyFrozenCounts, setLazyFrozenCounts] = useState<Record<string, number>>({});
  const [lazyFreezingIds, setLazyFreezingIds] = useState<Set<string>>(new Set());
  // Bumped on every loadData() so a slow lazy-freeze from a stale load (e.g. before a
  // delete) can't overwrite counts from the load that replaced it.
  const loadSeq = useRef(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    const seq = ++loadSeq.current;
    setLazyFrozenCounts({});
    setLazyFreezingIds(new Set());
    try {
      const items = await getUserSegments();
      if (seq !== loadSeq.current) return;
      setSegments(items);

      const toFreeze = items.filter(
        (segment) => !isLiveSegment(segment.rule_type, segment.definition) && segment.frozen_at === null,
      );
      setLazyFreezingIds(new Set(toFreeze.map((s) => s.id)));
      const freezes = toFreeze.map((segment) =>
        previewUserSegmentCount(segment.id)
          .then((count) => {
            if (seq !== loadSeq.current) return;
            setLazyFrozenCounts((prev) => ({ ...prev, [segment.id]: count }));
          })
          .catch((error: unknown) => {
            console.error('lazy freeze failed:', segment.id, error);
          })
          .finally(() => {
            if (seq === loadSeq.current) {
              setLazyFreezingIds((prev) => {
                const next = new Set(prev);
                next.delete(segment.id);
                return next;
              });
            }
          }),
      );
      // Re-read once so freshly frozen rows show their "ล็อกเมื่อ" date too, not just the count.
      if (freezes.length > 0) {
        void Promise.allSettled(freezes)
          .then(() => getUserSegments())
          .then((fresh) => {
            if (seq === loadSeq.current) setSegments(fresh);
          })
          .catch((error: unknown) => console.error('reload after freeze failed:', error));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'load failed';
      console.error('load segments error:', message);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`ยืนยันการลบ segment "${name}"?`)) return;
    try {
      await deleteUserSegment(id);
      await loadData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'delete failed';
      alert(`ลบไม่สำเร็จ: ${message}`);
    }
  };

  const columns: TableColumn<UserSegmentListItem>[] = [
    {
      key: 'name',
      label: 'ชื่อ',
      render: (value: string, row) => (
        <div>
          <Link
            to={
              row.definition
                ? ADMIN_ROUTES.segmentBuilderEdit(row.id)
                : ADMIN_ROUTES.segmentEdit(row.id)
            }
            className="font-semibold text-blue-600 hover:underline"
          >
            {value}
          </Link>
          <div className="font-mono text-xs text-gray-400">{row.slug}</div>
        </div>
      ),
    },
    {
      key: 'rule_type',
      label: 'Rule Type',
      render: (value: string, row) =>
        row.definition ? (
          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
            Visual Builder
          </span>
        ) : (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
            {getRuleTypeLabel(value)}
          </span>
        ),
    },
    {
      key: 'rule_config',
      label: 'Config',
      render: (_, row) =>
        row.definition ? (
          <span className="text-xs text-gray-400">เงื่อนไขแบบ AND/OR — แก้ไขใน Builder</span>
        ) : (
          <span className="line-clamp-2 max-w-[220px] text-xs text-gray-500">
            {summarizeRuleConfig(row.rule_type, row.rule_config)}
          </span>
        ),
    },
    {
      key: 'member_count',
      label: 'สมาชิก',
      render: (_, row) => {
        if (isLiveSegment(row.rule_type, row.definition)) {
          return (
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-gray-700">—</span>
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                live
              </span>
            </div>
          );
        }

        const freezing = lazyFreezingIds.has(row.id);
        const count = row.member_count ?? lazyFrozenCounts[row.id] ?? null;
        const frozenAt = row.frozen_at;

        return (
          <div className="text-sm">
            <span className="text-gray-700">
              {freezing ? '…' : count != null ? `${count.toLocaleString()} คน` : '—'}
            </span>
            {frozenAt ? (
              <div className="text-xs text-gray-400">
                ล็อกเมื่อ {new Date(frozenAt).toLocaleString('th-TH')}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'is_active',
      label: 'สถานะ',
      render: (value: boolean) =>
        value ? (
          <span className="text-xs font-semibold text-green-600">Active</span>
        ) : (
          <span className="text-xs text-gray-400">Inactive</span>
        ),
    },
    {
      key: 'actions',
      label: 'จัดการ',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <Link
            to={
              row.definition
                ? ADMIN_ROUTES.segmentBuilderEdit(row.id)
                : ADMIN_ROUTES.segmentEdit(row.id)
            }
            className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
            title="แก้ไข"
            aria-label="แก้ไข"
          >
            <AiOutlineEdit size={18} />
          </Link>
          <Link
            to={`${ADMIN_ROUTES.users}?segment=${row.id}`}
            className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
            title="ดู Users"
            aria-label="ดู Users"
          >
            <AiOutlineEye size={18} />
          </Link>
          <button
            type="button"
            onClick={() => handleDelete(row.id, row.name)}
            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="ลบ"
            aria-label="ลบ"
          >
            <AiOutlineDelete size={18} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5 p-4">
      <AdminListHeader
        title="User Segments"
        subtitle="กลุ่มลูกค้าที่ล็อกรายชื่อตอนสร้าง — ใช้กับ Coupon, Banner และกรองรายชื่อ Users"
        createLabel="เพิ่ม Segment"
        createPath={ADMIN_ROUTES.segmentCreate}
      >
        <Button
          text="สร้างด้วย Visual Builder"
          onClick={() => navigate(ADMIN_ROUTES.segmentBuilderCreate)}
        />
      </AdminListHeader>

      {loading && (
        <div className="text-sm text-gray-400">กำลังโหลด...</div>
      )}

      <Table
        columns={columns}
        data={segments}
        idKey="id"
        totalItems={segments.length}
        currentPage={1}
        totalPages={1}
        onPageChange={() => undefined}
      />
    </div>
  );
};

export default SegmentList;
