// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
import { getCuisineNamesAdmin, updateCuisineNameTh, type CuisineNameAdminRow } from '@josh/shared-api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

const CUISINE_NAMES_QUERY_KEY = ['cuisine-names-admin'];

function levelIndent(level: number): string {
  const px = level * 24;
  return `${px}px`;
}

function CuisineNameRow({ row, onSave }: { row: CuisineNameAdminRow; onSave: (value: string | null) => void }) {
  const [value, setValue] = useState(row.cuisine_name_th ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    setIsSaving(true);
    try {
      await onSave(value.trim() === '' ? null : value.trim());
    } catch (err) {
      setError((err as Error).message || 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <tr className={!row.is_active ? 'opacity-50' : ''}>
      <td className="py-2 px-4 text-sm border-b">
        <div style={{ paddingLeft: levelIndent(row.level) }}>
          <span className="text-ink-muted">{row.cuisine_name}</span>
        </div>
      </td>
      <td className="py-2 px-4 text-sm border-b">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            disabled={isSaving}
            placeholder="ไทยชื่อ"
            className="flex-1 px-2 py-1 border rounded text-sm disabled:opacity-50"
          />
          {error && <span className="text-xs text-red-600">{error}</span>}
          {isSaving && <span className="text-xs text-ink-muted">บันทึก...</span>}
        </div>
      </td>
    </tr>
  );
}

/**
 * `/admin/cuisine-names` — Edit Thai names (cuisine_name_th) for all cuisine rows
 * Displays a table: English name (read-only), Thai name input with per-row save on blur/Enter
 */
export default function CuisineNamesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: CUISINE_NAMES_QUERY_KEY,
    queryFn: getCuisineNamesAdmin,
    staleTime: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string | null }) =>
      updateCuisineNameTh(id, value),
    onSuccess: () => {
      // Revalidate the list
      queryClient.invalidateQueries({ queryKey: CUISINE_NAMES_QUERY_KEY });
    },
  });

  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <AdminListHeader
        title="Cuisine Names (TH/EN)"
        description="ชื่อ Cuisine ภาษาไทยและอังกฤษ — พิมพ์ชื่อไทย (save on blur หรือ Enter)"
      />

      <div className="bg-white rounded-lg border">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="py-3 px-4 text-left text-sm font-semibold">ชื่อภาษาอังกฤษ</th>
              <th className="py-3 px-4 text-left text-sm font-semibold">ชื่อภาษาไทย</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={2} className="py-8 px-4 text-center text-ink-muted">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-8 px-4 text-center text-ink-muted">
                  No cuisines found
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <CuisineNameRow
                  key={row.id}
                  row={row}
                  onSave={(value) => updateMutation.mutateAsync({ id: row.id, value })}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
