import { EventPredicate, evaluationInstant, FixtureScope, ProfilePredicate, SEGMENT_LIMITS, SegmentDefinition, SegmentRule, validateSegment } from './segment-contracts';

export interface CompiledAtom { alias: string; countAlias: string | null; predicate: ProfilePredicate | EventPredicate }
export interface CompiledFixtureSegment {
  text: string; values: unknown[]; evaluatedAt: string; definition: SegmentDefinition; atoms: CompiledAtom[]; scope: FixtureScope;
}

/** Only fixed fixture relations and allowlisted expressions; every caller value is a parameter. */
export function compileFixtureSegment(raw: unknown, scope: FixtureScope, time: unknown): CompiledFixtureSegment {
  FixtureScope.assert(scope);
  const definition = validateSegment(raw), evaluatedAt = evaluationInstant(time);
  const values: unknown[] = [scope.tenantId, [...scope.branchIds], evaluatedAt];
  const bind = (v: unknown) => { values.push(v); return `$${values.length}`; };
  const measured: string[] = [], predicates: string[] = [], atoms: CompiledAtom[] = [];
  const end = '$3::timestamptz';
  const profileKnown = `b.profile_as_of IS NOT NULL AND b.profile_as_of <= ${end} AND (b.created_at IS NULL OR b.created_at <= b.profile_as_of)`;
  const compile = (n: SegmentRule): string => {
    if (n.kind === 'and' || n.kind === 'or') return `(${n.children.map(compile).join(n.kind === 'and' ? ' AND ' : ' OR ')})`;
    if (n.kind === 'not') return `(NOT ${compile(n.child)})`;
    const index = atoms.length, alias = `a${index}`;
    if (n.kind === 'profile') {
      let expression: string;
      if (n.field === 'eligible') expression = `b.eligible = ${bind(n.value)}::boolean`;
      else if (n.field === 'region') expression = `b.region ${n.operator === 'eq' ? '=' : '<>'} ${bind(n.value)}::text`;
      else expression = `CASE WHEN b.approved_at IS NULL OR (b.created_at IS NOT NULL AND b.approved_at < b.created_at) OR b.approved_at > b.profile_as_of THEN NULL ELSE b.approved_at <= ${end} - ${bind(n.value)}::int * interval '1 day' END`;
      predicates.push(`CASE WHEN ${profileKnown} THEN (${expression}) ELSE NULL END AS ${alias}`);
      atoms.push({ alias, countAlias: null, predicate: n });
    } else {
      const days = bind(n.window.kind === 'last_days' ? n.window.days : n.window.maxDays);
      const start = n.window.kind === 'last_days' ? `${end} - ${days}::int * interval '1 day'` : 'b.created_at';
      const bounded = n.window.kind === 'last_days' ? 'TRUE' : `b.created_at IS NOT NULL AND b.created_at >= ${end} - ${days}::int * interval '1 day' AND b.created_at < ${end}`;
      const event = bind(n.event), countAlias = `v${index}`;
      // Complete interval metadata must predate evaluation. An import/read timestamp is never a watermark.
      const coverage = `EXISTS (SELECT 1 FROM ba_fixture_coverage c WHERE c.tenant_id=b.tenant_id AND c.branch_id=b.branch_id AND c.event_name=${event}::text
        AND c.complete_from <= (${start}) AND c.complete_through >= ${end} AND c.asserted_at <= ${end} AND c.identity_complete IS TRUE)`;
      // Unmapped events cannot establish zero for any branch in that tenant/window.
      const unresolved = `NOT EXISTS (SELECT 1 FROM ba_fixture_events u WHERE u.tenant_id=b.tenant_id AND u.event_name=${event}::text
        AND u.occurred_at >= (${start}) AND u.occurred_at < ${end}
        AND (u.branch_id IS NULL OR u.company_id IS NULL))`;
      const replayIdentity = n.event === 'order_accepted' ? 'r.order_id=l.order_id' : 'r.event_id=l.event_id';
      const noKnownLateArrival = `NOT EXISTS (SELECT 1 FROM ba_fixture_events l WHERE l.tenant_id=b.tenant_id AND l.branch_id=b.branch_id AND l.event_name=${event}::text
        AND l.occurred_at >= (${start}) AND l.occurred_at < ${end} AND l.received_at > ${end}
        AND NOT EXISTS (SELECT 1 FROM ba_fixture_events r WHERE r.tenant_id=l.tenant_id AND r.branch_id=l.branch_id AND r.company_id=l.company_id AND r.event_name=l.event_name
          AND ${replayIdentity} AND r.occurred_at=l.occurred_at AND r.received_at <= ${end}))`;
      const identities = n.event === 'order_accepted' ? 'e.order_id' : 'e.event_id';
      measured.push(`CASE WHEN (${profileKnown}) AND (${bounded}) AND (${coverage}) AND (${unresolved}) AND (${noKnownLateArrival}) THEN
        (SELECT count(DISTINCT ${identities})::int FROM ba_fixture_events e WHERE e.tenant_id=b.tenant_id AND e.branch_id=b.branch_id AND e.company_id=b.company_id
          AND e.event_name=${event}::text AND e.occurred_at >= (${start}) AND e.occurred_at < ${end} AND e.received_at <= ${end}) ELSE NULL END AS ${countAlias}`);
      const operator = { eq: '=', gte: '>=', lte: '<=' }[n.operator];
      predicates.push(`b.${countAlias} ${operator} ${bind(n.value)}::int AS ${alias}`);
      atoms.push({ alias, countAlias, predicate: n });
    }
    return alias;
  };
  const result = compile(definition.rule);
  const text = `WITH scoped AS (
      SELECT b.* FROM ba_fixture_branches b WHERE b.tenant_id=$1::text AND b.branch_id=ANY($2::text[])
    ), measured AS (
      SELECT b.*${measured.length ? ', ' + measured.join(', ') : ''} FROM scoped b
    ), truth AS (
      SELECT b.*, ${predicates.join(', ')} FROM measured b
    ) SELECT branch_id, company_id, profile_as_of, ${atoms.map(a => a.alias).join(', ')}${atoms.filter(a => a.countAlias).map(a => `, ${a.countAlias}`).join('')},
      (${result}) AS membership FROM truth ORDER BY branch_id LIMIT ${SEGMENT_LIMITS.maxBranches + 1}`;
  if (text.length > SEGMENT_LIMITS.maxSqlBytes) throw new Error('Compiled query exceeds size limit.');
  return { text, values, evaluatedAt, definition, atoms, scope };
}
