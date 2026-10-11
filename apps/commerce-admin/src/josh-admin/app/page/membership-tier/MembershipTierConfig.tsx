// ui-metadata-migration: static labels and UI notices only
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

// ui-copy-migration: only literal UI copy and notification templates
import { Alert, Button, Checkbox, Empty, FormField, FormPanel, Input, Loading, Panel, PanelHead, Table, TableMessage, TBody, TD, TH, THead, TR, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
      return __uiText('รหัสระดับนี้ถูกใช้แล้ว กรุณาใช้รหัสอื่น');
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
  __useUiLocale();
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#999999'}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 shrink-0 cursor-pointer rounded border border-secondary-container bg-surface-container-lowest p-0.5"
        aria-label={__uiText("เลือกสี")}
      />
      <input
        type="text"
        aria-label={__uiText("รหัสสี (Hex)")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#999999"
        className="w-24 rounded-lg border border-secondary-container bg-surface-container-lowest px-2 py-1 font-mono text-[11px] text-on-surface focus:border-primary focus:outline-none"
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
  __useUiLocale();
  const total = distribution.reduce((sum, row) => sum + row.count, 0);

  if (distribution.length === 0) {
    return (
      <Empty icon="bar_chart">{__uiText("ยังไม่มีข้อมูลจำนวนลูกค้าในแต่ละระดับ")}</Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {distribution.map((row) => {
        const label = row.tier?.name ?? __uiText('ยังไม่มีระดับ');
        const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
        const barColor = (row.tier && tierColors[row.tier.id]) || 'var(--color-outline-variant)'; // untiered
        return (
          <div key={row.tier?.id ?? 'untiered'} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-sm text-on-surface">
              {label}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-container">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: barColor }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-on-surface">
              {row.count.toLocaleString()}
            </span>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-on-surface-variant">{pct}%</span>
          </div>
        );
      })}
      <p className="text-xs text-on-surface-variant">{__uiText("รวมทั้งหมด ")}{total.toLocaleString()} {__uiText(" ลูกค้า")}</p>
    </div>
  );
}

export function MembershipTierConfig() {
  __useUiLocale();
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
      .catch((err) => setError(friendlyError(err, __uiText('โหลดข้อมูลระดับสมาชิกไม่สำเร็จ'))))
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
      setStatus(__uiText('บันทึก "{0}" สำเร็จ', { 0: draft.name }));
    } catch (err) {
      setError(friendlyError(err, __uiText('บันทึกไม่สำเร็จ')));
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (tier: MembershipTier) => {
    if (!confirm(__uiText("ยืนยันการลบระดับ \"{0}\"? ลูกค้าในระดับนี้จะไม่มีระดับสมาชิก", {"0": tier.name}))) {
      return;
    }
    setSavingId(tier.id);
    setError(null);
    setStatus(null);
    try {
      await deleteTier(tier.id);
      await loadAll();
      setStatus(__uiText('ลบ "{0}" สำเร็จ', { 0: tier.name }));
    } catch (err) {
      setError(friendlyError(err, __uiText('ลบไม่สำเร็จ')));
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
      setError(friendlyError(err, __uiText('จัดลำดับไม่สำเร็จ')));
    } finally {
      setReordering(false);
    }
  };

  const handleCreate = async () => {
    if (!createDraft.name.trim() || !createDraft.slug.trim()) {
      setError(__uiMessage("กรุณากรอกชื่อและรหัสระดับ"));
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
      setStatus(__uiText('เพิ่มระดับสมาชิกแล้ว'));
    } catch (err) {
      setError(friendlyError(err, __uiText('เพิ่มระดับสมาชิกไม่สำเร็จ')));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={__uiText("ระดับสมาชิก")}
        subtitle={__uiText("กำหนดระดับสมาชิกตามยอดซื้อสะสมของลูกค้า ใช้จัดกลุ่มลูกค้าและสิทธิประโยชน์")}
      >
        {!showCreate && (
          <Button variant="primary" icon="add" onClick={() => setShowCreate(true)}>
            {__uiText("เพิ่มระดับสมาชิก")}</Button>
        )}
      </AdminListHeader>

      {status ? <Alert tone="ok" onClose={() => setStatus(null)}>{status}</Alert> : null}
      {error ? (
        <Alert tone="danger" onClose={() => setError(null)}>
          {(typeof error === 'string' ? __uiText(error) : error)}
        </Alert>
      ) : null}

      {showCreate ? (
        <FormPanel
          title={__uiText("เพิ่มระดับสมาชิก")}
          submitLabel={creating ? __uiText("กำลังสร้าง...") : __uiText("เพิ่มระดับสมาชิก")}
          busy={creating}
          onSubmit={() => handleCreate()}
          onCancel={() => setShowCreate(false)}
        >
          <FormField label={__uiText("ชื่อระดับ")} required>
            <Input
              value={createDraft.name}
              onChange={(e) => setCreateDraft((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={__uiText("เช่น Gold")}
            />
          </FormField>
          <FormField label={__uiText("รหัสระดับ (ภาษาอังกฤษ)")} required hint={__uiText("ตัวพิมพ์เล็ก ไม่มีเว้นวรรค")}>
            <Input
              className="font-mono"
              value={createDraft.slug}
              onChange={(e) =>
                setCreateDraft((prev) => ({
                  ...prev,
                  slug: e.target.value.toLowerCase().replace(/\s+/g, '-'),
                }))
              }
              placeholder={__uiText("เช่น gold")}
            />
          </FormField>
          <FormField label={__uiText("สี")}>
            <TierColorInput
              value={createDraft.color ?? '#999999'}
              onChange={(color) => setCreateDraft((prev) => ({ ...prev, color }))}
            />
          </FormField>
          <FormField label={__uiText("ยอดใช้จ่ายสะสมขั้นต่ำ (บาท)")}>
            <Input
              inputMode="numeric"
              className="text-right"
              value={String(createDraft.min_lifetime_spend ?? 0)}
              onChange={(e) =>
                setCreateDraft((prev) => ({
                  ...prev,
                  min_lifetime_spend: Number(e.target.value) || 0,
                }))
              }
            />
          </FormField>
          <Checkbox
            label={__uiText("เปิดใช้งานระดับนี้")}
            checked={createDraft.is_active ?? true}
            onChange={(e) =>
              setCreateDraft((prev) => ({ ...prev, is_active: e.target.checked }))
            }
          />
        </FormPanel>
      ) : null}

      {loading ? (
        <Panel><Loading variant="table" /></Panel>
      ) : (
        <Panel className="overflow-hidden">
          <Table>
            <THead>
              <TH className="w-16">{__uiText("ลำดับ")}</TH>
              <TH>{__uiText("ชื่อ")}</TH>
              <TH>{__uiText("รหัสระดับ")}</TH>
              <TH>{__uiText("สี")}</TH>
              <TH right>{__uiText("ยอดใช้จ่ายขั้นต่ำ")}</TH>
              <TH>{__uiText("สถานะ")}</TH>
              <TH>{__uiText("จัดการ")}</TH>
            </THead>
            <TBody>
              {tiers.length === 0 ? (
                <TableMessage colSpan={7}>
                  <Empty icon="workspace_premium">{__uiText("ยังไม่มีระดับสมาชิก กด \"เพิ่มระดับสมาชิก\" เพื่อสร้าง")}</Empty>
                </TableMessage>
              ) : (
                tiers.map((tier, index) => {
                  const draft = drafts[tier.id] ?? tier;
                  const dirty = isDirty(tier.id);
                  return (
                    <TR key={tier.id}>
                      <TD>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="arrow_upward"
                            onClick={() => void handleMove(index, -1)}
                            disabled={index === 0 || reordering}
                            aria-label={__uiText("เลื่อนขึ้น")}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="arrow_downward"
                            onClick={() => void handleMove(index, 1)}
                            disabled={index === tiers.length - 1 || reordering}
                            aria-label={__uiText("เลื่อนลง")}
                          />
                        </div>
                      </TD>
                      <TD>
                        <Input
                          aria-label={__uiText("ชื่อระดับ: {0}", {"0": tier.name})}
                          value={draft.name}
                          onChange={(e) => updateDraft(tier.id, { name: e.target.value })}
                          className="w-36"
                        />
                      </TD>
                      <TD>
                        <Input
                          aria-label={__uiText("รหัสระดับของ {0}", {"0": tier.name})}
                          value={draft.slug}
                          onChange={(e) =>
                            updateDraft(tier.id, {
                              slug: e.target.value.toLowerCase().replace(/\s+/g, '-'),
                            })
                          }
                          className="w-32 font-mono"
                        />
                      </TD>
                      <TD>
                        <TierColorInput
                          value={draft.color}
                          onChange={(color) => updateDraft(tier.id, { color })}
                        />
                      </TD>
                      <TD kind="num">
                        <Input
                          type="number"
                          aria-label={__uiText("ยอดใช้จ่ายสะสมขั้นต่ำของ {0} (บาท)", {"0": tier.name})}
                          min={0}
                          value={draft.min_lifetime_spend}
                          onChange={(e) =>
                            updateDraft(tier.id, {
                              min_lifetime_spend: Number(e.target.value) || 0,
                            })
                          }
                          className="ml-auto w-28 text-right"
                        />
                      </TD>
                      <TD>
                        <Checkbox
                          label={draft.is_active ? __uiText("เปิดใช้งาน") : __uiText("ปิดใช้งาน")}
                          checked={draft.is_active}
                          onChange={(e) =>
                            updateDraft(tier.id, { is_active: e.target.checked })
                          }
                        />
                      </TD>
                      <TD kind="actions">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => void handleSaveRow(tier.id)}
                            disabled={!dirty || savingId === tier.id}
                          >
                            {savingId === tier.id ? __uiText("กำลังบันทึก...") : __uiText("บันทึก")}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger-ghost"
                            onClick={() => void handleDelete(tier)}
                            disabled={savingId === tier.id}
                          >
                            {__uiText("ลบ")}</Button>
                        </div>
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>
        </Panel>
      )}

      <Panel>
        <PanelHead icon="bar_chart" title={__uiText("จำนวนลูกค้าในแต่ละระดับ")} />
        <div className="p-4">
          <DistributionBar
            distribution={distribution}
            tierColors={Object.fromEntries(tiers.map((tier) => [tier.id, tier.color]))}
          />
        </div>
      </Panel>
    </div>
  );
}

export default MembershipTierConfig;
