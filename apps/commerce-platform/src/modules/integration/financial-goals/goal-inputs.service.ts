import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { WinbackReports } from '../winback/winback-reports';
import { goalInputsSchema, goalPeriod, goalRange, goalScenarioSchema, previewGoal, type GoalInputs } from './financial-goals';
const decimalContext = (v: unknown): string | null => {
  const value = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v : '';
  return /^\d{1,10}(\.\d{1,2})?$/.test(value) ? value : null;
};
@Injectable()
export class GoalInputsService {
  constructor(private readonly reports: WinbackReports) {}
  async inputs(raw: string): Promise<GoalInputs> {
    const valid = goalPeriod.safeParse(raw); if (!valid.success) throw new BadRequestException('Invalid planning month');
    const period = valid.data, range = goalRange(period), capturedAt = new Date().toISOString();
    let context: GoalInputs['context'] = { gmvIncVat: null, monthlyGmvTarget: null, targetSet: null, coverage: 'unavailable', reason: 'source_unavailable' };
    if (this.reports.available) try {
      const raw = await this.reports.dashboard(range.from, range.to) as { gmv?: unknown; target?: { set?: unknown; baht?: unknown } };
      const gmv = decimalContext(raw?.gmv), set = raw?.target?.set, target = set === true ? decimalContext(raw?.target?.baht) : null;
      if (gmv !== null && typeof set === 'boolean' && (!set || target !== null)) context = { gmvIncVat: gmv, monthlyGmvTarget: target, targetSet: set, coverage: 'available', reason: 'existing_gmv_context_only' };
      else context.reason = 'source_invalid';
    } catch { /* Known missing source stays partial; never zero, profit or fabricated attainment. */ }
    const evidence = { period, range, scope: 'existing_winback_team_report' as const, source: this.reports.source, upstreamFreshness: 'unverified' as const, context,
      actuals: { netSalesExVat: null, internalCostExVat: null, operatingExpensesExVat: null, grossProfitExVat: null, grossMarginPercent: null, totalCostExVat: null, netProfitExVat: null, achievementPercent: null },
      limitations: ['net_sales_ex_vat_unavailable', 'internal_cost_unavailable', 'operating_expenses_unavailable', 'catalog_and_report_freshness_unverified', 'gmv_is_not_profit_or_net_sales'] };
    return goalInputsSchema.parse({ schemaVersion: 1, capturedAt, sourceFingerprint: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'), ...evidence, operationalWrites: false, activationAllowed: false });
  }
  async preview(raw: unknown) {
    const scenario = goalScenarioSchema.parse(raw), inputs = await this.inputs(scenario.period);
    if (scenario.sourceFingerprint !== inputs.sourceFingerprint) throw new ConflictException('Goal context changed. Read current sources and review again.');
    return previewGoal(scenario, inputs);
  }
}
