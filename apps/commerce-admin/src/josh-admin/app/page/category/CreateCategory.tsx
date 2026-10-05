import { createProductCategory } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import { useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import LogoUploadField from '../../components/LogoUploadField';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import {
  CATEGORY_ROWS_QUERY_KEY,
  CategorySelect,
  Field,
  levelLabel,
  useCategoryRows,
} from './category-form';

/** Level 3 เป็นชั้นลึกสุดใน seed — หมวดที่ลึกกว่านั้นจะหลุดจากทุกคิวรีที่หน้าร้านใช้ */
const DEEPEST_PARENT_LEVEL = 2;

/**
 * สร้างหมวดหมู่ใหม่ — เลือกหมวดแม่ได้ทุกชั้นยกเว้น Level 3 (ชั้นลึกสุด)
 *
 * `level` / `category_code` / `category_path` / `category_path_code` backend derive ให้จากแม่
 * ที่เลือกทั้งหมด และไม่ต้องกรอกลำดับ — ไม่ส่ง `sort_order` มา backend จะต่อท้ายกลุ่มพี่น้องให้เอง
 * (`nextSortOrder`) แล้วค่อยไปลากจัดลำดับทีหลังในหน้ารายการ ดู docs/categories-api.md
 */
const CreateCategory = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rows = useCategoryRows();
  const parents = useMemo(
    () => rows.filter((row) => (row.category_level ?? 0) <= DEEPEST_PARENT_LEVEL),
    [rows],
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    parent_id: '',
    category_name_en: '',
    category_name_th: '',
    category_image: '',
    show_on_homepage: true,
  });

  const parent = rows.find((row) => row.category_id_uuid === form.parent_id);
  const newLevel = parent ? (parent.category_level ?? 0) + 1 : null;
  // แถวไอคอนหน้าแรกอ่านเฉพาะหมวด Level 1 — ติ๊กที่ชั้นอื่นไม่มีผล เลยไม่ต้องโชว์
  const homepageApplies = newLevel === 1;

  const handleSubmit = async () => {
    if (!form.parent_id) {
      setError('กรุณาเลือกหมวดแม่');
      return;
    }
    if (!form.category_name_en) {
      setError('กรุณากรอกชื่อหมวดหมู่ (EN)');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const response = await createProductCategory({
        parent_id: form.parent_id,
        category_name_en: form.category_name_en,
        category_name_th: form.category_name_th || undefined,
        category_image: form.category_image || undefined,
        show_on_homepage: homepageApplies ? form.show_on_homepage : false,
      });
      if (response.data?.status) {
        await queryClient.invalidateQueries({ queryKey: CATEGORY_ROWS_QUERY_KEY });
        navigate(ADMIN_ROUTES.categories);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminInsertLayout
      title="สร้างหมวดหมู่สินค้า"
      subtitle="เลือกหมวดแม่แล้วตั้งชื่อ/ไอคอน — ชั้นและรหัสคำนวณจากหมวดแม่ให้อัตโนมัติ"
      backPath={ADMIN_ROUTES.categories}
      saving={saving}
      onSave={handleSubmit}
    >
      {error && <p className="text-sm text-alert">{error}</p>}

      <Field
        label="หมวดแม่ *"
        hint="เลือกได้ถึง Level 2 — หมวดใหม่จะไปเป็นชั้นถัดไปใต้หมวดที่เลือก (Level 3 คือชั้นลึกสุด จึงเป็นหมวดแม่ไม่ได้)"
      >
        <CategorySelect
          rows={parents}
          value={form.parent_id}
          groupDepth={1}
          placeholder="— เลือกหมวดแม่ —"
          onChange={(parent_id) => setForm({ ...form, parent_id })}
        />
      </Field>

      {parent && (
        <div className="rounded-lg bg-primary-soft px-4 py-3 text-sm text-ink-secondary">
          <p>
            <span className="font-medium text-ink">หมวดใหม่จะเป็น:</span>{' '}
            <span className="text-xs">{levelLabel(newLevel ?? 0)}</span>
          </p>
          <p className="mt-1 font-mono text-xs text-ink-muted">
            {parent.category_path} &gt; {form.category_name_en || '…'}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            ลำดับจะต่อท้ายหมวดย่อยที่มีอยู่ของ {parent.category_name_en} — จัดลำดับใหม่ได้ที่หน้ารายการ
          </p>
        </div>
      )}

      <Field label="ชื่อหมวดหมู่ (EN) *">
        <Input
          value={form.category_name_en}
          onChange={(e) => setForm({ ...form, category_name_en: e.target.value })}
          placeholder="เช่น BAKERY"
        />
      </Field>

      <Field label="ชื่อหมวดหมู่ (TH)" hint="ว่างไว้ = fallback ไปชื่อ EN">
        <Input
          value={form.category_name_th}
          onChange={(e) => setForm({ ...form, category_name_th: e.target.value })}
          placeholder="เช่น เบเกอรี่"
        />
      </Field>

      <LogoUploadField
        label="ไอคอน / รูปหมวดหมู่"
        value={form.category_image}
        onChange={(url) => setForm({ ...form, category_image: url })}
      />

      {homepageApplies && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 accent-primary"
            checked={form.show_on_homepage}
            onChange={(e) => setForm({ ...form, show_on_homepage: e.target.checked })}
          />
          <span>
            <span className="font-medium text-ink">แสดงบนหน้าแรก</span>
            <span className="block text-xs text-ink-muted">
              แถวไอคอนหน้าแรกอ่านเฉพาะหมวด Level 1 — ช่องนี้จึงขึ้นเฉพาะตอนสร้างหมวด Level 1
            </span>
          </span>
        </label>
      )}
    </AdminInsertLayout>
  );
};

export default CreateCategory;
