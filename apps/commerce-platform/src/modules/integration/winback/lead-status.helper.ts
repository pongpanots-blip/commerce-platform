/** Coarse lead status derived from the pipeline stage (for display). */
export function deriveLeadStatus(
  stage: string,
): 'pending' | 'in_progress' | 'completed' | 'rejected' {
  if (stage === 'rejected' || stage === 'lost') return 'rejected';
  if (stage === 'signed' || stage === 'won') return 'completed';
  if (stage === 'prospect' || stage === 'inactive_pool') return 'pending';
  return 'in_progress';
}
