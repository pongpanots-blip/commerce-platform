import { getCategoryById, updateCategory, uploadCategoryImage } from '@josh/shared-api';
import { Input, Textarea } from '@josh/shared-ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { HiOutlineExternalLink } from 'react-icons/hi';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { CopyIdButton } from '../../components/CopyIdButton';
import LogoUploadField from '../../components/LogoUploadField';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { isAllCategory } from './category-all';
import { CATEGORY_ROWS_QUERY_KEY, Field, levelLabel } from './category-form';

import { uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';

const EditCategory = () => {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [placement, setPlacement] = useState({ level: 0, path: '', code: '' });
  const [form, setForm] = useState({
    category_name_en: '',
    category_name_th: '',
    category_image: '',
    sort_order: 0,
    is_active: true,
    show_on_homepage: true,
    default_sort_key: '',
    sort_options_json: '[]',
  });
  const lockedSort = isAllCategory(id);

  const { data, isLoading } = useQuery({
    queryKey: ['product-category', 'detail', id],
    queryFn: () => getCategoryById(id as string, 'en').then((res) => res.data?.data),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!data) return;
    setPlacement({
      level: data.category_level ?? 0,
      path: data.category_path ?? '',
      code: data.category_code ?? '',
    });
    setForm({
      category_name_en: data.category_name_en ?? '',
      category_name_th: data.category_name_th ?? '',
      category_image: data.category_image ?? '',
      sort_order: lockedSort ? 0 : (data.sort_order ?? 0),
      is_active: data.is_active ?? true,
      show_on_homepage: data.show_on_homepage ?? true,
      default_sort_key: data.default_sort_key ?? '',
      sort_options_json: JSON.stringify(data.sort_options ?? [], null, 2),
    });
  }, [data, lockedSort]);

  const handleSubmit = async () => {
    if (!id || !form.category_name_en) {
      setError('กรุณากรอกชื่อหมวดหมู่ (EN)');
      return;
    }
    setSaving(true);
    setError('');
    try {
      let sort_options: Array<{ key: string; label: string; order: number }> = [];
      try {
        sort_options = JSON.parse(form.sort_options_json || '[]');
      } catch {
        setError('รูปแบบ Sort Options JSON ไม่ถูกต้อง');
        setSaving(false);
        return;
      }

      const response = await updateCategory(id, {
        category_name_en: form.category_name_en,
        category_name_th: form.category_name_th,
        category_image: form.category_image,
        sort_order: lockedSort ? 0 : form.sort_order,
        is_active: form.is_active,
        show_on_homepage: form.show_on_homepage,
        default_sort_key: form.default_sort_key || undefined,
        sort_options,
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

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">{__uiText('กำลังโหลด...')}</div>;
  }

  return (
    <AdminInsertLayout
      title={__uiText('แก้ไขหมวดหมู่สินค้า')}
      subtitle={__uiText('แก้ชื่อ ไอคอน ลำดับ และการแสดงผลบนหน้าแรก — ตำแหน่งในโครงสร้างมาจาก seed ย้ายที่นี่ไม่ได้')}
      backPath={ADMIN_ROUTES.categories}
      saving={saving}
      onSave={handleSubmit}
    >
      {error && <p className="text-sm text-alert">{__uiText(error)}</p>}

      <div className="rounded-lg bg-primary-soft px-4 py-3 text-sm text-ink-secondary">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-medium text-ink">{__uiText('Category ID:')}</span>
          <span className="font-mono text-xs">{id}</span>
          {id && <CopyIdButton id={id} />}
          <a
            href={`/shop/product?categoryId=${id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <HiOutlineExternalLink size={16} />
            {__uiText('ดูใน shop')}
          </a>
        </div>
        <span className="font-medium text-ink">{__uiText('ตำแหน่งในโครงสร้าง:')}</span>{' '}
        <span className="font-mono text-xs">{placement.path || '—'}</span>
        <span className="text-xs">
          {' '}
          · {levelLabel(placement.level)}
          {placement.code ? ` · ${__uiText('รหัส {0}', { '0': placement.code })}` : ''}
        </span>
      </div>

      <Field label="ชื่อหมวดหมู่ (EN) *" hint="ชื่อนี้เป็นส่วนหนึ่งของ path — เปลี่ยนแล้ว path ของหมวดลูกทั้งกิ่งจะถูกเขียนใหม่ให้อัตโนมัติ">
        <Input
          value={form.category_name_en}
          onChange={(e) => setForm({ ...form, category_name_en: e.target.value })}
          placeholder="เช่น ORGANIC BREAD"
        />
      </Field>

      <Field label="ชื่อหมวดหมู่ (TH)" hint="ชื่อที่ลูกค้าเห็นเมื่อใช้ภาษาไทย — ว่างไว้จะ fallback ไปใช้ชื่อ EN">
        <Input
          value={form.category_name_th}
          onChange={(e) => setForm({ ...form, category_name_th: e.target.value })}
          placeholder="เช่น ขนมปังออร์แกนิก"
        />
      </Field>

      <LogoUploadField
        label="ไอคอน / รูปหมวดหมู่"
        value={form.category_image}
        upload={uploadCategoryImage}
        onChange={(url) => setForm({ ...form, category_image: url })}
      />

      <Field
        label="ลำดับการแสดงผล (Sort order)"
        hint={lockedSort ? 'หมวด All อยู่ลำดับ 0 เสมอ' : 'ตัวเลขน้อยมาก่อน — เรียงกันเฉพาะในกลุ่มหมวดพี่น้องเดียวกัน'}
      >
        <Input
          type="number"
          value={String(form.sort_order)}
          disabled={lockedSort}
          onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
          placeholder="0"
        />
      </Field>

      <Field
        label="ค่าเรียงเริ่มต้นของหน้ารายการสินค้า (Default sort key)"
        hint="ต้องตรงกับ key ใน Sort options ด้านล่าง — เว้นว่างได้ถ้าไม่ต้องการบังคับ"
      >
        <Input
          value={form.default_sort_key}
          onChange={(e) => setForm({ ...form, default_sort_key: e.target.value })}
          placeholder="เช่น a1, grade_3"
        />
      </Field>

      <Field
        label="ตัวเลือกการเรียงเฉพาะหมวดนี้ (Sort options — JSON)"
        hint={'รูปแบบ [{"key":"a1","label":"A1","order":1}] · order น้อยแสดงก่อน'}
      >
        <Textarea
          value={form.sort_options_json}
          onChange={(e) => setForm({ ...form, sort_options_json: e.target.value })}
          rows={6}
          className="font-mono text-xs"
          placeholder={'[{"key":"a1","label":"A1","order":1}]'}
        />
      </Field>

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
            {__uiText('แถวไอคอนหน้าแรกดึงเฉพาะหมวด Level 1 — ติ๊กที่ Level อื่นจะยังไม่มีผล')}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1 accent-primary"
          checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
        />
        <span>
          <span className="font-medium text-ink">{__uiText('เปิดใช้งาน')}</span>
          <span className="block text-xs text-ink-muted">
            {__uiText('ปิดแล้วหมวดจะหายจากหน้าร้านและตัวเลือกกรอง แต่สินค้ายังอยู่')}
          </span>
        </span>
      </label>
    </AdminInsertLayout>
  );
};

export default EditCategory;
