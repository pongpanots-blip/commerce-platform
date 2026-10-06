import type { CuisineHierarchyItem } from '@josh/shared-api';

export type CuisineOption = { id: string; label: string };
export type CuisineGroup = { id: string; label: string; children: CuisineOption[] };

/** Groups level-2 cuisines under their level-1 parent, preserving catalog order. */
export function groupCuisines(
  level1: CuisineHierarchyItem[],
  level2: CuisineHierarchyItem[],
): CuisineGroup[] {
  return level1.map((parent) => ({
    id: parent.id,
    label: parent.cuisine_name,
    children: level2
      .filter((child) => child.parent_id === parent.id)
      .map((child) => ({ id: child.id, label: child.cuisine_name })),
  }));
}

export function toggleGroupId(parentIds: string[], groupId: string): string[] {
  return parentIds.includes(groupId)
    ? parentIds.filter((id) => id !== groupId)
    : [...parentIds, groupId];
}

export function toggleChildId(cuisineIds: string[], childId: string): string[] {
  return cuisineIds.includes(childId)
    ? cuisineIds.filter((id) => id !== childId)
    : [...cuisineIds, childId];
}

/** A child is locked (checked + disabled) once its parent group is selected. */
export function isChildLocked(parentId: string, parentIds: string[]): boolean {
  return parentIds.includes(parentId);
}

/** Case-insensitive filter — a matching group keeps all its children, otherwise only matching children. */
export function filterCuisineGroups(groups: CuisineGroup[], search: string): CuisineGroup[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return groups;
  return groups
    .map((group) => {
      const groupMatches = group.label.toLowerCase().includes(needle);
      const children = groupMatches
        ? group.children
        : group.children.filter((child) => child.label.toLowerCase().includes(needle));
      return { ...group, children };
    })
    .filter((group) => group.label.toLowerCase().includes(needle) || group.children.length > 0);
}
