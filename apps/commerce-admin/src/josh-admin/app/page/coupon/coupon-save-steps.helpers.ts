import { extractApiError } from './coupon-error.helpers';

export type SaveStep = { label: string; run: () => Promise<void> };

export type SaveStepsResult = {
  /** Labels of steps that finished, in order — used to report exactly how far a partial save got. */
  completed: string[];
  failed?: { label: string; error: unknown };
};

/** Runs `steps` in order, stopping at the first failure. Callers keep every unsaved form value
 * intact on failure (this never rolls back or retries earlier steps) and re-run the whole save —
 * each step is idempotent (PATCH/PUT with the same payload). */
export async function runSaveSteps(steps: SaveStep[]): Promise<SaveStepsResult> {
  const completed: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
      completed.push(step.label);
    } catch (error: unknown) {
      return { completed, failed: { label: step.label, error } };
    }
  }
  return { completed };
}

/** e.g. "บันทึกข้อมูลคูปอง, รูปภาพ แล้ว แต่บันทึกเงื่อนไขใช้โค้ดไม่สำเร็จ: <api error> — แก้ไขแล้วกดบันทึกอีกครั้ง" */
export function formatSaveStepsError(
  result: SaveStepsResult,
  extractError: (error: unknown) => string = extractApiError,
): string {
  if (!result.failed) return '';
  const donePrefix =
    result.completed.length > 0 ? `บันทึก${result.completed.join(', ')} แล้ว แต่` : '';
  return `${donePrefix}บันทึก${result.failed.label}ไม่สำเร็จ: ${extractError(result.failed.error)} — แก้ไขแล้วกดบันทึกอีกครั้ง`;
}
