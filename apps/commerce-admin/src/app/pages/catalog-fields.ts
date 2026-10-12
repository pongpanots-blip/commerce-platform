import { uiText as __uiText } from '@cp/ui';
import type { Field } from '../components/ResourcePage';

/** Shared by the product list create dialog and the product detail editor. */
export const productFields: Field[] = [
  { name: 'sku', get label() { return __uiText('รหัสสินค้า'); }, required: true, placeholder: 'BREAD-001', get hint() { return __uiText('รหัสสั้นที่ใช้ค้นสินค้าในระบบ ลูกค้าเห็นชื่อสินค้า ไม่ใช่รหัสนี้'); } },
  { name: 'name', get label() { return __uiText('ชื่อสินค้า'); }, required: true, placeholder: 'ขนมปังโฮลวีต', get hint() { return __uiText('ชื่อที่ทีมและลูกค้าอ่านรู้เรื่อง'); } },
  { name: 'description', get label() { return __uiText('รายละเอียด'); }, type: 'textarea', placeholder: 'ขนมปังโฮลวีต 450 กรัม', get hint() { return __uiText('ไม่บังคับ อธิบายสั้น ๆ ว่าสินค้านี้คืออะไร'); } },
];

/** Shared by the customer list create dialog and the customer detail editor. */
export const customerFields: Field[] = [
  { name: 'name', get label() { return __uiText('ชื่อลูกค้า'); }, required: true, placeholder: 'ร้านอาหารบ้านสวน', get hint() { return __uiText('ชื่อที่ทีมใช้เรียกลูกค้ารายนี้'); } },
  { name: 'code', get label() { return __uiText('รหัสลูกค้า'); }, placeholder: 'CUST-001', get hint() { return __uiText('ไม่บังคับ ใช้เมื่อต้องการอ้างอิงรหัสเดิม'); } },
  { name: 'email', get label() { return __uiText('อีเมล'); }, type: 'email', placeholder: 'orders@example.com', get hint() { return __uiText('ไม่บังคับ ใช้ส่งเอกสาร'); } },
  { name: 'phone', get label() { return __uiText('เบอร์โทร'); }, type: 'tel', placeholder: '0812345678', get hint() { return __uiText('ไม่บังคับ ใส่ตัวเลขโดยไม่ต้องมีขีด'); } },
];

/** The detail editors' required-field check: names the first blank required field, or null when complete. */
export function missingRequired(fields: Field[], form: Record<string, string>): string | null {
  const blank = fields.find(f => f.required && !form[f.name]?.trim());
  return blank ? __uiText('กรอก{0}ก่อนบันทึก', { 0: blank.label }) : null;
}
