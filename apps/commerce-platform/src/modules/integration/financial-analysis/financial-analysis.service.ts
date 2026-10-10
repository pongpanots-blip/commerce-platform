import { Injectable, BadRequestException } from "@nestjs/common";
import { GoalInputsService } from "../financial-goals/goal-inputs.service";
import { GoalDraftsService } from "../financial-goals/goal-drafts.service";
import { FinancialReaderService } from "./financial-reader.service";
import {
  financeQuerySchema,
  financeResponseSchema,
  financePeriodError,
  recordedVariance,
  type FinanceResponse,
} from "./financial-analysis";
@Injectable()
export class FinancialAnalysisService {
  constructor(
    private readonly reader: FinancialReaderService,
    private readonly goalInputs: GoalInputsService,
    private readonly goals: GoalDraftsService,
  ) {}
  async analysis(raw: unknown, actor: string): Promise<FinanceResponse> {
    const query = financeQuerySchema.parse(raw);
    if (financePeriodError(query))
      throw new BadRequestException(
        "Financial evidence requires current or past calendar months.",
      );
    const [current, previous, context, goal] = await Promise.all([
      this.reader.period(query.month, query.timezone),
      this.reader.period(query.compare, query.timezone),
      this.goalInputs
        .inputs(query.month)
        .then((v) => ({ value: v, issue: null }))
        .catch(() => ({ value: null, issue: "context_unavailable" as const })),
      query.goalId
        ? this.goals
            .get(query.goalId, actor)
            .then((g) => ({
              id: g.id,
              revision: g.revision,
              name: g.scenario.name,
              period: g.scenario.period,
              metric: g.scenario.metric,
              target: g.scenario.target,
              actual: null,
              variance: null,
              attainment: null,
              compatiblePeriod:
                query.timezone === "UTC" && g.scenario.period === query.month,
              reason: "actual_financial_basis_unavailable" as const,
            }))
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    return financeResponseSchema.parse({
      query,
      current,
      previous,
      variance: recordedVariance(current, previous),
      goalContext: context.value,
      goalContextIssue:
        query.goalId && !goal ? "private_goal_unavailable" : context.issue,
      selectedGoal: goal,
      readOnly: true,
      operationalWrites: false,
    }) as FinanceResponse;
  }
}
