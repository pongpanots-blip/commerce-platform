import { WinbackActivityType, WinbackStage } from './winback.enums';

const AUTO_ADVANCE_FROM = new Set<string>([WinbackStage.PROSPECT, WinbackStage.INACTIVE_POOL]);

/**
 * The stage a lead should hold after an activity is logged.
 * An explicit requested stage always wins; otherwise a brand-new lead
 * (prospect / inactive_pool) auto-advances to contacted, and any other
 * stage is left untouched.
 */
export function nextStageAfterActivity(
  currentStage: string,
  requestedStage?: string | null,
): string {
  if (requestedStage) return requestedStage;
  if (AUTO_ADVANCE_FROM.has(currentStage)) return WinbackStage.CONTACTED;
  return currentStage;
}

/** On-site visit kinds that increment visit_count. */
export function isVisit(type: string): boolean {
  return type === WinbackActivityType.VISIT || type === WinbackActivityType.STORE_VISIT;
}
