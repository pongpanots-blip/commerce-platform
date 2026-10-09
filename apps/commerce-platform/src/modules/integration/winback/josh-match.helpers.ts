/**
 * Does a winback account (typically a TMP lead captured from an enriched Market Explorer
 * place) belong to a real Josh customer, and does its current link agree with the evidence?
 *
 * Strong evidence: customer code, tax / company registration number, e-mail.
 * Weak evidence: the company name alone, which is only ever a candidate for a person to check.
 */

export type JoshMatchSignalKey = 'customer_code' | 'register_number' | 'email' | 'company_name';

export type JoshMatchSignal = {
  key: JoshMatchSignalKey;
  /** The account-side value the lookup used (masked by the caller where it is PII). */
  value: string;
  user_ids: string[];
  company_ids: string[];
};

export const JOSH_MATCH_STATUSES = [
  'matched',
  'found_not_linked',
  'mismatch',
  'ambiguous',
  'name_only',
  'linked_unverified',
  'no_match',
] as const;

export type JoshMatchStatus =
  /** Linked, and every strong signal that found something points at the linked user/company. */
  | 'matched'
  /** Not linked yet, but the strong signals agree on one Josh customer. */
  | 'found_not_linked'
  /** Linked to one customer while a strong signal points at another. */
  | 'mismatch'
  /** The strong signals point at more than one customer. */
  | 'ambiguous'
  /** Only the name matched: a candidate, never proof. */
  | 'name_only'
  /** Linked, but nothing on the account confirms it (fields empty or changed in Josh). */
  | 'linked_unverified'
  | 'no_match';

export type JoshMatchVerdict = {
  status: JoshMatchStatus;
  linked: { josh_user_id: string | null; josh_company_id: string | null };
  /** The one customer the strong evidence points to, when there is exactly one. */
  candidate: { josh_user_id: string | null; josh_company_id: string | null } | null;
  /** Strong signals that point somewhere other than the current link. */
  conflicts: JoshMatchSignalKey[];
  signals: JoshMatchSignal[];
};

const STRONG: ReadonlySet<JoshMatchSignalKey> = new Set(['customer_code', 'register_number', 'email']);

const found = (s: JoshMatchSignal) => s.user_ids.length > 0 || s.company_ids.length > 0;

function agreesWithLink(s: JoshMatchSignal, userId: string | null, companyId: string | null): boolean {
  return (!!userId && s.user_ids.includes(userId)) || (!!companyId && s.company_ids.includes(companyId));
}

/**
 * Distinct customers named by the signals: a company counts once however many of its
 * users matched; a user with no company counts on its own.
 */
function distinctCustomers(signals: JoshMatchSignal[]): { companies: Set<string>; loneUsers: Set<string> } {
  const companies = new Set<string>();
  const loneUsers = new Set<string>();
  for (const s of signals) {
    s.company_ids.forEach((id) => companies.add(id));
    if (!s.company_ids.length) s.user_ids.forEach((id) => loneUsers.add(id));
  }
  return { companies, loneUsers };
}

export function judgeJoshMatch(
  linked: { josh_user_id: string | null; josh_company_id: string | null },
  signals: JoshMatchSignal[],
): JoshMatchVerdict {
  const userId = linked.josh_user_id ?? null;
  const companyId = linked.josh_company_id ?? null;
  const isLinked = !!(userId || companyId);
  const strong = signals.filter((s) => STRONG.has(s.key) && found(s));
  const base = { linked: { josh_user_id: userId, josh_company_id: companyId }, signals };

  if (!strong.length) {
    const byName = signals.some((s) => s.key === 'company_name' && found(s));
    const status: JoshMatchStatus = isLinked ? 'linked_unverified' : byName ? 'name_only' : 'no_match';
    return { ...base, status, candidate: null, conflicts: [] };
  }

  if (isLinked) {
    const conflicts = strong.filter((s) => !agreesWithLink(s, userId, companyId)).map((s) => s.key);
    return {
      ...base,
      status: conflicts.length ? 'mismatch' : 'matched',
      candidate: null,
      conflicts,
    };
  }

  const { companies, loneUsers } = distinctCustomers(strong);
  if (companies.size + loneUsers.size !== 1) {
    return { ...base, status: 'ambiguous', candidate: null, conflicts: [] };
  }
  const company = [...companies][0] ?? null;
  const users = new Set(strong.flatMap((s) => s.user_ids));
  return {
    ...base,
    status: 'found_not_linked',
    candidate: {
      josh_company_id: company,
      josh_user_id: users.size === 1 ? [...users][0] : null,
    },
    conflicts: [],
  };
}
