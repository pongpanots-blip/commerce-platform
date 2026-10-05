import {
  STAGE_MEDIAN_MIN_SAMPLES,
  SYNC_STAGE_ACTOR,
  ackIdentityKey,
  median,
  medianStageDays,
  medianStageDaysByActor,
  requiresSubjectId,
  stageDurationSamples,
  stageEnteredAt,
  truncateNote,
  type StageHistoryRow,
} from './meeting-prep.helpers';
import { WinbackMeetingSignal } from './winback.enums';

const at = (iso: string) => new Date(iso);

describe('truncateNote', () => {
  it('returns null for empty, missing or whitespace-only notes', () => {
    expect(truncateNote(null)).toBeNull();
    expect(truncateNote(undefined)).toBeNull();
    expect(truncateNote('   ')).toBeNull();
  });

  it('keeps a short note as-is', () => {
    expect(truncateNote('รอเจ้าของกลับจากต่างประเทศ')).toBe(
      'รอเจ้าของกลับจากต่างประเทศ',
    );
  });

  it('truncates past the cap and marks the cut', () => {
    const result = truncateNote('x'.repeat(250));
    expect(result).toHaveLength(201); // 200 chars + the ellipsis
    expect(result?.endsWith('…')).toBe(true);
  });
});

describe('median', () => {
  it('is null with no samples', () => {
    expect(median([])).toBeNull();
  });

  it('takes the middle of an odd list', () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it('averages the middle pair of an even list', () => {
    expect(median([1, 2, 4, 10])).toBe(3);
  });

  it('does not mutate the caller array', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('stageDurationSamples', () => {
  const windowStart = at('2026-06-09T00:00:00Z'); // 90 days before "now"
  const windowEnd = at('2026-09-07T00:00:00Z');

  const row = (
    account: string,
    from: string | null,
    to: string,
    changed: string,
  ): StageHistoryRow => ({
    account_id: account,
    from_stage: from,
    to_stage: to,
    changed_at: at(changed),
  });

  it('credits the duration to the stage that was left', () => {
    const samples = stageDurationSamples(
      [
        row('a', null, 'contacted', '2026-08-01T00:00:00Z'),
        row('a', 'contacted', 'negotiate', '2026-08-05T00:00:00Z'),
      ],
      windowStart,
      windowEnd,
    );
    expect(samples.get('contacted')).toEqual([4]);
    expect(samples.has('negotiate')).toBe(false);
  });

  it('ignores a transition that completed before the window', () => {
    const samples = stageDurationSamples(
      [
        row('a', null, 'contacted', '2026-05-01T00:00:00Z'),
        row('a', 'contacted', 'negotiate', '2026-05-10T00:00:00Z'),
      ],
      windowStart,
      windowEnd,
    );
    expect(samples.size).toBe(0);
  });

  it('measures a transition that started before the window but ended inside it', () => {
    const samples = stageDurationSamples(
      [
        row('a', null, 'contacted', '2026-05-20T00:00:00Z'),
        row('a', 'contacted', 'negotiate', '2026-06-19T00:00:00Z'),
      ],
      windowStart,
      windowEnd,
    );
    expect(samples.get('contacted')).toEqual([30]);
  });

  it('does not pair rows across different accounts', () => {
    const samples = stageDurationSamples(
      [
        row('a', null, 'contacted', '2026-08-01T00:00:00Z'),
        row('b', 'contacted', 'negotiate', '2026-08-20T00:00:00Z'),
      ],
      windowStart,
      windowEnd,
    );
    expect(samples.size).toBe(0);
  });

  it('skips the first row of an account, which has no measurable start', () => {
    const samples = stageDurationSamples(
      [row('a', 'contacted', 'negotiate', '2026-08-01T00:00:00Z')],
      windowStart,
      windowEnd,
    );
    expect(samples.size).toBe(0);
  });
});

describe('medianStageDays', () => {
  const windowStart = at('2026-06-09T00:00:00Z');
  const windowEnd = at('2026-09-07T00:00:00Z');

  it('returns a rounded median per stage and omits stages with no samples', () => {
    const rows: StageHistoryRow[] = [
      // account a: 4 days in contacted
      { account_id: 'a', from_stage: null, to_stage: 'contacted', changed_at: at('2026-08-01T00:00:00Z') },
      { account_id: 'a', from_stage: 'contacted', to_stage: 'negotiate', changed_at: at('2026-08-05T00:00:00Z') },
      // account b: 9 days in contacted
      { account_id: 'b', from_stage: null, to_stage: 'contacted', changed_at: at('2026-08-01T00:00:00Z') },
      { account_id: 'b', from_stage: 'contacted', to_stage: 'negotiate', changed_at: at('2026-08-10T00:00:00Z') },
    ];
    expect(medianStageDays(rows, windowStart, windowEnd)).toEqual({ contacted: 6.5 });
  });

  it('is an empty object when nothing completed in the window', () => {
    expect(medianStageDays([], windowStart, windowEnd)).toEqual({});
  });
});

describe('stageEnteredAt', () => {
  const rows: StageHistoryRow[] = [
    // newest first, as the service loads them
    { account_id: 'a', from_stage: 'appointment', to_stage: 'negotiate', changed_at: at('2026-08-17T14:20:00Z') },
    { account_id: 'a', from_stage: 'negotiate', to_stage: 'appointment', changed_at: at('2026-08-10T09:00:00Z') },
    { account_id: 'a', from_stage: 'contacted', to_stage: 'negotiate', changed_at: at('2026-08-01T09:00:00Z') },
  ];

  it('takes the most recent move into the current stage, not an older one', () => {
    expect(stageEnteredAt(rows, 'negotiate')).toEqual(at('2026-08-17T14:20:00Z'));
  });

  it('is null when history never moved the lead into that stage', () => {
    // The caller falls back to promoted_to_lead_at / create_date.
    expect(stageEnteredAt(rows, 'contacted')).toBeNull();
    expect(stageEnteredAt([], 'negotiate')).toBeNull();
  });
});

describe('ackIdentityKey', () => {
  it('separates two different appointments on the same lead', () => {
    const first = ackIdentityKey('acc', 'appointment_unlogged', 'act-1');
    const second = ackIdentityKey('acc', 'appointment_unlogged', 'act-2');
    expect(first).not.toBe(second);
  });

  it('treats a missing subject the same as an explicit null', () => {
    expect(ackIdentityKey('acc', 'never_touched', null)).toBe(
      ackIdentityKey('acc', 'never_touched', undefined),
    );
  });
});

describe('requiresSubjectId', () => {
  it('requires a subject for the signals that are about something inside the lead', () => {
    expect(requiresSubjectId(WinbackMeetingSignal.APPOINTMENT_UNLOGGED)).toBe(true);
    expect(requiresSubjectId(WinbackMeetingSignal.STAGE_STALLED)).toBe(true);
  });

  it('does not for signals whose subject is the lead itself', () => {
    expect(requiresSubjectId(WinbackMeetingSignal.NEVER_TOUCHED)).toBe(false);
    expect(requiresSubjectId(WinbackMeetingSignal.WENT_QUIET)).toBe(false);
  });
});

describe('medianStageDaysByActor', () => {
  const windowStart = at('2026-06-09T00:00:00Z');
  const windowEnd = at('2026-09-07T00:00:00Z');

  /** `count` completed stays in `stage`, each `days` long, closed by `actor`. */
  const stays = (
    prefix: string,
    stage: string,
    days: number,
    actor: string | null,
    count: number,
  ): StageHistoryRow[] =>
    Array.from({ length: count }, (_, i) => [
      {
        account_id: `${prefix}-${i}`,
        from_stage: null,
        to_stage: stage,
        changed_at: at('2026-08-01T00:00:00Z'),
        changed_by: actor,
      },
      {
        account_id: `${prefix}-${i}`,
        from_stage: stage,
        to_stage: 'won',
        changed_at: new Date(at('2026-08-01T00:00:00Z').getTime() + days * 86_400_000),
        changed_by: actor,
      },
    ]).flat();

  it('reports a median once the rep has enough completed stays', () => {
    const rows = stays('a', 'negotiate', 10, 'rep-1', STAGE_MEDIAN_MIN_SAMPLES);
    expect(
      medianStageDaysByActor(rows, windowStart, windowEnd, ['negotiate']),
    ).toEqual({ 'rep-1': { negotiate: 10 } });
  });

  it('sends null, not a figure, when the sample is too small to mean anything', () => {
    const rows = stays('a', 'negotiate', 12, 'rep-1', STAGE_MEDIAN_MIN_SAMPLES - 1);
    expect(
      medianStageDaysByActor(rows, windowStart, windowEnd, ['negotiate']),
    ).toEqual({ 'rep-1': { negotiate: null } });
  });

  it('gives every rep the same stage keys as the team line, so bars line up', () => {
    const rows = stays('a', 'negotiate', 10, 'rep-1', STAGE_MEDIAN_MIN_SAMPLES);
    const result = medianStageDaysByActor(rows, windowStart, windowEnd, [
      'contacted',
      'negotiate',
    ]);
    expect(result['rep-1']).toEqual({ contacted: null, negotiate: 10 });
  });

  it('attributes a stay to the rep who moved the lead out of the stage', () => {
    const rows: StageHistoryRow[] = [
      { account_id: 'a', from_stage: null, to_stage: 'negotiate', changed_at: at('2026-08-01T00:00:00Z'), changed_by: 'rep-old' },
      { account_id: 'a', from_stage: 'negotiate', to_stage: 'won', changed_at: at('2026-08-11T00:00:00Z'), changed_by: 'rep-new' },
    ];
    const result = medianStageDaysByActor(rows, windowStart, windowEnd, ['negotiate'], {
      minSamples: 1,
    });
    expect(Object.keys(result)).toEqual(['rep-new']);
  });

  it('excludes the sync actor, which is not a rep', () => {
    const rows = stays('a', 'negotiate', 10, SYNC_STAGE_ACTOR, STAGE_MEDIAN_MIN_SAMPLES);
    expect(medianStageDaysByActor(rows, windowStart, windowEnd, ['negotiate'])).toEqual({});
  });

  it('omits reps outside the caller\'s scope entirely', () => {
    const rows = [
      ...stays('a', 'negotiate', 10, 'rep-1', STAGE_MEDIAN_MIN_SAMPLES),
      ...stays('b', 'negotiate', 30, 'rep-2', STAGE_MEDIAN_MIN_SAMPLES),
    ];
    const result = medianStageDaysByActor(rows, windowStart, windowEnd, ['negotiate'], {
      allowedActorIds: new Set(['rep-1']),
    });
    expect(Object.keys(result)).toEqual(['rep-1']);
  });
});
