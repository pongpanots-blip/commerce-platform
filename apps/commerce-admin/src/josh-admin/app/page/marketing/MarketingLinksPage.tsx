// ui-metadata-migration: static labels and UI notices only
import { useId, useState } from 'react';
import {
  getMarketingDeeplink,
  type MarketingLinkParams,
  type MarketingLinkResult,
} from '@josh/shared-api';
import { Select } from '@josh/shared-ui-web';
import AdminListHeader from '../../components/AdminListHeader';
import { CopyField } from '../../components/CopyField';
import { UtmBuilder, EMPTY_UTM, type UtmValues } from '../../components/UtmBuilder';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type LinkType = MarketingLinkParams['type'];

const TYPE_OPTIONS: { value: LinkType; label: string; hint: string }[] = [
  { value: 'custom', get label(){return __uiText("Custom (path เอง)");}, get hint(){return __uiText("เช่น /product/detail/123, /search?q=กุ้ง, / (หน้าแรก)");} },
  { value: 'product', get label(){return __uiText("Product");}, get hint(){return __uiText("ใส่ product inventory id");} },
  { value: 'promotion', get label(){return __uiText("Promotion");}, get hint(){return __uiText("ใส่ promotion id — พาไปหน้า shop + tag campaign");} },
  { value: 'cuisine', get label(){return __uiText("Cuisine");}, get hint(){return __uiText("ใส่ cuisine card id");} },
];

const REF_LABELS: Record<LinkType, string> = {
  get custom(){return __uiText("เส้นทางหน้าเว็บ (Shop path)");},
  get product(){return __uiText("รหัสสินค้า (Product ID)");},
  get promotion(){return __uiText("รหัสโปรโมชั่น (Promotion ID)");},
  get cuisine(){return __uiText("รหัสเมนู (Cuisine ID)");},
};

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
const labelCls = 'text-xs font-semibold text-gray-500';

export default function MarketingLinksPage() {
  __useUiLocale();
  const [type, setType] = useState<LinkType>('custom');
  const [ref, setRef] = useState('');
  const [utm, setUtm] = useState<UtmValues>(EMPTY_UTM);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MarketingLinkResult | null>(null);

  const activeHint = TYPE_OPTIONS.find((o) => o.value === type)?.hint;
  const refLabel = REF_LABELS[type];
  const refPlaceholder = type === 'custom' ? '/product/detail/123' : 'วาง id ที่นี่';
  const typeInputId = useId();
  const refInputId = useId();

  const generate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params: MarketingLinkParams = {
        type,
        utm: {
          source: utm.source.trim() || undefined,
          medium: utm.medium.trim() || undefined,
          campaign: utm.campaign.trim() || undefined,
          content: utm.content.trim() || undefined,
          term: utm.term.trim() || undefined,
        },
      };
      if (type === 'custom') params.path = ref.trim();
      else params.id = ref.trim();

      setResult(await getMarketingDeeplink(params));
    } catch {
      setError(__uiMessage("สร้างลิงก์ไม่สำเร็จ — ตรวจ path/id หรือสิทธิ์อีกครั้ง"));
    } finally {
      setLoading(false);
    }
  };

  const disabled = loading || !ref.trim();

  return (
    <div className="p-6">
      <AdminListHeader
        title={__uiText("Marketing Links")}
        subtitle={__uiText("สร้างลิงก์เดียวสำหรับยิง ads — มือถือเด้งเข้าแอป (deferred deep link), desktop เปิดเว็บ, พร้อม UTM")}
      />

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-gray-100 bg-white p-5">
          <div>
            <label htmlFor={typeInputId} className={labelCls}>{__uiText("ปลายทาง")}</label>
            <Select
              id={typeInputId}
              className="w-full"
              value={type}
              onChange={(e) => {
                setType(e.target.value as LinkType);
                setRef('');
                setResult(null);
              }}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {activeHint && <p className="mt-1 text-xs text-gray-400">{activeHint}</p>}
          </div>

          <div>
            <label htmlFor={refInputId} className={labelCls}>{refLabel}</label>
            <input
              id={refInputId}
              className={field}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder={refPlaceholder}
            />
          </div>

          <UtmBuilder value={utm} onChange={setUtm} />

          <button
            type="button"
            onClick={() => void generate()}
            disabled={disabled}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? __uiText("กำลังสร้าง…") : __uiText("สร้างลิงก์")}
          </button>
          {error && <p className="text-xs text-red-600">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <p className="text-sm font-semibold text-gray-700">{__uiText("ผลลัพธ์")}</p>
          {!result ? (
            <p className="mt-3 text-xs text-gray-400">{__uiText("กรอกปลายทางแล้วกด \"สร้างลิงก์\"")}</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3">
              <CopyField label={__uiText("ลิงก์ Marketing (ยิง ads)")} value={result.shortUrl} />
              {result.webUrl !== result.shortUrl && (
                <CopyField label={__uiText("Web URL (ปลายทาง)")} value={result.webUrl} />
              )}
              {result.provider === 'fallback' && (
                <p className="text-xs text-amber-600">
                  {__uiText("ยังไม่ได้ตั้งค่า ChottuLink — ลิงก์นี้เป็น web URL ตรง (ใช้ได้เลย) จะกลายเป็น short link เมื่อใส่ CHOTTULINK_API_KEY ที่ backend")}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
