// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  createSmartLink, getSmartLink, updateSmartLink, type SmartLinkInput,
} from '@josh/shared-api';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { UtmBuilder, EMPTY_UTM, type UtmValues } from '../../components/UtmBuilder';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const PUBLIC_BASE =
  (import.meta as any).env?.VITE_SMART_LINK_BASE_URL?.replace(/\/$/, '') || '/api/r';
const API_ORIGIN =
  (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, '') || '/api';

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
const labelCls = 'text-xs font-semibold text-gray-500';

const EMPTY: SmartLinkInput = {
  slug: '', destination_web: '', title: '', description: '', image_url: '',
  destination_ios: '', destination_android: '', fallback_url: '',
  show_landing: false, active: true,
};

export default function SmartLinkEdit() {
  __useUiLocale();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [form, setForm] = useState<SmartLinkInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [utm, setUtm] = useState<UtmValues>(EMPTY_UTM);
  const publicUrl = form.slug ? `${PUBLIC_BASE}/${form.slug}` : '';

  useEffect(() => {
    if (!id) return;
    void getSmartLink(id)
      .then((l) =>
        setForm({
          slug: l.slug, title: l.title ?? '', description: l.description ?? '', image_url: l.image_url ?? '',
          destination_web: l.destination_web, destination_ios: l.destination_ios ?? '',
          destination_android: l.destination_android ?? '', fallback_url: l.fallback_url ?? '',
          show_landing: l.show_landing, active: l.active,
          expires_at: l.expires_at ? l.expires_at.slice(0, 10) : undefined,
        }),
      )
      .catch(() => setError(__uiMessage("โหลดข้อมูลไม่สำเร็จ")));
  }, [id]);

  const set = <K extends keyof SmartLinkInput>(k: K, v: SmartLinkInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // strip empty optional strings so class-validator @IsUrl doesn't reject ""
  const clean = (input: SmartLinkInput): SmartLinkInput => {
    const out: any = { ...input };
    for (const k of ['title', 'description', 'image_url', 'destination_ios', 'destination_android', 'fallback_url']) {
      if (!out[k]) delete out[k];
    }
    if (!out.expires_at) delete out.expires_at;
    return out;
  };

  const submit = async () => {
    setError(null);
    if (!/^[a-z0-9-]+$/.test(form.slug)) return setError(__uiMessage("slug ต้องเป็น a-z, 0-9, - เท่านั้น"));
    if (!form.destination_web) return setError(__uiMessage("ต้องมี Web destination"));
    setSaving(true);
    try {
      if (isEdit && id) await updateSmartLink(id, clean(form));
      else await createSmartLink(clean(form));
      navigate(ADMIN_ROUTES.smartLinks);
    } catch {
      setError(__uiMessage("บันทึกไม่สำเร็จ — ตรวจ slug ซ้ำ หรือรูปแบบ URL"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <AdminListHeader title={isEdit ? __uiText("แก้ไข Smart Link") : __uiText("สร้าง Smart Link")} subtitle="" />
      <div className="mt-4 max-w-2xl space-y-4 rounded-xl border border-gray-100 bg-white p-5">
        <div>
          <label htmlFor="smart-link-slug" className={labelCls}>{__uiText("Slug (ส่วนท้ายลิงก์) *")}</label>
          <input id="smart-link-slug" className={field} value={form.slug} placeholder={__uiText("summer-sale")}
            onChange={(e) => set('slug', e.target.value)} disabled={isEdit} />
        </div>
        <div>
          <label htmlFor="smart-link-title" className={labelCls}>{__uiText("ชื่อเรื่อง (Title)")}</label>
          <input id="smart-link-title" className={field} value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div>
          <label htmlFor="smart-link-description" className={labelCls}>{__uiText("คำอธิบาย (Description)")}</label>
          <textarea id="smart-link-description" className={field} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div>
          <label htmlFor="smart-link-image-url" className={labelCls}>{__uiText("ลิงก์รูปภาพ (Image URL)")}</label>
          <input id="smart-link-image-url" className={field} value={form.image_url ?? ''} onChange={(e) => set('image_url', e.target.value)} />
        </div>
        <div>
          <label htmlFor="smart-link-web-destination" className={labelCls}>{__uiText("ปลายทางเว็บ (Web destination) *")}</label>
          <input id="smart-link-web-destination" className={field} value={form.destination_web} placeholder="https://example.com/shop"
            onChange={(e) => set('destination_web', e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="smart-link-ios-destination" className={labelCls}>{__uiText("ปลายทาง iOS (iOS destination)")}</label>
            <input id="smart-link-ios-destination" className={field} value={form.destination_ios ?? ''} onChange={(e) => set('destination_ios', e.target.value)} />
          </div>
          <div>
            <label htmlFor="smart-link-android-destination" className={labelCls}>{__uiText("ปลายทาง Android (Android destination)")}</label>
            <input id="smart-link-android-destination" className={field} value={form.destination_android ?? ''} onChange={(e) => set('destination_android', e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="smart-link-fallback-url" className={labelCls}>{__uiText("ลิงก์สำรอง (Fallback URL)")}</label>
          <input id="smart-link-fallback-url" className={field} value={form.fallback_url ?? ''} onChange={(e) => set('fallback_url', e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="smart-link-expires-at" className={labelCls}>{__uiText("วันหมดอายุ (Expires at)")}</label>
            <input id="smart-link-expires-at" type="date" className={field} value={form.expires_at ?? ''} onChange={(e) => set('expires_at', e.target.value)} />
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.show_landing} onChange={(e) => set('show_landing', e.target.checked)} />
              {__uiText("แสดงหน้า Landing Page")}</label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.active} onChange={(e) => set('active', e.target.checked)} />
              {__uiText("เปิดใช้งาน (Active)")}</label>
          </div>
        </div>
        {form.slug && (
          <div className="space-y-3 border-t border-gray-100 pt-4">
            <p className="text-sm font-semibold text-gray-700">{__uiText("UTM & QR")}</p>
            <UtmBuilder value={utm} baseUrl={publicUrl} onChange={setUtm} />
            {isEdit && id && (
              <div className="flex gap-2">
                <a className="rounded-lg bg-gray-100 px-3 py-2 text-sm"
                   href={`${API_ORIGIN}/smart-links/${id}/qr?format=png&size=512`} target="_blank" rel="noreferrer">
                  {__uiText("Download QR (PNG)")}</a>
                <a className="rounded-lg bg-gray-100 px-3 py-2 text-sm"
                   href={`${API_ORIGIN}/smart-links/${id}/qr?format=svg`} target="_blank" rel="noreferrer">
                  {__uiText("Download QR (SVG)")}</a>
              </div>
            )}
          </div>
        )}
        {error && <p className="text-xs text-red-600">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
        <div className="flex gap-2">
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={saving} onClick={() => void submit()}>
            {saving ? __uiText("กำลังบันทึก…") : __uiText("บันทึก")}
          </button>
          <button className="rounded-lg bg-gray-100 px-4 py-2 text-sm" onClick={() => navigate(ADMIN_ROUTES.smartLinks)}>{__uiText("ยกเลิก")}</button>
        </div>
      </div>
    </div>
  );
}
