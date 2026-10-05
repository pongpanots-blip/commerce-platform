import {
  createTier,
  deleteTier,
  getTierDistribution,
  listTiers,
  updateTier,
  type CreateMembershipTierPayload,
  type MembershipTier,
  type MembershipTierDistributionEntry,
} from '@josh/shared-api';
import { Button, Input } from '@josh/shared-ui-web';
import axios from 'axios';
import React, { useCallback, useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

/**
 * Membership tier config (Task 10 of the SEGMENTS/TIERS plan). Row-level
 * inline edit (mirrors `CuisineCardsPage` — a `drafts` record keyed by id,
 * synced from the loaded list, saved individually) rather than a modal, plus
 * up/down reorder buttons instead of drag-and-drop: `sort_order` only needs
 * to move one slot at a time here (a handful of tiers, not a long list), so
 * the simpler control avoids pulling in `@hello-pangea/dnd` state wiring for
 * marginal benefit.
 */

const EMPTY_CREATE: CreateMembershipTierPayload = {
  name: '',
  slug: '',
  color: '#999999',
  min_lifetime_spend: 0,
  is_active: true,
};

function friendlyError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 409) {
      return 'Slug นี้ถูกใช้แล้ว — กรุณาเลือก slug อื่น';
    }
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function TierColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#999999'}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
        aria-label="เลือกสี"
      />
      <input
        type="text"
        aria-label="รหัสสี (Hex)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#999999"
        className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-primary focus:outline-none"
      />
    </div>
  );
}

function DistributionBar({
  distribution,
  tierColors,
}: {
  distribution: MembershipTierDistributionEntry[];
  /** `distribution` rows only carry `{id,name,slug}` — look color up from the loaded tier list. */
  tierColors: Record<string, string>;
}) {
  const total = distribution.reduce((sum, row) => sum + row.count, 0);

  if (distribution.length === 0) {
    return (
      <p className="text-sm text-gray-400">ยังไม่มีข้อมูลการกระจายลูกค้าตาม tier</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {distribution.map((row) => {
        const label = row.tier?.name ?? 'ไม่มี Tier';
        const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
        const barColor = (row.tier && tierColors[row.tier.id]) || '#d1d5db'; // gray-300 for untiered
        return (
          <div key={row.tier?.id ?? 'untiered'} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-sm text-gray-700">
              {label}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: barColor }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-sm font-semibold text-gray-800">
              {row.count.toLocaleString()}
            </span>
            <span className="w-10 shrink-0 text-right text-xs text-gray-400">{pct}%</span>
          </div>
        );
      })}
      <p className="text-xs text-gray-400">รวมทั้งหมด {total.toLocaleString()} ลูกค้า</p>
    </div>
  );
}

export function MembershipTierConfig() {
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MembershipTier>>({});
  const [distribution, setDistribution] = useState<MembershipTierDistributionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateMembershipTierPayload>(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [tierList, distributionList] = await Promise.all([
      listTiers(),
      getTierDistribution(),
    ]);
    setTiers(tierList);
    const nextDrafts: Record<string, MembershipTier> = {};
    tierList.forEach((tier) => {
      nextDrafts[tier.id] = { ...tier };
    });
    setDrafts(nextDrafts);
    setDistribution(distributionList);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadAll()
      .catch((err) => setError(friendlyError(err, 'โหลดข้อมูล tier ไม่สำเร็จ')))
      .finally(() => setLoading(false));
  }, [loadAll]);

  const updateDraft = (id: string, patch: Partial<MembershipTier>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const isDirty = (id: string) => {
    const original = tiers.find((t) => t.id === id);
    const draft = drafts[id];
    if (!original || !draft) return false;
    return (
      original.name !== draft.name ||
      original.slug !== draft.slug ||
      original.color !== draft.color ||
      original.min_lifetime_spend !== draft.min_lifetime_spend ||
      original.is_active !== draft.is_active
    );
  };

  const handleSaveRow = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;

    setSavingId(id);
    setError(null);
    setStatus(null);
    try {
      await updateTier(id, {
        name: draft.name,
        slug: draft.slug,
        color: draft.color,
        min_lifetime_spend: Number(draft.min_lifetime_spend) || 0,
        is_active: draft.is_active,
      });
      await loadAll();
      setStatus(`บันทึก "${draft.name}" สำเร็จ`);
    } catch (err) {
      setError(friendlyError(err, 'บันทึกไม่สำเร็จ'));
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (tier: MembershipTier) => {
    if (!confirm(`ยืนยันการลบ tier "${tier.name}"? ลูกค้าที่อยู่ใน tier นี้จะกลายเป็นไม่มี tier`)) {
      return;
    }
    setSavingId(tier.id);
    setError(null);
    setStatus(null);
    try {
      await deleteTier(tier.id);
      await loadAll();
      setStatus(`ลบ "${tier.name}" สำเร็จ`);
    } catch (err) {
      setError(friendlyError(err, 'ลบไม่สำเร็จ'));
    } finally {
      setSavingId(null);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= tiers.length) return;

    const reordered = [...tiers];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    setReordering(true);
    setError(null);
    setStatus(null);
    try {
      const updates = reordered
        .map((tier, i) =>
          tier.sort_order === i ? null : updateTier(tier.id, { sort_order: i }),
        )
        .filter((p): p is Promise<MembershipTier> => p !== null);
      await Promise.all(updates);
      await loadAll();
    } catch (err) {
      setError(friendlyError(err, 'จัดลำดับไม่สำเร็จ'));
    } finally {
      setReordering(false);
    }
  };

  const handleCreate = async () => {
    if (!createDraft.name.trim() || !createDraft.slug.trim()) {
      setError('กรุณากรอกชื่อ และ slug');
      return;
    }
    setCreating(true);
    setError(null);
    setStatus(null);
    try {
      await createTier({
        ...createDraft,
        name: createDraft.name.trim(),
        slug: createDraft.slug.trim().toLowerCase().replace(/\s+/g, '-'),
        min_lifetime_spend: Number(createDraft.min_lifetime_spend) || 0,
        sort_order: tiers.length,
      });
      setCreateDraft(EMPTY_CREATE);
      setShowCreate(false);
      await loadAll();
      setStatus('สร้าง tier สำเร็จ');
    } catch (err) {
      setError(friendlyError(err, 'สร้าง tier ไม่สำเร็จ'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <AdminListHeader
        title="Membership Tiers"
        subtitle="กำหนดระดับสมาชิกตามยอดใช้จ่ายสะสม (lifetime spend) — ใช้จัดกลุ่มลูกค้าและสิทธิประโยชน์"
      >
        <Button
          text={showCreate ? 'ปิดฟอร์ม' : 'เพิ่ม Tier'}
          onClick={() => setShowCreate((prev) => !prev)}
        />
      </AdminListHeader>

      {status ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">การกระจายลูกค้าตาม Tier</h2>
        <DistributionBar
          distribution={distribution}
          tierColors={Object.fromEntries(tiers.map((tier) => [tier.id, tier.color]))}
        />
      </div>

      {showCreate ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="mb-3 font-semibold text-gray-900">เพิ่ม Tier ใหม่</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label="ชื่อ Tier *"
              value={createDraft.name}
              onChange={(e) => setCreateDraft((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="เช่น Gold"
            />
            <Input
              label="Slug *"
              value={createDraft.slug}
              onChange={(e) =>
                setCreateDraft((prev) => ({
                  ...prev,
                  slug: e.target.value.toLowerCase().replace(/\s+/g, '-'),
                }))
              }
              placeholder="เช่น gold"
            />
            <div>
              <span className="mb-1 block text-xs text-gray-500">สี</span>
              <TierColorInput
                value={createDraft.color ?? '#999999'}
                onChange={(color) => setCreateDraft((prev) => ({ ...prev, color }))}
              />
            </div>
            <div>
              <Input
                label="ยอดใช้จ่ายสะสมขั้นต่ำ (บาท)"
                value={String(createDraft.min_lifetime_spend ?? 0)}
                onChange={(e) =>
                  setCreateDraft((prev) => ({
                    ...prev,
                    min_lifetime_spend: Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={createDraft.is_active ?? true}
                onChange={(e) =>
                  setCreateDraft((prev) => ({ ...prev, is_active: e.target.checked }))
                }
              />
              เปิดใช้งาน Tier นี้ (Active)
            </label>
            <div className="md:col-span-2">
              <Button
                text={creating ? 'กำลังสร้าง...' : 'สร้าง Tier'}
                onClick={() => void handleCreate()}
              />
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-gray-400">กำลังโหลด...</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="w-16 p-4">ลำดับ</th>
                  <th className="p-4">ชื่อ</th>
                  <th className="p-4">Slug</th>
                  <th className="p-4">สี</th>
                  <th className="p-4">ยอดใช้จ่ายขั้นต่ำ</th>
                  <th className="p-4">สถานะ</th>
                  <th className="p-4">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                {tiers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-400">
                      ยังไม่มี Tier — กด &quot;เพิ่ม Tier&quot; เพื่อสร้าง
                    </td>
                  </tr>
                ) : (
                  tiers.map((tier, index) => {
                    const draft = drafts[tier.id] ?? tier;
                    const dirty = isDirty(tier.id);
                    return (
                      <tr key={tier.id} className="align-middle hover:bg-gray-50/70">
                        <td className="p-4">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void handleMove(index, -1)}
                              disabled={index === 0 || reordering}
                              className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                              aria-label="เลื่อนขึ้น"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleMove(index, 1)}
                              disabled={index === tiers.length - 1 || reordering}
                              className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                              aria-label="เลื่อนลง"
                            >
                              ↓
                            </button>
                          </div>
                        </td>
                        <td className="p-4">
                          <input
                            type="text"
                            aria-label={`ชื่อ Tier: ${tier.name}`}
                            value={draft.name}
                            onChange={(e) => updateDraft(tier.id, { name: e.target.value })}
                            className="w-36 rounded-lg border border-gray-200 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                          />
                        </td>
                        <td className="p-4">
                          <input
                            type="text"
                            aria-label={`Slug ของ ${tier.name}`}
                            value={draft.slug}
                            onChange={(e) =>
                              updateDraft(tier.id, {
                                slug: e.target.value.toLowerCase().replace(/\s+/g, '-'),
                              })
                            }
                            className="w-32 rounded-lg border border-gray-200 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                          />
                        </td>
                        <td className="p-4">
                          <TierColorInput
                            value={draft.color}
                            onChange={(color) => updateDraft(tier.id, { color })}
                          />
                        </td>
                        <td className="p-4">
                          <input
                            type="number"
                            aria-label={`ยอดใช้จ่ายสะสมขั้นต่ำของ ${tier.name} (บาท)`}
                            min={0}
                            value={draft.min_lifetime_spend}
                            onChange={(e) =>
                              updateDraft(tier.id, {
                                min_lifetime_spend: Number(e.target.value) || 0,
                              })
                            }
                            className="w-28 rounded-lg border border-gray-200 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                          />
                        </td>
                        <td className="p-4">
                          <label className="flex items-center gap-2 text-xs text-gray-700">
                            <input
                              type="checkbox"
                              checked={draft.is_active}
                              onChange={(e) =>
                                updateDraft(tier.id, { is_active: e.target.checked })
                              }
                            />
                            {draft.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                          </label>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleSaveRow(tier.id)}
                              disabled={!dirty || savingId === tier.id}
                              className="text-xs font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
                            >
                              {savingId === tier.id ? 'กำลังบันทึก...' : 'บันทึก'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(tier)}
                              disabled={savingId === tier.id}
                              className="text-xs text-red-500 hover:underline disabled:opacity-40"
                            >
                              ลบ
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default MembershipTierConfig;
