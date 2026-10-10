import { ExpressionNode, MarketingExpressionField, parseMarketingExpression } from './expression.parser';

/** Condition fields commerce can answer in phase 1 (no cart / page-view data yet). */
export const SUPPORTED_FIELDS: MarketingExpressionField[] = ['still_no_order', 'segment.in', 'user.order_count', 'time.in_schedule', 'time.hour', 'time.dow'];
export const FIELD_LABELS: Record<string, string> = {
  still_no_order: 'ยังไม่สั่งซื้อตั้งแต่เข้า workflow', 'segment.in': 'อยู่ใน segment', 'user.order_count': 'จำนวนออเดอร์ทั้งหมด',
  'time.in_schedule': 'อยู่ในช่วงเวลาทำงาน', 'time.hour': 'ชั่วโมง (0–23)', 'time.dow': 'วันในสัปดาห์ (0=อา)',
};

const fieldsOf = (node: ExpressionNode): MarketingExpressionField[] =>
  node.type === 'comparison' ? [node.field] : [...fieldsOf(node.left), ...fieldsOf(node.right)];

export function checkExpression(source: string): { ok: true; node: ExpressionNode } | { ok: false; error: string } {
  let node: ExpressionNode;
  try { node = parseMarketingExpression(source); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const unsupported = [...new Set(fieldsOf(node).filter((f) => !SUPPORTED_FIELDS.includes(f)))];
  if (unsupported.length) return { ok: false, error: `ใช้ได้ในเฟส 2: ${unsupported.join(', ')}` };
  return { ok: true, node };
}
