import { createProductCategory, uploadCategoryImage } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import { useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import LogoUploadField from '../../components/LogoUploadField';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import {
  CATEGORY_ROWS_QUERY_KEY,
  Field,
  categoryOption,
  createCategoryOption,
  levelLabel,
  useCategoryRows,
} from './category-form';

import { MasterDataSelect, toast, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import { roleCanWrite } from '../../../../app/role-can';

/** Level 3 เป็นชั้นลึกสุดใน seed — หมวดที่ลึกกว่านั้นจะหลุดจากทุกคิวรีที่หน้าร้านใช้ */
const DEEPEST_PARENT_LEVEL = 2;

/**
 * สร้างหมวดหมู่ใหม่ — เลือกหมวดแม่ได้ทุกชั้นยกเว้น Level 3 (ชั้นลึกสุด)
 * level / code / path come from the parent. Sort is appended, then reordered on the list.
 */
const CreateCategory = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rows = useCategoryRows();
  const parents = useMemo(
    () => rows.filter((row) => (row.category_level ?? 0) <= DEEPEST_PARENT_LEVEL),
    [rows],
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ parent?: string; name?: string }>({});
  const [form, setForm] = useState({
    parent_id: '',
    category_name_en: '',
    category_name_th: '',
    category_image: '',
    show_on_homepage: true,
  });

  const parent = rows.find((row) => row.category_id_uuid === form.parent_id);
  const newLevel = parent ? (parent.category_level ?? 0) + 1 : null;
  const homepageApplies = newLevel === 1;

  const handleSubmit = async () => {
    const next: { parent?: string; name?: string } = {};
    if (!form.parent_id) next.parent = 'เลือกหมวดที่อยู่เหนือหมวดใหม่ เช่น เบเกอรี่ หมวดชั้นวางสินค้าเลือกเป็นหมวดแม่ไม่ได้';
    if (!form.category_name_en.trim()) next.name = 'ใส่ชื่อภาษาอังกฤษสั้น ๆ เช่น Bakery';
    setFieldErrors(next);
    if (next.parent || next.name) {
      setError('ยังบันทึกไม่ได้ — แก้ช่องที่ขึ้นสีแดงตามคำแนะนำ');
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
        toast('บันทึกหมวดหมู่แล้ว', { label: 'ไปจัดลำดับในรายการหมวด', href: ADMIN_ROUTES.categories });
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
      title={__uiText('สร้างหมวดหมู่สินค้า')}
      subtitle={__uiText('เลือกหมวดที่อยู่เหนือกว่า แล้วตั้งชื่อที่ลูกค้าอ่านได้')}
      backPath={ADMIN_ROUTES.categories}
      saving={saving}
      saveLabel="บันทึกหมวดหมู่"
      steps={['เลือกหมวดที่อยู่เหนือกว่า', 'ตั้งชื่อ', 'ใส่รูปถ้าต้องการ']}
      onSave={handleSubmit}
    >
      {error && <p className="text-sm text-alert">{__uiText(error)}</p>}

      <Field
        label="หมวดที่อยู่เหนือกว่า"
        required
        error={fieldErrors.parent}
        hint="เลือกกลุ่มที่หมวดใหม่อยู่ข้างใน ชั้นวางสินค้า (ชั้นลึกสุด) เลือกไม่ได้"
      >
        <MasterDataSelect
          options={parents.map(categoryOption)}
          value={form.parent_id}
          placeholder="เช่น เบเกอรี่"
          onChange={(parent_id) => setForm({ ...form, parent_id: String(parent_id) })}
          canCreate={roleCanWrite(['merchandising'])}
          createFrom="category_name_en"
          createFields={[
            { name: 'category_name_en', label: 'ชื่อภาษาอังกฤษ', required: true, placeholder: 'Bakery' },
            { name: 'parent_id', label: 'หมวดที่อยู่เหนือกว่า', options: [{ value: '', label: 'ไม่มี (หมวดชั้นบนสุด)' }, ...parents.filter((row) => (row.category_level ?? 0) <= 1).map(categoryOption)] },
          ]}
          onCreate={createCategoryOption}
        />
      </Field>

      {parent && (
        <div className="rounded-lg bg-primary-soft px-4 py-3 text-sm text-ink-secondary">
          <p>
            <span className="font-medium text-ink">{__uiText('หมวดใหม่จะเป็น:')}</span>{' '}
            <span className="text-xs">{levelLabel(newLevel ?? 0)}</span>
          </p>
          <p className="mt-1 font-mono text-xs text-ink-muted">
            {parent.category_path} &gt; {form.category_name_en || '…'}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {__uiText('ลำดับจะต่อท้ายหมวดย่อยที่มีอยู่ของ {0} — จัดลำดับใหม่ได้ที่หน้ารายการ', { '0': parent.category_name_en ?? '' })}
          </p>
        </div>
      )}

      <Field label="ชื่อภาษาอังกฤษ" required error={fieldErrors.name} hint="ใช้ในระบบและหน้าร้านภาษาอังกฤษ เช่น Bakery">
        <Input
          value={form.category_name_en}
          onChange={(e) => setForm({ ...form, category_name_en: e.target.value })}
          placeholder="Bakery"
        />
      </Field>

      <Field label="ชื่อภาษาไทย" hint="ชื่อที่ลูกค้าภาษาไทยเห็น ถ้าว่าง ร้านจะใช้ชื่อภาษาอังกฤษ">
        <Input
          value={form.category_name_th}
          onChange={(e) => setForm({ ...form, category_name_th: e.target.value })}
          placeholder="เบเกอรี่"
        />
      </Field>

      <LogoUploadField
        label="ไอคอน / รูปหมวดหมู่"
        value={form.category_image}
        upload={uploadCategoryImage}
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
            <span className="font-medium text-ink">{__uiText('แสดงบนหน้าแรก')}</span>
            <span className="block text-xs text-ink-muted">
              {__uiText('แถวไอคอนหน้าแรกแสดงเฉพาะหมวดชั้นบนสุด — ช่องนี้จึงขึ้นเฉพาะตอนสร้างหมวดชั้นบนสุด')}
            </span>
          </span>
        </label>
      )}
    </AdminInsertLayout>
  );
};

export default CreateCategory;
