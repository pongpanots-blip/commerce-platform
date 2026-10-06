import { getCuisineCatalog } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useEffect, useMemo, useState } from 'react';
import { AiOutlineSearch } from 'react-icons/ai';
import {
  filterCuisineGroups,
  groupCuisines,
  isChildLocked,
  toggleChildId,
  toggleGroupId,
  type CuisineGroup,
} from './cuisine-select.helpers';

type Props = {
  selectedCuisineIds: string[];
  selectedParentIds: string[];
  onChange: (next: { cuisine_ids: string[]; parent_ids: string[] }) => void;
};

/** เลือกประเภทร้านแบบหลายรายการ จัดกลุ่มตาม cuisine level 1 → level 2 — ทรงเดียวกับ
 * PromotionBrandMultiSelect/PromotionCategoryMultiSelect. ติ๊กกลุ่มแล้วลูกในกลุ่มจะติ๊กตามและ disable ไปด้วย. */
export function CuisineMultiSelect({ selectedCuisineIds, selectedParentIds, onChange }: Props) {
  const [groups, setGroups] = useState<CuisineGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [level1, level2] = await Promise.all([
          getCuisineCatalog({ level: 1 }),
          getCuisineCatalog({ level: 2 }),
        ]);
        setGroups(groupCuisines(level1, level2));
        setLoadError(false);
      } catch {
        setGroups([]);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => filterCuisineGroups(groups, search), [groups, search]);
  const total = selectedCuisineIds.length + selectedParentIds.length;
  const byGroupId = useMemo(() => new Map(groups.map((g) => [g.id, g.label])), [groups]);
  const byChildId = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((group) => group.children.forEach((child) => map.set(child.id, child.label)));
    return map;
  }, [groups]);

  const toggleGroup = (groupId: string) => {
    onChange({ cuisine_ids: selectedCuisineIds, parent_ids: toggleGroupId(selectedParentIds, groupId) });
  };

  const toggleChild = (childId: string, parentId: string) => {
    if (isChildLocked(parentId, selectedParentIds)) return;
    onChange({ cuisine_ids: toggleChildId(selectedCuisineIds, childId), parent_ids: selectedParentIds });
  };

  const removeGroupChip = (id: string) => {
    onChange({ cuisine_ids: selectedCuisineIds, parent_ids: selectedParentIds.filter((x) => x !== id) });
  };

  const removeChildChip = (id: string) => {
    onChange({ cuisine_ids: selectedCuisineIds.filter((x) => x !== id), parent_ids: selectedParentIds });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-lg border-2 border-primary-border bg-white px-3 py-2 text-sm text-ink hover:border-primary"
      >
        <span>เลือกประเภทร้าน ({total})</span>
        <span className="text-xs text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {loadError && (
        <p className="mt-1 text-xs text-red-600">
          โหลดข้อมูลประเภทร้านไม่สำเร็จ ลองรีเฟรชหน้านี้อีกครั้ง
        </p>
      )}

      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 p-2">
            <Input
              icon={<AiOutlineSearch size={18} />}
              placeholder="ค้นหาประเภทร้าน..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {loading ? (
              <p className="py-4 text-center text-xs text-gray-400">กำลังโหลด...</p>
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-400">ไม่พบประเภทร้าน</p>
            ) : (
              <ul>
                {filtered.map((group) => (
                  <li key={group.id} className="mb-1">
                    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm font-semibold text-gray-800">
                      <input
                        type="checkbox"
                        checked={selectedParentIds.includes(group.id)}
                        onChange={() => toggleGroup(group.id)}
                      />
                      <span>{group.label}</span>
                    </label>
                    <ul>
                      {group.children.map((child) => {
                        const locked = isChildLocked(group.id, selectedParentIds);
                        return (
                          <li key={child.id} style={{ paddingLeft: 16 }}>
                            <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={locked || selectedCuisineIds.includes(child.id)}
                                disabled={locked}
                                onChange={() => toggleChild(child.id, group.id)}
                              />
                              <span className={locked ? 'text-gray-400' : ''}>{child.label}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-gray-100 p-2 text-right">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10"
            >
              เสร็จสิ้น
            </button>
          </div>
        </div>
      )}

      {(selectedParentIds.length > 0 || selectedCuisineIds.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selectedParentIds.map((id) => (
            <span
              key={`group-${id}`}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
            >
              <span>{byGroupId.get(id) ?? id}</span>
              <button
                type="button"
                onClick={() => removeGroupChip(id)}
                aria-label={`นำ ${byGroupId.get(id) ?? id} ออก`}
                className="ml-1 text-gray-400 hover:text-red-500"
              >
                ×
              </button>
            </span>
          ))}
          {selectedCuisineIds.map((id) => (
            <span
              key={`child-${id}`}
              className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-600"
            >
              <span>{byChildId.get(id) ?? id}</span>
              <button
                type="button"
                onClick={() => removeChildChip(id)}
                aria-label={`นำ ${byChildId.get(id) ?? id} ออก`}
                className="ml-1 text-gray-400 hover:text-red-500"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default CuisineMultiSelect;
