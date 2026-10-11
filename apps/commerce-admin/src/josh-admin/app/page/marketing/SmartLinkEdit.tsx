// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  createSmartLink, getSmartLink, updateSmartLink, type SmartLinkInput,
} from '@josh/shared-api';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { UtmBuilder, EMPTY_UTM, type UtmValues } from '../../components/UtmBuilder';

// ui-copy-migration: only literal UI copy and notification templates
import { Alert, Checkbox, FormActions, FormField, FormSection, Input, PageHeader, Panel, Textarea, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const PUBLIC_BASE =
  (import.meta as any).env?.VITE_SMART_LINK_BASE_URL?.replace(/\/$/, '') || '/api/r';
const API_ORIGIN =
  (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, '') || '/api';

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
    if (!/^[a-z0-9-]+$/.test(form.slug)) return setError(__uiMessage("ท้ายลิงก์ใช้ได้แค่ a-z, 0-9 และ - เท่านั้น"));
    if (!form.destination_web) return setError(__uiMessage("กรุณากรอกปลายทางบนเว็บ"));
    setSaving(true);
    try {
      if (isEdit && id) await updateSmartLink(id, clean(form));
      else await createSmartLink(clean(form));
      navigate(ADMIN_ROUTES.smartLinks);
    } catch {
      setError(__uiMessage("บันทึกไม่สำเร็จ — ท้ายลิงก์อาจซ้ำกับลิงก์อื่น หรือรูปแบบลิงก์ไม่ถูกต้อง"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cp-management-page max-w-3xl space-y-5">
      <PageHeader
        back={{ to: ADMIN_ROUTES.smartLinks, label: 'ลิงก์ติดตามผล' }}
        title={isEdit ? __uiText("แก้ไขลิงก์ติดตามผล") : __uiText("สร้างลิงก์ติดตามผล")}
        subtitle={__uiText("ตั้งท้ายลิงก์ เลือกหน้าปลายทาง แล้วนำลิงก์ไปใช้ได้ทุกที่")}
      />
      <Panel className="space-y-6 p-5">
        <FormSection title="ลิงก์">
          <FormField label={__uiText("ท้ายลิงก์")} required hint={isEdit ? __uiText("แก้ท้ายลิงก์หลังสร้างไม่ได้") : __uiText("ใช้ a-z, 0-9 และ - เท่านั้น")}>
            <Input id="smart-link-slug" className="font-mono" value={form.slug} placeholder="summer-sale"
              onChange={(e) => set('slug', e.target.value)} disabled={isEdit} />
          </FormField>
          <FormField label={__uiText("ชื่อเรื่อง")}>
            <Input id="smart-link-title" value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} />
          </FormField>
          <FormField label={__uiText("คำอธิบาย")}>
            <Textarea mono={false} id="smart-link-description" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </FormField>
          <FormField label={__uiText("ลิงก์รูปภาพ")}>
            <Input id="smart-link-image-url" value={form.image_url ?? ''} onChange={(e) => set('image_url', e.target.value)} />
          </FormField>
        </FormSection>

        <FormSection title="ปลายทาง" description="ลูกค้าจะถูกพาไปหน้าตามเครื่องที่ใช้ ถ้าไม่ได้ตั้งไว้จะไปปลายทางบนเว็บ">
          <FormField label={__uiText("ปลายทางบนเว็บ")} required>
            <Input id="smart-link-web-destination" value={form.destination_web} placeholder="https://example.com/shop"
              onChange={(e) => set('destination_web', e.target.value)} />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={__uiText("ปลายทางบน iPhone / iPad")}>
              <Input id="smart-link-ios-destination" value={form.destination_ios ?? ''} onChange={(e) => set('destination_ios', e.target.value)} />
            </FormField>
            <FormField label={__uiText("ปลายทางบน Android")}>
              <Input id="smart-link-android-destination" value={form.destination_android ?? ''} onChange={(e) => set('destination_android', e.target.value)} />
            </FormField>
          </div>
          <FormField label={__uiText("ลิงก์สำรอง")} hint={__uiText("ใช้เมื่อเปิดปลายทางไม่ได้")}>
            <Input id="smart-link-fallback-url" value={form.fallback_url ?? ''} onChange={(e) => set('fallback_url', e.target.value)} />
          </FormField>
        </FormSection>

        <FormSection title="การใช้งาน">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={__uiText("วันหมดอายุ")}>
              <Input id="smart-link-expires-at" type="date" value={form.expires_at ?? ''} onChange={(e) => set('expires_at', e.target.value)} />
            </FormField>
            <div className="flex items-end gap-4 pb-2">
              <Checkbox label={__uiText("แสดงหน้าแนะนำก่อนพาไปปลายทาง")} checked={!!form.show_landing} onChange={(e) => set('show_landing', e.target.checked)} />
              <Checkbox label={__uiText("เปิดใช้งาน")} checked={!!form.active} onChange={(e) => set('active', e.target.checked)} />
            </div>
          </div>
        </FormSection>

        {form.slug && (
          <FormSection title="ลิงก์สำหรับแต่ละช่องทาง และ QR">
            <UtmBuilder value={utm} baseUrl={publicUrl} onChange={setUtm} />
            {isEdit && id && (
              <div className="flex flex-wrap gap-2">
                <a className="inline-flex min-h-10 items-center rounded-lg border border-gray-200 bg-white px-3.5 text-[13px] font-medium"
                   href={`${API_ORIGIN}/smart-links/${id}/qr?format=png&size=512`} target="_blank" rel="noreferrer">
                  {__uiText("ดาวน์โหลด QR (PNG)")}</a>
                <a className="inline-flex min-h-10 items-center rounded-lg border border-gray-200 bg-white px-3.5 text-[13px] font-medium"
                   href={`${API_ORIGIN}/smart-links/${id}/qr?format=svg`} target="_blank" rel="noreferrer">
                  {__uiText("ดาวน์โหลด QR (SVG)")}</a>
              </div>
            )}
          </FormSection>
        )}
        {error && <Alert tone="danger">{(typeof error === 'string' ? __uiText(error) : error)}</Alert>}
      </Panel>
      <FormActions
        saveLabel={isEdit ? 'บันทึกลิงก์' : 'สร้างลิงก์'}
        saving={saving}
        onSave={() => void submit()}
        onCancel={() => navigate(ADMIN_ROUTES.smartLinks)}
      />
    </div>
  );
}
