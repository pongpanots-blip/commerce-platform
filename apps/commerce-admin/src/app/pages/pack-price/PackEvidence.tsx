import { Alert, Chip, Panel, PanelHead } from '@cp/ui';
import { type PackInputs, type PackPreview } from '../../../../../commerce-platform/src/modules/integration/pack-price-planning/pack-price';
import { commerceText as text } from '../../commerce-copy';
import { decimalMoney, dateText, exclusionText, unitText } from './pack-copy';

export function ProductEvidence({ inputs }: { inputs: PackInputs }) {
  return <Panel><PanelHead title={inputs.product.name} /><dl className="p-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 text-sm">
    <div><dt>{text('สินค้าและหน่วยขายเดิม', 'Product and original selling unit')}</dt><dd>{inputs.sku} · {inputs.product.sellingUnit ?? text('ยังไม่มีหน่วย', 'Unit unavailable')}</dd></div>
    <div><dt>{text('แพ็กเดิม', 'Original pack')}</dt><dd>{inputs.product.packText ?? text('ยังไม่มีข้อมูลแพ็ก', 'Pack text unavailable')}</dd></div>
    <div><dt>{text('ราคาขายเดิม (THB รวม VAT)', 'Original sale price (THB inclusive of VAT)')}</dt><dd>{decimalMoney(inputs.product.currentPriceIncVat)}</dd></div>
    <div><dt>{text('ฐาน VAT ของสินค้า', 'Product VAT basis')}</dt><dd>{inputs.product.vatRateBasisPoints === null ? text('ยังไม่ยืนยัน', 'Unverified') : `${inputs.product.vatRateBasisPoints / 100}%`}</dd></div>
  </dl><p className="px-4 pb-4 text-xs">{text('เวลาอ่านผล', 'Read captured')}: {dateText(inputs.capturedAt)} · {text('ความสดแค็ตตาล็อกต้นทางยังไม่ยืนยัน', 'Upstream catalog freshness remains unverified')}</p></Panel>;
}
export function PackEvidence({ value }: { value: PackPreview }) {
  const { scenario, inputs, preview } = value;
  return <div className="space-y-4"><ProductEvidence inputs={inputs} />
    <Alert tone="muted">{text('ผลนี้ช่วยเทียบหลักฐานและสมมติฐานเพื่อให้คนทบทวน ยังไม่ใช่ข้อสรุปราคาตลาดทั้งหมดหรือคำแนะนำราคาขายที่ยืนยันแล้ว', 'These calculations compare evidence and assumptions for human review. Market coverage and a recommended sale price are unverified.')}</Alert>
    <p role="status" className="text-sm">{text('แหล่งที่เลือกและเทียบได้', 'Selected, calculable observations')}: {preview.observations.filter(o => o.eligible).length} / {scenario.observationIds.length}</p>
    {inputs.observationsTruncated && <Alert tone="warn">{text('อ่านหลักฐานได้ไม่เกิน 200 คู่สินค้า ยังไม่ได้ตรวจทุกแหล่ง', 'Evidence is bounded to 200 recorded pairs; not every source was inspected.')}</Alert>}
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{preview.scenarios.map((row, index) => <Panel key={row.label}><PanelHead title={row.label} /><div className="p-4 space-y-4">
      <dl className="space-y-2 text-sm"><div><dt>{text('ขนาดแพ็กที่เสนอ', 'Proposed pack')}</dt><dd>{scenario.proposals[index].pack.quantity} {unitText(scenario.proposals[index].pack.unit)} × {scenario.proposals[index].pack.count} = {row.totalQuantity} {unitText(row.unit)}</dd></div>
        <div><dt>{text('ราคาที่เสนอ/แพ็ก (รวม VAT)', 'Proposed price per pack (VAT inclusive)')}</dt><dd className="text-xl font-semibold">{decimalMoney(row.salePriceIncVat)}</dd></div>
        <div><dt>{text('ราคาที่เสนอ/หน่วยฐาน (รวม VAT)', 'Proposed price per base unit (VAT inclusive)')}</dt><dd>{decimalMoney(row.pricePerBaseIncVat)} / {unitText(row.unit)}</dd></div>
        <div><dt>{text('รายรับ/แพ็ก ไม่รวม VAT', 'Revenue per pack, ex VAT')}</dt><dd>{decimalMoney(row.revenueExVat)}</dd></div>
        <div><dt>{text('ต้นทุน/แพ็ก ไม่รวม VAT', 'Cost per pack, ex VAT')}</dt><dd>{decimalMoney(row.costExVat)}</dd></div>
        <div><dt>{text('กำไรขั้นต้น/แพ็ก ไม่รวม VAT', 'Gross profit per pack, ex VAT')}</dt><dd>{decimalMoney(row.grossProfitExVat)}</dd></div>
        <div><dt>{text('อัตรากำไรต่อรายรับ (Margin)', 'Margin on revenue')}</dt><dd>{row.grossMarginPercent === null ? text('ยังไม่มีต้นทุนภายในที่ยืนยัน', 'Authoritative internal cost unavailable') : `${row.grossMarginPercent}%`}</dd></div>
        <div><dt>{text('ส่วนเพิ่มจากต้นทุน (Markup)', 'Markup on cost')}</dt><dd>{row.markupPercent === null ? text('ยังคำนวณไม่ได้', 'Unavailable') : `${row.markupPercent}%`}</dd></div>
      </dl>
      <p className="text-xs">{text('สมมติฐานค่าเพิ่ม/แพ็ก ไม่รวม VAT', 'Assumed additional cost per pack, ex VAT')}: {decimalMoney(scenario.proposals[index].additionalCostExVat)} · {scenario.proposals[index].assumption || text('ไม่มีค่าเพิ่มที่เสนอ', 'No additional cost proposed')}</p>
      {row.issues.map(reason => <Alert key={reason} tone="warn">{exclusionText(reason)}</Alert>)}
      <div className="space-y-3">{row.comparisons.map(comparison => { const source = inputs.observations.find(o => o.id === comparison.observationId)!, inspected = preview.observations.find(o => o.id === comparison.observationId)!; return <section key={source.id} className="border-t border-secondary-container pt-3 text-sm space-y-2">
        <h2 className="font-semibold">{source.vendor} · {source.productName}</h2><Chip tone="muted">{source.priceBasis === 'member' ? text('ราคาสมาชิก', 'Member price') : text('ราคาสาธารณะ', 'Public price')}</Chip>
        <p>{text('เดิม', 'Original')}: {source.originalPack.min ?? '—'}{source.originalPack.max !== source.originalPack.min ? `–${source.originalPack.max ?? '—'}` : ''} {unitText(source.originalPack.unit ?? '')} × {source.originalPack.count} · {source.priceIncVat ?? '—'} {source.currency ?? text('สกุลเงินไม่ยืนยัน', 'Currency unverified')}</p>
        <p>{text('เทียบฐานเดียวกัน', 'Normalized basis')}: {decimalMoney(inspected.pricePerBaseIncVat)} / {unitText(inspected.unit ?? '')}</p><p className="text-xs">{text('วันที่พบราคา', 'Observed at')}: {dateText(source.observedAt)}</p>
        {comparison.differencePercent === null ? <p>{text('ไม่นำไปเทียบ', 'Excluded')}: {[...new Set([...inspected.reasons, ...row.issues])].map(exclusionText).join(' · ')}</p> : <p>{text('ราคาทดลอง − ราคาคู่แข่ง', 'Proposed minus competitor')}: {decimalMoney(comparison.differenceForPackIncVat)} {text('ต่อแพ็กทดลอง', 'per proposed pack')} · {comparison.differencePercent}%</p>}
      </section>; })}</div>
    </div></Panel>)}</div>
    <details className="rounded-xl border border-secondary-container p-4"><summary className="cursor-pointer py-2">{text('ดูวิธีคำนวณและขอบเขต', 'Calculation basis and limits')}</summary><div className="mt-3 space-y-2 text-sm"><p>{text('เทียบ THB รวม VAT ต่อหน่วยเดียวกันเท่านั้น ไม่มี FX หรือการแปลงกิโลกรัมเป็นลิตร ราคาสมาชิกยังแยกจากราคาสาธารณะ', 'Compare THB inclusive of VAT on matching dimensions. No FX or mass-to-volume conversion. Member and public observations remain separate.')}</p><p>{text('Margin = กำไร ÷ รายรับไม่รวม VAT; Markup = กำไร ÷ ต้นทุนไม่รวม VAT ราคาคู่แข่งไม่ใช่ต้นทุนภายใน', 'Margin = profit / revenue ex VAT; markup = profit / cost ex VAT. Competitor prices are not internal cost.')}</p><p>{text('คำนวณด้วยทศนิยมแบบเศษส่วน ปัดครึ่งขึ้น: เงิน 2 ตำแหน่ง ราคาต่อหน่วย 6 ตำแหน่ง เปอร์เซ็นต์ 4 ตำแหน่ง', 'Rational decimals with half-up rounding: money 2 places, unit prices 6 places, percentages 4 places.')}</p></div></details>
  </div>;
}
