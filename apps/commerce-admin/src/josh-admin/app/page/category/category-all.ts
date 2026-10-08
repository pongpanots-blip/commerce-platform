/** Josh web #549. Same id as commerce's seed. */
export const ALL_CATEGORY_ID = '00000000-0000-4000-8000-000000000a11';

export function isAllCategory(id: string | null | undefined): boolean {
  return id === ALL_CATEGORY_ID;
}

/** Home category pins All first. A drag that lands above it is put back. */
export function pinAllCategoryFirst<T extends { category_id_uuid: string }>(rows: T[]): T[] {
  const all = rows.filter((row) => row.category_id_uuid === ALL_CATEGORY_ID);
  if (!all.length) return rows;
  return [...all, ...rows.filter((row) => row.category_id_uuid !== ALL_CATEGORY_ID)];
}

/** Division (parent null) is not All. All is level 1 and only appears on the home list. */
export function withoutAllAtRoot<T extends { category_id_uuid: string }>(rows: T[], parentId: string | null): T[] {
  if (parentId !== null) return rows;
  return rows.filter((row) => row.category_id_uuid !== ALL_CATEGORY_ID);
}
