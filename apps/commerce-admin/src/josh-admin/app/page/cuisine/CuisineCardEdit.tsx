import {
  addCuisineCardCategoriesAdmin,
  addCuisineCardProductsAdmin,
  createCuisineCardAdmin,
  getCuisineTypes,
  listCuisineCardCategoriesAdmin,
  listCuisineCardProductsAdmin,
  listCuisineCardsAdmin,
  reorderCuisineCardCategoriesAdmin,
  updateCuisineCardAdmin,
  uploadImage,
  type CuisineCardCategoryAdmin,
  type CuisineCardProductAdmin,
  type CuisineCategoryOrderItem,
  type CuisineHierarchyItem,
  type ShopCuisineCardAdmin,
} from '@josh/shared-api';
import { Button, Input, Select, Textarea } from '@josh/shared-ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { HiOutlineExternalLink } from 'react-icons/hi';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { CopyIdButton } from '../../components/CopyIdButton';
import { MarketingLinkField } from '../../components/MarketingLinkField';
import { SmartLinkField } from '../../components/SmartLinkField';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { resolveAdminAssetUrl } from '../../lib/asset-url';
import { Field } from '../category/category-form';
import { CUISINE_CARDS_QUERY_KEY, looseSlugify, slugFromEnglishName } from './cuisine-cards.helpers';
import { CuisineCardCategoriesPanel } from './CuisineCardCategoriesPanel';
import { CuisineCardProductsPanel } from './CuisineCardProductsPanel';

/** ตัวเลือก "— ไม่ผูก —" ต้องเลือกซ้ำได้จริง — ไม่ใช้ Select placeholder เพราะมันคือ <option disabled hidden> */
const NO_TAXONOMY_VALUE = '';

type CuisineForm = {
  slug: string;
  /** true เมื่อ admin แก้ slug เอง — หยุด sync จาก title_en */
  slugTouched: boolean;
  title_th: string;
  title_en: string;
  description_th: string;
  description_en: string;
  cuisine_id: string | null;
  link_url: string;
  image_url: string | null;
  image_url_desktop: string | null;
  image_url_large: string | null;
  image_url_large_mobile: string | null;
  is_active: boolean;
};

const EMPTY_FORM: CuisineForm = {
  slug: '',
  slugTouched: false,
  title_th: '',
  title_en: '',
  description_th: '',
  description_en: '',
  cuisine_id: null,
  link_url: '/product',
  image_url: null,
  image_url_desktop: null,
  image_url_large: null,
  image_url_large_mobile: null,
  is_active: true,
};

/** Compact read-out of SKUs + L3 categories already on the card's saved taxonomy. */
function TaxonomyBindingsSummary({
  products,
  productsTotal,
  categories,
  loading,
  taxonomyLabel,
  dirtyTaxonomy,
}: {
  products: CuisineCardProductAdmin[];
  /** จำนวน SKU ที่ผูกจริง — `products` เป็นแค่ตัวอย่างชุดแรก */
  productsTotal: number;
  categories: CuisineCardCategoryAdmin[];
  loading: boolean;
  taxonomyLabel: string | null;
  dirtyTaxonomy: boolean;
}) {
  const categoryLabel = (row: CuisineCardCategoryAdmin) =>
    row.category_name_th || row.category_name_en || row.category_id;

  return (
    <div className="rounded-xl border border-primary-border bg-primary-soft/40 p-4">
      <p className="text-xs font-semibold text-ink">
        สิ่งที่ผูกกับ Taxonomy{taxonomyLabel ? ` · ${taxonomyLabel}` : ''}
      </p>
      {dirtyTaxonomy && (
        <p className="mt-1 text-xs text-amber-700">
          เปลี่ยน taxonomy ในฟอร์มแล้ว — รายการด้านล่างยังอิงค่าที่บันทึกไว้ กดบันทึกเพื่อสลับ
        </p>
      )}
      {loading ? (
        <p className="mt-2 text-xs text-ink-muted">กำลังโหลดรายการที่ผูก...</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-ink-muted">SKU ({productsTotal})</p>
            {products.length === 0 ? (
              <p className="mt-1 text-xs text-ink-muted">ยังไม่มี SKU แท็กตรง</p>
            ) : (
              <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-xs text-ink">
                {products.map((p) => (
                  <li key={p.product_inventory_id} className="truncate font-mono">
                    {p.sku}
                    {p.name ? (
                      <span className="font-sans text-ink-muted"> — {p.name}</span>
                    ) : null}
                  </li>
                ))}
                {productsTotal > products.length && (
                  <li className="text-ink-muted">
                    …และอีก {(productsTotal - products.length).toLocaleString()} รายการ
                  </li>
                )}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-ink-muted">
              หมวดหมู่ที่ผูก ({categories.length})
            </p>
            {categories.length === 0 ? (
              <p className="mt-1 text-xs text-ink-muted">ยังไม่มีหมวดที่ผูก</p>
            ) : (
              <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-xs text-ink">
                {categories.map((c) => (
                  <li key={c.category_id} className="truncate">
                    {categoryLabel(c)}
                    {c.category_path ? (
                      <span className="text-ink-muted"> — {c.category_path}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formFromCard(card: ShopCuisineCardAdmin): CuisineForm {
  return {
    slug: card.slug,
    slugTouched: true,
    title_th: card.title_th,
    title_en: card.title_en,
    description_th: card.description_th,
    description_en: card.description_en,
    cuisine_id: card.cuisine_id ?? null,
    link_url: card.link_url,
    image_url: card.image_url ?? null,
    image_url_desktop: card.image_url_desktop ?? null,
    image_url_large: card.image_url_large ?? null,
    image_url_large_mobile: card.image_url_large_mobile ?? null,
    is_active: card.is_active,
  };
}

/**
 * ช่องรูปหนึ่งช่อง — กล่องเดียวเป็นทั้งพรีวิวและ drop target (คลิก/ลากวางอัปโหลดตรง ๆ)
 * แล้วตามด้วยช่อง URL แยกไว้วาง URL เอง — ไม่ใช้ LogoUploadField ที่นี่เพราะมันมีกล่อง dashed
 * แยกจากพรีวิว ทำให้ช่องนึงสูงเกิน 400px (ดู docs/web-admin-cuisine-cards.md)
 * ponytail: กล่องสูงคงที่ (h-32) + object-cover ไม่ใช่ aspect-ratio ของรูปจริง เพื่อให้สองคอลัมน์
 * ในแถวเดียวกัน (Web/Mobile) สูงเท่ากันเสมอ ต่างสัดส่วนแค่ไหนก็ไม่ทำแถวเบี้ยว — ตัวเลขสัดส่วนจริง
 * บอกไว้ใน hint แทน
 */
function ImageSlot({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const preview = resolveAdminAssetUrl(value);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const response = await uploadImage(file);
      if (response.data?.status && response.data.data?.url) {
        onChange(response.data.data.url);
      } else {
        alert('อัปโหลดไม่สำเร็จ');
      }
    } catch {
      alert('เกิดข้อผิดพลาดในการอัปโหลด');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-muted">{hint}</p>
      </div>
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        className={`relative flex h-32 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed text-xs transition-colors ${
          dragActive
            ? 'border-primary bg-primary/10'
            : 'border-primary-border bg-primary-soft hover:border-primary-light'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
        {preview ? (
          <>
            <img src={preview} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-black/50 py-1 text-[11px] text-white">
              <span>เปลี่ยนรูป</span>
              <span>·</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
                className="hover:underline"
              >
                ลบรูป
              </button>
            </div>
          </>
        ) : uploading ? (
          <span className="text-primary">กำลังอัปโหลด...</span>
        ) : (
          <span className="px-2 text-center text-ink-muted">
            คลิกเพื่อเลือกไฟล์ หรือลากมาวาง
          </span>
        )}
      </div>
      <Input
        label="หรือวาง URL รูปภาพเอง"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder="เช่น /uploads/brands/..."
      />
    </div>
  );
}

/**
 * `/admin/cuisine-cards/create` และ `/admin/cuisine-cards/edit/:id` — ฟอร์มเดียวใช้ทั้งสร้าง/แก้
 * ไม่มีฟิลด์ Emoji / Tone / ลำดับแสดงผลอีกต่อไป (การ์ดเป็นรูปภาพล้วน, ลำดับจัดที่หน้าลิสต์ด้วยการลาก)
 */
export default function CuisineCardEdit() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<CuisineForm>(EMPTY_FORM);
  const [taxonomyOptions, setTaxonomyOptions] = useState<CuisineHierarchyItem[]>([]);
  const [draftProducts, setDraftProducts] = useState<CuisineCardProductAdmin[]>([]);
  const [draftCategories, setDraftCategories] = useState<CuisineCardCategoryAdmin[]>([]);
  const [boundProducts, setBoundProducts] = useState<CuisineCardProductAdmin[]>([]);
  const [boundCategories, setBoundCategories] = useState<CuisineCardCategoryAdmin[]>([]);
  /** ลำดับหมวดที่แก้ค้างในพาเนล — flush ตอนกดบันทึกของทั้งหน้า */
  const [pendingCategoryOrder, setPendingCategoryOrder] =
    useState<CuisineCategoryOrderItem[] | null>(null);
  const [boundProductsTotal, setBoundProductsTotal] = useState(0);
  const [bindingsLoading, setBindingsLoading] = useState(false);
  const [bindingsTick, setBindingsTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // การ์ดชุดเล็ก — ไม่มี endpoint ดึงทีละใบ โหลดทั้งลิสต์แล้วหาด้วย id (คีย์เดียวกับหน้าลิสต์)
  const { data, isLoading } = useQuery({
    queryKey: CUISINE_CARDS_QUERY_KEY,
    queryFn: listCuisineCardsAdmin,
    enabled: isEdit,
    staleTime: 60_000,
  });
  const card = isEdit ? data?.find((c) => c.id === id) : undefined;

  useEffect(() => {
    if (card) setForm(formFromCard(card));
  }, [card]);

  useEffect(() => {
    void getCuisineTypes()
      .then(setTaxonomyOptions)
      .catch(() => setTaxonomyOptions([]));
  }, []);

  const refreshBindings = useCallback(() => {
    setBindingsTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!isEdit || !id) {
      setBoundProducts([]);
      setBoundCategories([]);
      return;
    }
    let cancelled = false;
    setBindingsLoading(true);
    void Promise.all([
      listCuisineCardProductsAdmin(id, { limit: 50 }),
      listCuisineCardCategoriesAdmin(id),
    ])
      .then(([productsPage, categories]) => {
        if (cancelled) return;
        setBoundProducts(productsPage.rows);
        setBoundProductsTotal(productsPage.total);
        setBoundCategories(categories);
      })
      .catch(() => {
        if (cancelled) return;
        setBoundProducts([]);
        setBoundProductsTotal(0);
        setBoundCategories([]);
      })
      .finally(() => {
        if (!cancelled) setBindingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEdit, id, bindingsTick, card?.cuisine_id]);

  const savedCuisineId = card?.cuisine_id ?? null;
  const selectedTaxonomyLabel =
    taxonomyOptions.find((t) => t.id === (savedCuisineId ?? form.cuisine_id))?.cuisine_name ??
    null;
  const dirtyTaxonomy =
    isEdit && form.cuisine_id !== savedCuisineId;

  const handleTaxonomyMaybeChanged = useCallback(
    (cuisineId?: string) => {
      if (cuisineId) {
        setForm((prev) => ({ ...prev, cuisine_id: cuisineId }));
      }
      void queryClient.invalidateQueries({ queryKey: CUISINE_CARDS_QUERY_KEY });
      void getCuisineTypes()
        .then(setTaxonomyOptions)
        .catch(() => undefined);
      refreshBindings();
    },
    [queryClient, refreshBindings],
  );

  const handleSubmit = async () => {
    if (!form.title_th || !form.title_en || !form.description_th || !form.description_en) {
      setError('กรุณากรอกหัวข้อ (ไทย/EN) และคำอธิบาย (ไทย/EN) ให้ครบ');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload = {
        title_th: form.title_th,
        title_en: form.title_en,
        description_th: form.description_th,
        description_en: form.description_en,
        link_url: form.link_url,
        image_url: form.image_url,
        image_url_desktop: form.image_url_desktop,
        image_url_large: form.image_url_large,
        image_url_large_mobile: form.image_url_large_mobile,
        cuisine_id: form.cuisine_id,
        is_active: form.is_active,
      };

      if (isEdit && id) {
        await updateCuisineCardAdmin(id, payload);
        // ลำดับหมวดที่ลาก/พิมพ์ไว้ในพาเนลถูกเก็บค้าง — เขียนลง sort_category_order ตอนนี้
        if (pendingCategoryOrder?.length) {
          await reorderCuisineCardCategoriesAdmin(id, pendingCategoryOrder);
          setPendingCategoryOrder(null);
        }
        await queryClient.invalidateQueries({ queryKey: CUISINE_CARDS_QUERY_KEY });
        navigate(ADMIN_ROUTES.cuisineCards);
      } else {
        const resolvedSlug = slugFromEnglishName(form.slug) || slugFromEnglishName(form.title_en);
        if (!resolvedSlug) {
          setError('สร้าง slug จาก Title EN ไม่ได้ — กรอก Title EN หรือ slug เอง');
          setSaving(false);
          return;
        }
        const created = await createCuisineCardAdmin({ ...payload, slug: resolvedSlug });
        const newId = created?.id;
        if (newId && draftProducts.length > 0) {
          await addCuisineCardProductsAdmin(
            newId,
            draftProducts.map((p) => p.sku),
          );
        }
        if (newId && draftCategories.length > 0) {
          await addCuisineCardCategoriesAdmin(
            newId,
            draftCategories.map((c) => c.category_id),
          );
        }
        await queryClient.invalidateQueries({ queryKey: CUISINE_CARDS_QUERY_KEY });
        // ไปหน้าแก้ไขต่อ — ให้เห็น SKU/หมวดที่เพิ่งผูก / จัดการต่อได้ทันที
        navigate(newId ? ADMIN_ROUTES.cuisineCardEdit(newId) : ADMIN_ROUTES.cuisineCards);
      }
    } catch (err) {
      console.error(err);
      setError(isEdit ? 'บันทึกการ์ดไม่สำเร็จ' : 'สร้างการ์ดไม่สำเร็จ — ตรวจ slug ซ้ำหรือสิทธิ์ admin');
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && isLoading) {
    return <div className="p-6 text-sm text-ink-muted">กำลังโหลด...</div>;
  }

  // id ใน URL ไม่มีในลิสต์การ์ด (ลบไปแล้ว/พิมพ์ผิด) — เดิมฟอร์มขึ้นเปล่า ๆ แล้วกด save ยิง PATCH 404
  if (isEdit && !card) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="rounded-lg bg-white p-8 text-center shadow-level-1">
          <p className="text-sm text-ink">ไม่พบการ์ดนี้</p>
          <p className="mt-1 text-xs text-ink-muted">การ์ดอาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง</p>
          <Button
            className="mt-4"
            variant="secondary"
            text="← กลับไปหน้ารายการ"
            onClick={() => navigate(ADMIN_ROUTES.cuisineCards)}
          />
        </div>
      </div>
    );
  }

  return (
    <AdminInsertLayout
      title={isEdit ? 'แก้ไขการ์ด Cuisine' : 'เพิ่มการ์ด Cuisine'}
      subtitle="การ์ดหน้าแรก shop by cuisine — ข้อความ รูปภาพ และ taxonomy ที่ดึงสินค้า"
      backPath={ADMIN_ROUTES.cuisineCards}
      wide
      saving={saving}
      onSave={() => void handleSubmit()}
    >
      {error && <p className="text-sm text-alert">{error}</p>}

      <p className="text-sm font-semibold text-ink">ข้อมูลการ์ด</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="หัวข้อ (ไทย) *">
          <Input
            value={form.title_th}
            onChange={(e) => setForm({ ...form, title_th: e.target.value })}
          />
        </Field>
        <Field label="หัวข้อ (EN) *">
          <Input
            value={form.title_en}
            onChange={(e) => {
              const title_en = e.target.value;
              setForm({
                ...form,
                title_en,
                ...(form.slugTouched ? {} : { slug: slugFromEnglishName(title_en) }),
              });
            }}
          />
        </Field>
        {!isEdit && (
          <Field label="Slug" hint="Auto จาก Title (EN) เช่น Thai Restaurant → thai — แก้เองได้">
            <Input
              value={form.slug}
              // ponytail: onChange ใช้ looseSlugify เบา ๆ (ไม่ trim) กันเคาะวรรคหายระหว่างพิมพ์
              // แล้วค่อย normalize เต็มรูปแบบด้วย slugFromEnglishName ตอน blur/submit
              onChange={(e) =>
                setForm({ ...form, slugTouched: true, slug: looseSlugify(e.target.value) })
              }
              onBlur={() => setForm((f) => ({ ...f, slug: slugFromEnglishName(f.slug) }))}
              placeholder="ว่างได้ — สร้างจาก Title EN"
            />
          </Field>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="คำอธิบาย (ไทย) *">
          <Textarea
            rows={3}
            value={form.description_th}
            onChange={(e) => setForm({ ...form, description_th: e.target.value })}
          />
        </Field>
        <Field label="คำอธิบาย (EN) *">
          <Textarea
            rows={3}
            value={form.description_en}
            onChange={(e) => setForm({ ...form, description_en: e.target.value })}
          />
        </Field>
      </div>

      <div className="border-t border-primary-border pt-5">
        <p className="mb-1 text-sm font-semibold text-ink">การผูกสินค้า (Taxonomy)</p>
        <p className="mb-3 text-xs text-ink-muted">
          เลือกประเภทอาหาร แล้วดู SKU และหมวดหมู่ที่ผูกอยู่ — จัดการเพิ่ม/ลบได้ด้านล่าง
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* ตัวเลือกไม่ผูก taxonomy เป็น option เลือกได้จริง ไม่ใช่ placeholder แบบ disabled/hidden
              เพราะการ์ดที่เคยผูก taxonomy แล้วต้องเลือกกลับไปเป็นไม่ผูกได้ */}
          <Select
            label="ประเภทอาหาร (Taxonomy)"
            hint="ว่างได้ — เพิ่ม SKU ครั้งแรกจะสร้าง/ผูกจากชื่อการ์ดให้อัตโนมัติ"
            data={[
              { value: NO_TAXONOMY_VALUE, label: '— ไม่ผูก —' },
              ...taxonomyOptions.map((item) => ({ value: item.id, label: item.cuisine_name })),
            ]}
            value={form.cuisine_id ?? NO_TAXONOMY_VALUE}
            onChange={(e) => setForm({ ...form, cuisine_id: e.target.value || null })}
          />
          <Input
            label="ลิงก์ปลายทาง (URL)"
            value={form.link_url}
            onChange={(e) => setForm({ ...form, link_url: e.target.value })}
            placeholder="เช่น /product?categoryId=12"
          />
        </div>

        {isEdit && id ? (
          <div className="mt-4 space-y-5">
            <TaxonomyBindingsSummary
              products={boundProducts}
              productsTotal={boundProductsTotal}
              categories={boundCategories}
              loading={bindingsLoading}
              taxonomyLabel={selectedTaxonomyLabel}
              dirtyTaxonomy={dirtyTaxonomy}
            />
            <CuisineCardProductsPanel
              cardId={id}
              cuisineId={form.cuisine_id ?? card?.cuisine_id ?? null}
              onTaxonomyMaybeChanged={handleTaxonomyMaybeChanged}
              onBindingsChanged={refreshBindings}
            />
            <CuisineCardCategoriesPanel
              cardId={id}
              cuisineId={form.cuisine_id ?? card?.cuisine_id ?? null}
              onTaxonomyMaybeChanged={handleTaxonomyMaybeChanged}
              onBindingsChanged={refreshBindings}
              onPendingOrderChange={setPendingCategoryOrder}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {(draftProducts.length > 0 || draftCategories.length > 0) && (
              <TaxonomyBindingsSummary
                products={draftProducts}
                productsTotal={draftProducts.length}
                categories={draftCategories}
                loading={false}
                taxonomyLabel={
                  taxonomyOptions.find((t) => t.id === form.cuisine_id)?.cuisine_name ?? null
                }
                dirtyTaxonomy={false}
              />
            )}
            <CuisineCardProductsPanel
              cuisineId={form.cuisine_id}
              draftProducts={draftProducts}
              onDraftProductsChange={setDraftProducts}
            />
            <CuisineCardCategoriesPanel
              cuisineId={form.cuisine_id}
              draftCategories={draftCategories}
              onDraftCategoriesChange={setDraftCategories}
            />
          </div>
        )}
      </div>

      <div className="border-t border-primary-border pt-5">
        <p className="mb-3 text-sm font-semibold text-ink">รูปภาพ</p>

        <p className="mb-2 text-xs font-semibold text-ink-muted">หน้าแรก (Homepage card)</p>
        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <ImageSlot
            label="หน้าแรก — Web"
            hint="แสดงการ์ด 180×90 บน desktop · แนะนำ 720×360 px (2:1)"
            value={form.image_url_desktop}
            onChange={(url) => setForm({ ...form, image_url_desktop: url })}
          />
          <ImageSlot
            label="หน้าแรก — Mobile"
            hint="แสดงการ์ด 180×90 บนมือถือ · แนะนำ 720×360 px (2:1)"
            value={form.image_url}
            onChange={(url) => setForm({ ...form, image_url: url })}
          />
        </div>

        <p className="mb-2 text-xs font-semibold text-ink-muted">
          หน้ารวม Cuisine (Listing hero)
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ImageSlot
            label="หน้ารวม Cuisine — Web"
            hint="hero บน /shop/product/cuisine desktop · แนะนำ 1200×400 px (3:1)"
            value={form.image_url_large}
            onChange={(url) => setForm({ ...form, image_url_large: url })}
          />
          <ImageSlot
            label="หน้ารวม Cuisine — Mobile"
            hint="hero บนมือถือ · แนะนำ 1200×400 px (3:1)"
            value={form.image_url_large_mobile}
            onChange={(url) => setForm({ ...form, image_url_large_mobile: url })}
          />
        </div>
      </div>

      <div className="border-t border-primary-border pt-5">
        <p className="mb-3 text-sm font-semibold text-ink">การแสดงผล</p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 accent-primary"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          <span>
            <span className="font-medium text-ink">แสดงบนหน้าแรก shop</span>
            <span className="block text-xs text-ink-muted">
              ลำดับการแสดงผลจัดที่หน้ารายการด้วยการลาก ไม่ใช่ที่นี่
            </span>
          </span>
        </label>
      </div>

      {isEdit && id && (
        <div className="border-t border-primary-border pt-5">
          <p className="mb-3 text-sm font-semibold text-ink">ลิงก์ Cuisine (สำหรับ Marketing)</p>
          <p className="mb-3 text-xs text-ink-muted">
            ลิงก์เดียว — มือถือเด้งเข้าแอป/สโตร์ ส่วน desktop เปิดหน้าเว็บ เอาไปยิง ads ได้เลย
          </p>
          <MarketingLinkField type="cuisine" id={id} />
          <div className="mt-3">
            <SmartLinkField type="cuisine" id={id} />
          </div>

          <div className="mt-5 rounded-lg bg-primary-soft px-4 py-3 text-sm text-ink-secondary">
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink">Cuisine card ID:</span>
              <span className="font-mono text-xs">{id}</span>
              <CopyIdButton id={id} />
              <a
                href={`/shop/product/cuisine/${id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <HiOutlineExternalLink size={16} />
                ดูใน shop
              </a>
            </div>
          </div>
        </div>
      )}
    </AdminInsertLayout>
  );
}
