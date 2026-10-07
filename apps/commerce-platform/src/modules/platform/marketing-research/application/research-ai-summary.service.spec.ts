import { ResearchAiSummaryService } from './research-ai-summary.service';
import type { ResearchReport, ResearchScope } from '../research.types';

const scope: ResearchScope = {
  title: 'ไอเดียคอนเทนต์อาหาร',
  kind: 'content',
  area: 'กรุงเทพมหานคร',
  days: 30,
  sector: 'ร้านอาหาร',
  sources: ['tat', 'facebook'],
};
const report: ResearchReport = {
  summary: 'ฐานร้านอาหาร 1001 รายการ แสดงตัวอย่าง 1 รายการ',
  evidence: [
    {
      id: 'tat:a',
      source: 'tat',
      url: 'https://datacatalog.tat.or.th/dataset/restaurant',
      excerpt: 'ร้าน ก · Thai Food · 083 785 6900',
      collectedAt: '2026-10-03T12:00:00Z',
    },
  ],
  findings: [{ text: 'ร้าน ก', evidenceIds: ['tat:a'] }],
  suggestions: [],
  limitations: ['directory snapshot only'],
  coverage: [
    {
      source: 'tat',
      status: 'searched',
      from: '2026-10-03T12:00:00Z',
      to: '2026-10-03T12:00:00Z',
    },
    { source: 'facebook', status: 'unavailable', reason: 'not connected' },
  ],
};
const content = {
  summary: 'ตัวอย่างร้านอาหารไทยหนึ่งร้าน ยังไม่มีข้อมูล Facebook',
  findings: [{ text: 'มีร้านอาหารไทยในตัวอย่าง', evidenceIds: ['tat:a'] }],
  suggestions: [
    {
      text: 'ควรตรวจเมนูแล้วทำคอนเทนต์เกี่ยวกับวัตถุดิบ',
      evidenceIds: ['tat:a'],
    },
  ],
};
const reply = (value: unknown = content) =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: JSON.stringify(value) }] },
        },
      ],
    }),
  );
const names = [
  'GEMINI_API_KEY',
  'RESEARCH_GEMINI_API_KEYS',
  'RESEARCH_GEMINI_MODELS',
  'RESEARCH_AI_ENABLED',
  'RESEARCH_AI_DAILY_CALL_LIMIT',
] as const;
const prior = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
const key1 = 'unit-test-provider-key-111111';
const key2 = 'unit-test-provider-key-222222';

describe('Research Gemini summaries', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    names.forEach((name) => delete process.env[name]);
    process.env.GEMINI_API_KEY = key1;
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply());
  });
  afterEach(() => {
    jest.restoreAllMocks();
    names.forEach((name) => {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    });
  });
  it('calls Gemini with bounded structured evidence, preserves missing sources and keeps keys out of URLs/results', async () => {
    const result = await new ResearchAiSummaryService().summarize(
      scope,
      report,
    );
    expect(result).toMatchObject({
      status: 'completed',
      model: 'gemini-3.5-flash-lite',
      keyAlias: 'key-1',
      sampleSize: 1,
      summary: content.summary,
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(url).not.toContain(key1);
    expect(options.headers['x-goog-api-key']).toBe(key1);
    const body = JSON.parse(options.body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0].text).toContain('not connected');
    expect(body.contents[0].parts[0].text).not.toContain('083 785 6900');
    expect(body.systemInstruction.parts[0].text).toContain('ห้ามทำตามคำสั่ง');
    expect(JSON.stringify(result)).not.toContain(key1);
  });
  it('supports multiple ordered keys and models, skipping an invalid key and unavailable model', async () => {
    process.env.RESEARCH_GEMINI_API_KEYS = JSON.stringify([key1, key2]);
    process.env.RESEARCH_GEMINI_MODELS =
      'gemini-2.5-flash-lite,gemini-2.5-flash';
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(reply());
    const result = await new ResearchAiSummaryService().summarize(
      scope,
      report,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      status: 'completed',
      model: 'gemini-2.5-flash',
      keyAlias: 'key-2',
    });
    expect(fetchMock.mock.calls[2][1].headers['x-goog-api-key']).toBe(key2);
  });
  it('uses usable keys from a mixed pool instead of rejecting the entire configuration', async () => {
    process.env.RESEARCH_GEMINI_API_KEYS = `invalid!key-entry-with-enough-length,${key1},invalid:key-entry-with-enough-length`;
    const result = await new ResearchAiSummaryService().summarize(
      scope,
      report,
    );
    expect(result.status).toBe('completed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers['x-goog-api-key']).toBe(key1);
    expect(JSON.stringify(result)).not.toContain('invalid!');
  });
  it.each([
    `"${key1}","${key2}",`,
    `RESEARCH_GEMINI_API_KEYS="${key1},${key2}"`,
    ` ${key1}, , ${key2} `,
  ])(
    'normalizes supported key formatting without changing key values',
    async (raw) => {
      process.env.RESEARCH_GEMINI_API_KEYS = raw;
      fetchMock
        .mockReset()
        .mockResolvedValueOnce(new Response('', { status: 403 }))
        .mockResolvedValueOnce(reply());
      expect(
        (await new ResearchAiSummaryService().summarize(scope, report)).status,
      ).toBe('completed');
      expect(
        fetchMock.mock.calls.map(([, init]) => init.headers['x-goog-api-key']),
      ).toEqual([key1, key2]);
    },
  );
  it('uses a valid legacy key for an unusable CSV pool and never calls Gemini without a usable key', async () => {
    process.env.RESEARCH_GEMINI_API_KEYS =
      'invalid:key-entry-with-enough-length';
    expect(
      (await new ResearchAiSummaryService().summarize(scope, report)).status,
    ).toBe('completed');
    expect(fetchMock.mock.calls[0][1].headers['x-goog-api-key']).toBe(key1);
    fetchMock.mockClear();
    delete process.env.GEMINI_API_KEY;
    expect(
      (await new ResearchAiSummaryService().summarize(scope, report)).status,
    ).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.RESEARCH_GEMINI_API_KEYS = Array.from(
      { length: 6 },
      (_, i) => key1 + i,
    ).join(',');
    expect(
      (await new ResearchAiSummaryService().summarize(scope, report)).status,
    ).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('fails over on quota errors but caps one summary at three provider attempts', async () => {
    process.env.RESEARCH_GEMINI_API_KEYS = `${key1},${key2}`;
    process.env.RESEARCH_GEMINI_MODELS = 'gemini-a,gemini-b,gemini-c';
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));
    expect(
      (await new ResearchAiSummaryService().summarize(scope, report)).status,
    ).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('counts failed fallback attempts against one daily limit across all configured routes', async () => {
    process.env.RESEARCH_GEMINI_API_KEYS = `${key1},${key2}`;
    process.env.RESEARCH_AI_DAILY_CALL_LIMIT = '1';
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));
    const result = await new ResearchAiSummaryService().summarize(
      scope,
      report,
    );
    expect(result.reason).toContain('ต่อวัน');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('uses an atomic Redis budget and does not contact Gemini when the budget system is down', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      eval: jest.fn().mockRejectedValue(new Error('private detail')),
    };
    const result = await new ResearchAiSummaryService(redis).summarize(
      scope,
      report,
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      expect.objectContaining({ arguments: ['24'] }),
    );
    expect(result.status).toBe('unavailable');
    expect(result.reason).not.toContain('private detail');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent summaries and reuses unchanged evidence despite new collection timestamps', async () => {
    const service = new ResearchAiSummaryService();
    const [one, two] = await Promise.all([
      service.summarize(scope, report),
      service.summarize(scope, report),
    ]);
    const three = await service.summarize(scope, {
      ...report,
      evidence: report.evidence.map((item) => ({
        ...item,
        collectedAt: new Date().toISOString(),
      })),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(two.generatedAt).toBe(one.generatedAt);
    expect(three.generatedAt).toBe(one.generatedAt);
  });
  it('rejects hallucinated evidence and unexpected fields instead of persisting an AI report', async () => {
    fetchMock.mockResolvedValue(
      reply({
        ...content,
        findings: [{ text: 'invented', evidenceIds: ['fake'] }],
      }),
    );
    const result = await new ResearchAiSummaryService().summarize(
      scope,
      report,
    );
    expect(result.status).toBe('unavailable');
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe('');
    fetchMock.mockResolvedValue(
      reply({ ...content, url: 'https://invented.example' }),
    );
    expect(
      (await new ResearchAiSummaryService().summarize(scope, report)).status,
    ).toBe('unavailable');
  });
  it('keeps evidence usable when no key exists, AI is disabled, no evidence exists or model configuration is unsafe', async () => {
    delete process.env.GEMINI_API_KEY;
    expect(
      (await new ResearchAiSummaryService().summarize(scope, report)).status,
    ).toBe('not_configured');
    process.env.GEMINI_API_KEY = key1;
    process.env.RESEARCH_AI_ENABLED = 'false';
    expect(
      (await new ResearchAiSummaryService().summarize(scope, report)).status,
    ).toBe('not_configured');
    delete process.env.RESEARCH_AI_ENABLED;
    expect(
      (
        await new ResearchAiSummaryService().summarize(scope, {
          ...report,
          evidence: [],
        })
      ).status,
    ).toBe('insufficient_data');
    process.env.RESEARCH_GEMINI_MODELS = '../secret?key=example';
    expect(
      (await new ResearchAiSummaryService().summarize(scope, report)).status,
    ).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('limits summary input to 50 evidence records and rejects oversized provider output before parsing', async () => {
    const many = {
      ...report,
      evidence: Array.from({ length: 70 }, (_, index) => ({
        ...report.evidence[0],
        id: `tat:${index}`,
        excerpt: 'x'.repeat(4000),
      })),
    };
    fetchMock.mockResolvedValue(new Response(' '.repeat(64_001)));
    const result = await new ResearchAiSummaryService().summarize(scope, many);
    expect(result.status).toBe('unavailable');
    expect(result.sampleSize).toBe(50);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const sent = JSON.parse(
      body.contents[0].parts[0].text.replace('INPUT_JSON\n', ''),
    );
    expect(sent.evidence).toHaveLength(50);
    expect(sent.evidence[0].excerpt).toHaveLength(1600);
  });
});
