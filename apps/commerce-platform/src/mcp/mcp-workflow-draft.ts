import { z } from 'zod';

/**
 * MCP `marketing_workflow_create`: the fields of josh's CreateMarketingWorkflowDto an AI may send.
 * josh always saves a new workflow as status 'draft' and its DTO has no status field, so nothing
 * here can make a workflow send messages — a person activates it in commerce-admin. Step/trigger
 * shapes are josh's to validate (strictly, on activation); we only bound sizes.
 */
export const TRIGGER_TYPES = ['cart_idle', 'page_affinity', 'session_in_window', 'first_login', 'first_visit', 'custom', 'order_milestone', 'scheduled', 'segment_entry'] as const;

export const workflowDraftSchema = {
  name: z.string().trim().min(1).max(200),
  trigger_type: z.enum(TRIGGER_TYPES).optional(),
  trigger_config: z.record(z.string(), z.unknown()).optional().describe('josh MarketingTriggerConfig for trigger_type'),
  steps: z.array(z.object({ id: z.string().min(1).max(64), type: z.string().min(1).max(32) }).passthrough()).max(50).optional()
    .describe('josh MarketingStep[]: audience | wait | gate | action (notify {channels: push|email|in_app, templateKey} / grant_coupon / show_offer) | condition; link with nextId'),
  cooldown_days: z.number().int().min(0).max(365).optional(),
  holdout_percent: z.number().int().min(0).max(100).optional(),
  conversion_window_days: z.number().int().min(1).max(365).optional(),
  exit_on_goal: z.object({ kind: z.enum(['order_placed', 'cart_converted']) }).nullable().optional(),
  schedule: z.object({
    timezone: z.string().min(1).max(64),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    activeFrom: z.string().nullable().optional(),
    activeTo: z.string().nullable().optional(),
  }).optional(),
};

const draft = z.object(workflowDraftSchema);
export type WorkflowDraft = z.infer<typeof draft>;

/** The body sent to josh: only known fields (confirmCode and anything else are dropped). */
export function toJoshWorkflow(args: WorkflowDraft & Record<string, unknown>): WorkflowDraft {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(workflowDraftSchema)) if (args[key] !== undefined) out[key] = args[key];
  return out as WorkflowDraft;
}

/** What the user is shown before confirming. */
export function previewWorkflow(w: WorkflowDraft) {
  const steps = (w.steps ?? []) as { type: string; action?: { kind?: string; channels?: string[] } }[];
  const channels = new Set<string>();
  for (const s of steps) {
    const a = s.action;
    if (a?.kind === 'notify') for (const c of a.channels ?? []) channels.add(c);
  }
  return {
    action: 'create marketing workflow as DRAFT on josh',
    name: w.name,
    trigger: w.trigger_type ?? '(none yet)',
    steps: steps.length,
    stepTypes: steps.map((s) => (s.type === 'action' && s.action?.kind ? `action:${s.action.kind}` : s.type)),
    notifyChannels: [...channels],
    cooldownDays: w.cooldown_days ?? null,
    holdoutPercent: w.holdout_percent ?? null,
    schedule: w.schedule ?? null,
    note: 'Saved as draft — no customer is messaged until someone activates it in commerce-admin › Marketing workflows.',
  };
}
