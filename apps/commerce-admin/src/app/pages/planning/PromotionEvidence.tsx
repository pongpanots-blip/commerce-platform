import { Alert, Chip, Panel, PanelHead, useUiLocale } from '@cp/ui';
import { commerceText as text } from '../../commerce-copy';
import { WorkspaceMetric } from '../../WorkspaceParts';
import { money, observedTime, type PromotionPreview, type PromotionReceipt } from './promotion-contracts';

const issues: Record<string, [string, string]> = {
  cost_unavailable: ['ยังไม่มีต้นทุนที่ยืนยัน จึงยังคำนวณกำไรไม่ได้', 'Verified cost is unavailable; profit cannot be calculated.'],
  stock_unavailable: ['ยังเทียบสต็อกกับหน่วยขายไม่ได้ จึงยังบอกจำนวนที่ขายได้ไม่ได้', 'Stock cannot be matched to the selling unit; sellable quantity is unknown.'],
  source_freshness_unavailable: ['ยังยืนยันความสดของข้อมูลต้นทางไม่ได้', 'Source freshness is unverified.'],
  promotion_capacity_unavailable: ['ยังไม่มีจำนวนสิทธิ์โปรโมชันที่เหลือ', 'Remaining promotion capacity is unavailable.'],
  isolated_proposal_not_checkout_price: ['เป็นการทดลองกติกานี้อย่างเดียว ยังไม่ใช่ราคาที่ลูกค้าจะเห็นตอนสั่ง', 'This isolated offer is not the customer checkout price.'],
  existing_promotion_ownership_unresolved: ['ยังตรวจการซ้อนกับกติกาหรือโปรโมชันเดิมไม่ได้', 'Existing offer ownership and stacking cannot be verified.'],
  approx_or_unknown_price_basis_unsupported: ['ราคาตามน้ำหนักโดยประมาณหรือหน่วยที่ไม่ชัดเจนยังทดลองยอดไม่ได้', 'Approximate weight packs or unknown price bases cannot be calculated.'],
  selling_price_unavailable: ['ยังไม่มีราคาขายหรือหน่วยขายที่ยืนยัน', 'Verified selling price or selling unit is unavailable.'],
  selling_price_identity_currency_or_uom_mismatch: ['หน่วยหรือรหัสสินค้าของร่างไม่ตรงกับข้อมูลราคา ต้องเลือกสินค้าและจำนวนใหม่', 'Draft identity or unit differs from the price source; select the product and quantity again.'],
  tax_rate_unavailable: ['ยังไม่มีอัตราภาษี จึงยังสรุปยอดรวมภาษีไม่ได้', 'Tax rate is unknown; tax-inclusive totals are unavailable.'],
  bogo_requires_count_units: ['ชุดแถมต้องใช้จำนวนชิ้นเต็ม', 'Buy/get offers require whole count quantities.'],
  fractional_count_quantity: ['จำนวนชิ้นต้องเป็นจำนวนเต็ม', 'Count quantity must be a whole number.'],
  invalid_promotion_rule: ['กติกาส่วนลดยังใช้คำนวณไม่ได้ ตรวจค่าที่กรอก', 'Review the offer values before calculating.'],
  rule_is_not_a_supported_discount: ['กติกานี้ไม่ได้ให้ส่วนลดที่รองรับ ตรวจช่วงจำนวนและราคา', 'The offer is not a supported discount; review quantity ranges and price.'],
  margin_constraint_unavailable: ['ยังตรวจเกณฑ์กำไรขั้นต่ำไม่ได้ เพราะข้อมูลต้นทุนไม่ครบ', 'The minimum margin cannot be checked without cost.'],
  money_out_of_range: ['ยอดเกินช่วงที่คำนวณได้ ลดจำนวนหรือทบทวนกติกา', 'Amount exceeds the supported range; review quantity and offer.'],
};
export function PromotionEvidence({ value, saved = false }: { value: PromotionPreview | PromotionReceipt; saved?: boolean }) {
  useUiLocale(); const { inputs, preview } = value, a = preview.amounts;
  const warnings = [...new Set(preview.issues.map(i => i.code))];
  return <section className="space-y-4" aria-label={text('ผลทดลองและหลักฐาน', 'Preview and evidence')}>
    <Alert tone={preview.status === 'rejected' || preview.status === 'constraints_failed' ? 'danger' : 'warn'}>
      <strong>{preview.status === 'rejected' ? text('ยังทดลองยอดนี้ไม่ได้', 'This amount cannot be previewed.') : text('ผลทดลองยังมีข้อมูลที่ต้องตรวจ', 'The preview still has evidence gaps.')}</strong>
      <p>{saved ? text('เก็บร่างและหลักฐานแล้ว แต่ข้อมูลที่ยังขาดไม่ได้กลายเป็นข้อมูลที่ยืนยัน', 'The draft and evidence are saved; missing evidence remains unverified.') : text('ยังไม่บันทึกร่าง ตรวจผลและข้อมูลที่ขาดก่อนบันทึก', 'The draft is not saved. Review the result and gaps before saving.')}</p>
    </Alert>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <WorkspaceMetric label={text('ยอดก่อนส่วนลด', 'Before discount')} value={a ? money(a.beforeDiscountMinor) : null} note={text('ตามราคาที่อ่านได้ รวมภาษี', 'Based on the observed tax-inclusive price.')} />
      <WorkspaceMetric label={text('ส่วนลดของร่างนี้', 'Draft discount')} value={a ? money(a.discountMinor) : null} note={text('กติกาที่ทดลอง ไม่รวมคูปองหรือเงื่อนไขอื่น', 'Isolated offer; excludes coupons and other conditions.')} />
      <WorkspaceMetric label={text('ยอดหลังส่วนลด', 'After discount')} value={a ? money(a.totalIncVatMinor) : null} reason={text('ยังไม่มีสูตรหน่วยหรือภาษีที่ยืนยัน', 'Unit basis or tax evidence is unavailable.')} note={text('ปัดราคาต่อหน่วยก่อนรวมยอด ยังไม่ใช่ราคาหน้าชำระ', 'Unit price rounded before line total; not checkout price.')} />
      <WorkspaceMetric label={text('กำไรและจำนวนที่ขายได้', 'Profit and sellable stock')} reason={text('ต้นทุนและการเทียบสต็อกกับหน่วยขายยังไม่ครบ', 'Cost and stock-to-selling-unit evidence are incomplete.')} />
    </div>
    <Panel><PanelHead title={text('สิ่งที่ยังต้องตรวจ', 'Evidence gaps')} /><ul className="p-4 space-y-2 text-sm">
      {warnings.map(code => <li key={code} className="flex items-start gap-2"><span aria-hidden="true">•</span><span>{text(...(issues[code] ?? ['มีเงื่อนไขที่ยังยืนยันไม่ได้ ให้ตรวจข้อมูลต้นทางก่อนใช้งาน', 'An additional condition is unverified; inspect the source before use.']))}</span></li>)}
    </ul></Panel>
    <Panel><PanelHead title={text('ข้อมูลที่ใช้ทดลอง', 'Observed inputs')} /><dl className="p-4 grid gap-3 text-sm sm:grid-cols-2">
      <div><dt>{text('สินค้าและหน่วย', 'Product and unit')}</dt><dd className="font-medium break-words">{inputs.sku} · {inputs.product.unit ?? text('ยังไม่มีหน่วย', 'Unit unavailable')} · {inputs.product.packSize ?? '—'}</dd></div>
      <div><dt>{text('ราคาขายที่อ่านได้', 'Observed selling price')}</dt><dd>{inputs.price.unitPrice ? money(Math.round(Number(inputs.price.unitPrice) * 100)) : '—'} <Chip tone="muted">{text('ยังไม่ยืนยันความสด', 'Freshness unverified')}</Chip></dd></div>
      <div><dt>{text('เวลาอ่านหลักฐาน', 'Evidence read time')}</dt><dd>{observedTime(inputs.observedAt)}</dd></div>
      <div><dt>{text('เวลาที่แหล่งราคาอัปเดต', 'Price source timestamp')}</dt><dd>{observedTime(inputs.price.sourceAsOf)}</dd></div>
    </dl></Panel>
  </section>;
}
