import { ServiceUnavailableException } from '@nestjs/common';
import type { GrowthResults } from '@cp/growth';

export const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const finiteNumber = (value: unknown): number | null => {
  if (value == null || value === '' || !['number', 'string'].includes(typeof value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function count(value: unknown): number {
  const number = finiteNumber(value);
  if (number === null || !Number.isSafeInteger(number) || number < 0)
    throw new ServiceUnavailableException('ข้อมูลจำนวนจาก Josh ไม่ครบหรือไม่ถูกต้อง');
  return number;
}

/** Josh's read relay retains the endpoint's { statusCode, data } envelope. */
export function workflowPayload(value: unknown, workflowId: string): Record<string, unknown> {
  const envelope = object(value);
  const data = envelope.data === undefined ? envelope : object(envelope.data);
  if (data.workflowId !== workflowId)
    throw new ServiceUnavailableException('ข้อมูลผลลัพธ์ไม่ตรงกับ workflow ที่ขอ');
  return data;
}

export function experimentResult(payload: Record<string, unknown>): GrowthResults['experiment'] {
  const arm = (value: unknown) => {
    const raw = object(value);
    const group = { enrolled: count(raw.enrolled), converted: count(raw.converted) };
    if (group.converted > group.enrolled) throw new ServiceUnavailableException('จำนวน conversion มากกว่าจำนวนที่เข้า workflow');
    return group;
  };
  const sent = arm(payload.sent), holdout = arm(payload.holdout);
  const small = [sent, holdout].some((group) => group.enrolled < 100 || group.converted < 5 || group.enrolled - group.converted < 5);
  return {
    sent, holdout,
    rateDifferencePoints: sent.enrolled && holdout.enrolled
      ? Math.round((sent.converted / sent.enrolled - holdout.converted / holdout.enrolled) * 10_000) / 100 : null,
    confidence: small ? 'insufficient' : 'inconclusive',
    note: `${small ? 'ข้อมูลกลุ่มน้อย ยังสรุปผลทดลองไม่ได้' : 'จำนวนกลุ่มถึงเกณฑ์แสดงผล แต่ยังยืนยันเหตุและผลไม่ได้'}; กลุ่ม sent คือ enrollment ที่ไม่เป็น holdout ไม่ใช่จำนวนผู้รับที่ส่งสำเร็จ; ยังไม่ยืนยันการแบ่งกลุ่มคงที่ระดับบริษัท ความเป็นอิสระ หรือการพ้น conversion window ของทุกคน`,
  };
}
