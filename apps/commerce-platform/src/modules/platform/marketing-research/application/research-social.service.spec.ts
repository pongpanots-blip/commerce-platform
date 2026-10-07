import { randomUUID } from 'node:crypto';
import { ResearchSocialService } from './research-social.service';
import { apifyTask, socialSourceStatus } from './research-social.config';
import { researchSourceStatus, type ResearchScope } from '../research.types';

const scope: ResearchScope = {
  title: 'วัตถุดิบอาหาร',
  kind: 'content',
  area: 'กรุงเทพมหานคร',
  days: 30,
  sector: 'ทุกกลุ่ม',
  sources: ['google', 'youtube', 'facebook', 'instagram', 'tiktok'],
};
const key = 'fake_youtube_key_for_local_tests_123456';
const token = 'fake_apify_token_for_local_tests_123456';
const task = {
  taskId: 'TaskFacebook12345',
  input: {
    searchQueries: ['{{query}}'],
    maxItems: '{{limit}}',
    since: '{{since}}',
  },
  fields: { url: 'url', text: 'text', title: 'name', publishedAt: 'date' },
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const newsXml = (
  link = 'https://news.google.com/rss/articles/abc',
  title = 'ชีส &amp; ร้านอาหาร',
  pubDate = new Date().toUTCString(),
) =>
  `<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate><source url="https://example.com">ข่าวอาหาร</source></item></channel></rss>`;
const apifyResponse = {
  data: {
    id: 'RunFacebook12345',
    actorTaskId: task.taskId,
    status: 'SUCCEEDED',
    defaultDatasetId: 'DatasetFacebook1',
  },
};
const post = {
  url: 'https://www.facebook.com/page/posts/123',
  text: 'เมนูชีสสำหรับร้านอาหาร',
  name: 'ร้าน ก',
  date: new Date().toISOString(),
};

class Redis {
  values = new Map<string, string>();
  get = jest.fn(async (key: string) => this.values.get(key) ?? null);
  set = jest.fn(async (key: string, value: string) => {
    this.values.set(key, value);
    return 'OK';
  });
  eval = jest.fn(
    async (
      _script: string,
      options: { keys: string[]; arguments: string[] },
    ): Promise<unknown> => {
      const { keys, arguments: args } = options;
      if (keys.length === 3 && this.values.has(keys[2])) return 0;
      const count = Number(this.values.get(keys[0]) ?? 0);
      if (count >= Number(args[0])) return -1;
      if (keys.length === 3) {
        const money = Number(this.values.get(keys[1]) ?? 0);
        if (money + Number(args[1]) > Number(args[2])) return -2;
        this.values.set(keys[1], String(money + Number(args[1])));
        this.values.set(keys[2], 'starting');
      }
      this.values.set(keys[0], String(count + 1));
      return keys.length === 1 ? count + 1 : 1;
    },
  );
}

describe('Free-first social research connectors', () => {
  let fetcher: jest.SpyInstance;
  let prior: Record<string, string | undefined>;
  beforeEach(() => {
    prior = Object.fromEntries(
      Object.entries(process.env).filter(([name]) =>
        name.startsWith('RESEARCH_'),
      ),
    );
    for (const name of Object.keys(process.env))
      if (name.startsWith('RESEARCH_')) delete process.env[name];
    fetcher = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetcher.mockRestore();
    for (const name of Object.keys(process.env))
      if (name.startsWith('RESEARCH_')) delete process.env[name];
    Object.assign(process.env, prior);
  });
  const configureApify = (source = 'facebook', override: unknown = task) => {
    process.env.RESEARCH_PUBLIC_SOCIAL_RSS_ENABLED = 'false';
    process.env.RESEARCH_APIFY_ENABLED = 'true';
    process.env.RESEARCH_APIFY_API_TOKEN = token;
    process.env.RESEARCH_APIFY_TASKS = JSON.stringify({ [source]: override });
  };
  const successfulApify = (rows: unknown[] = [post]) =>
    fetcher
      .mockResolvedValueOnce(json(apifyResponse))
      .mockResolvedValueOnce(json(apifyResponse))
      .mockResolvedValueOnce(json(rows));

  it('enables public Google News without a key and keeps credit-based platforms disabled', () => {
    const statuses = researchSourceStatus();
    expect(statuses.filter((x) => x.ready).map((x) => x.id)).toEqual([
      'facebook',
      'instagram',
      'google',
      'tiktok',
      'tat',
      'osm',
    ]);
    expect(socialSourceStatus('google')).toMatchObject({
      provider: 'google-news-rss',
      costMode: 'free',
      ready: true,
    });
    expect(socialSourceStatus('youtube')).toMatchObject({
      provider: 'youtube-api',
      costMode: 'free-quota',
      ready: false,
    });
    configureApify();
    process.env.RESEARCH_APIFY_ENABLED = 'false';
    expect(socialSourceStatus('facebook').ready).toBe(false);
  });
  it('reads real RSS fields, publication dates and escaped title characters, without reading article HTML', async () => {
    fetcher.mockResolvedValueOnce(new Response(newsXml(), { status: 200 }));
    const result = await new ResearchSocialService().collect(
      'google',
      scope,
      randomUUID(),
    );
    expect(result.items[0]).toMatchObject({
      name: 'ชีส & ร้านอาหาร',
      url: 'https://news.google.com/rss/articles/abc',
      publishedAt: expect.any(String),
    });
    expect(result.limitations.join(' ')).toContain(
      'ไม่ได้อ่านเนื้อหาบทความเต็ม',
    );
    const [url, init] = fetcher.mock.calls[0];
    expect(url.origin).toBe('https://news.google.com');
    expect(url.searchParams.get('q')).toContain('when:30d');
    expect(init.redirect).toBe('error');
  });
  it.each(['facebook', 'instagram', 'tiktok'] as const)(
    'reads only indexed public %s titles without platform credentials',
    async (source) => {
      fetcher.mockResolvedValueOnce(
        new Response(
          newsXml().replace('https://example.com', `https://www.${source}.com`),
          { status: 200 },
        ),
      );
      const result = await new ResearchSocialService().collect(
        source,
        scope,
        randomUUID(),
      );
      expect(result.source).toBe(source);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].detail).toContain('ดัชนี Google News');
      expect(result.via).toContain('API');
      expect(fetcher.mock.calls[0][0].searchParams.get('q')).toContain(
        `site:${source}.com`,
      );
    },
  );
  it('does not mislabel a news publisher as an indexed social platform', async () => {
    fetcher.mockResolvedValueOnce(new Response(newsXml(), { status: 200 }));
    const result = await new ResearchSocialService().collect(
      'facebook',
      scope,
      randomUUID(),
    );
    expect(result.items).toEqual([]);
  });
  it('caches and coalesces RSS requests across different research runs', async () => {
    fetcher.mockResolvedValue(new Response(newsXml(), { status: 200 }));
    const service = new ResearchSocialService();
    const [a, b] = await Promise.all([
      service.collect('google', scope, randomUUID()),
      service.collect('google', scope, randomUUID()),
    ]);
    expect(a).toEqual(b);
    await service.collect('google', scope, randomUUID());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('filters invalid citations, undated and old news; a valid empty feed is searched with zero records', async () => {
    fetcher.mockResolvedValue(
      new Response(
        newsXml('https://evil.example/article') +
          newsXml(
            'https://news.google.com/rss/articles/old',
            'เก่า',
            'Tue, 01 Jan 2019 00:00:00 GMT',
          ),
      ),
    );
    const result = await new ResearchSocialService().collect(
      'google',
      scope,
      randomUUID(),
    );
    expect(result.items).toEqual([]);
  });
  it.each([
    '<!DOCTYPE rss [<!ENTITY bad "x">]><rss/>',
    '<html>wrong format</html>',
    'x'.repeat(1_000_001),
  ])('rejects unsafe, unsupported or oversized RSS', async (xml) => {
    fetcher.mockResolvedValue(new Response(xml));
    await expect(
      new ResearchSocialService().collect('google', scope, randomUUID()),
    ).rejects.toThrow();
  });
  it('requires YouTube credentials and Redis quota storage without calling a provider', async () => {
    await expect(
      new ResearchSocialService(new Redis()).collect(
        'youtube',
        scope,
        randomUUID(),
      ),
    ).rejects.toThrow('ตั้งค่าไม่ครบ');
    process.env.RESEARCH_YOUTUBE_API_KEYS = key;
    await expect(
      new ResearchSocialService().collect('youtube', scope, randomUUID()),
    ).rejects.toThrow('Redis');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses multiple YouTube keys with at most two attempts and counts failures toward the daily limit', async () => {
    process.env.RESEARCH_YOUTUBE_API_KEYS =
      key + ',second_youtube_fake_key_123456';
    fetcher.mockResolvedValueOnce(json({}, 403)).mockResolvedValueOnce(
      json({
        items: [
          {
            id: { videoId: 'aBcDeFgHi12' },
            snippet: {
              title: 'เมนูชีส',
              channelTitle: 'ครัวไทย',
              description: 'ข้อมูลจริงจาก API',
              publishedAt: new Date().toISOString(),
            },
          },
        ],
      }),
    );
    const redis = new Redis();
    const result = await new ResearchSocialService(redis).collect(
      'youtube',
      scope,
      randomUUID(),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].url).toBe(
      'https://www.youtube.com/watch?v=aBcDeFgHi12',
    );
    expect(fetcher.mock.calls[1][1].headers['x-goog-api-key']).toBe(
      'second_youtube_fake_key_123456',
    );
    expect(fetcher.mock.calls[0][0].searchParams.has('key')).toBe(false);
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });
  it('rotates through all configured YouTube keys across different uncached queries', async () => {
    const keys = [
      key,
      'second_youtube_fake_key_123456',
      'third_youtube_fake_key_123456',
    ];
    process.env.RESEARCH_YOUTUBE_API_KEYS = keys.join(',');
    fetcher.mockImplementation(async () => json({ items: [] }));
    const service = new ResearchSocialService(new Redis());
    for (let i = 0; i < keys.length; i++)
      await service.collect(
        'youtube',
        { ...scope, title: 'query' + i },
        randomUUID(),
      );
    expect(
      fetcher.mock.calls.map(([, init]) => init.headers['x-goog-api-key']),
    ).toEqual(keys);
  });
  it('stops at the YouTube company limit without bypassing it with another key', async () => {
    process.env.RESEARCH_YOUTUBE_API_KEYS =
      key + ',second_youtube_fake_key_123456';
    process.env.RESEARCH_YOUTUBE_DAILY_CALL_LIMIT = '1';
    fetcher.mockResolvedValue(json({}, 403));
    await expect(
      new ResearchSocialService(new Redis()).collect(
        'youtube',
        scope,
        randomUUID(),
      ),
    ).rejects.toThrow('ต่อวัน');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('allows a zero company limit to disable requests and rejects invalid budgets before any HTTP call', async () => {
    process.env.RESEARCH_YOUTUBE_API_KEYS = key;
    process.env.RESEARCH_YOUTUBE_DAILY_CALL_LIMIT = '0';
    await expect(
      new ResearchSocialService(new Redis()).collect(
        'youtube',
        scope,
        randomUUID(),
      ),
    ).rejects.toThrow('ต่อวัน');
    process.env.RESEARCH_YOUTUBE_DAILY_CALL_LIMIT = '-1';
    await expect(
      new ResearchSocialService(new Redis()).collect(
        'youtube',
        scope,
        randomUUID(),
      ),
    ).rejects.toThrow('ไม่ถูกต้อง');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never starts Apify when its explicit switch is off, even when credentials exist', async () => {
    configureApify();
    delete process.env.RESEARCH_APIFY_ENABLED;
    await expect(
      new ResearchSocialService(new Redis()).collect(
        'facebook',
        scope,
        randomUUID(),
      ),
    ).rejects.toThrow('ตั้งค่าไม่ครบ');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('renders typed task input, reserves a bounded cost before starting, and maps only actual platform evidence', async () => {
    configureApify();
    successfulApify([
      post,
      post,
      { ...post, url: 'https://facebook.com.evil.example/a' },
    ]);
    const redis = new Redis();
    const result = await new ResearchSocialService(redis).collect(
      'facebook',
      scope,
      randomUUID(),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: post.name,
      publishedAt: post.date,
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url.origin).toBe('https://api.apify.com');
    expect(url.searchParams.get('maxTotalChargeUsd')).toBe('0.05');
    expect(url.searchParams.get('maxItems')).toBe('10');
    expect(url.searchParams.get('timeout')).toBe('90');
    expect(JSON.parse(init.body)).toMatchObject({
      searchQueries: ['วัตถุดิบอาหาร กรุงเทพมหานคร'],
      maxItems: 10,
    });
    expect(init.headers.Authorization).toBe('Bearer ' + token);
    expect(redis.eval.mock.invocationCallOrder[0]).toBeLessThan(
      fetcher.mock.invocationCallOrder[0],
    );
  });
  it.each(['instagram', 'tiktok'] as const)(
    'supports configured %s Tasks and enforces the source citation host',
    async (source) => {
      configureApify(source);
      successfulApify([
        {
          ...post,
          url:
            source === 'instagram'
              ? 'https://www.instagram.com/p/abc/'
              : 'https://www.tiktok.com/@chef/video/123',
        },
      ]);
      expect(
        (
          await new ResearchSocialService(new Redis()).collect(
            source,
            scope,
            randomUUID(),
          )
        ).items,
      ).toHaveLength(1);
    },
  );
  it('supports a Google search Task with nested organic results only when the free news collector is disabled', async () => {
    process.env.RESEARCH_GOOGLE_NEWS_ENABLED = 'false';
    configureApify('google', {
      ...task,
      itemsPath: 'organicResults',
    } as typeof task);
    successfulApify([
      { organicResults: [{ ...post, url: 'https://example.com/article' }] },
    ]);
    expect(
      (
        await new ResearchSocialService(new Redis()).collect(
          'google',
          scope,
          randomUUID(),
        )
      ).items[0].url,
    ).toBe('https://example.com/article');
  });
  it('keeps the free Google collector selected when Apify is configured', async () => {
    configureApify('google');
    fetcher.mockResolvedValue(new Response(newsXml()));
    await new ResearchSocialService(new Redis()).collect(
      'google',
      scope,
      randomUUID(),
    );
    expect(fetcher.mock.calls[0][0].hostname).toBe('news.google.com');
  });
  it.each([
    { ...task, input: { search: 'fixed query unrelated to a topic' } },
    { ...task, input: { q: '{{unknown}} {{query}}' } },
    { ...task, fields: { url: '__proto__.url', text: 'text' } },
    { ...task, input: { q: '{{query}}', cookies: [] } },
    { ...task, taskId: '../bad' },
  ])('rejects unsupported or unsafe task configuration', (invalid) => {
    configureApify('facebook', invalid);
    expect(apifyTask('facebook')).toBeNull();
    expect(socialSourceStatus('facebook').ready).toBe(false);
  });
  it('never returns raw provider errors, secrets or unusable URLs', async () => {
    configureApify();
    successfulApify([
      { ...post, text: 'message ' + token },
      { ...post, url: 'https://www.facebook.com/p?access_token=' + token },
      { ...post, url: 'javascript:alert(1)' },
    ]);
    const result = await new ResearchSocialService(new Redis()).collect(
      'facebook',
      scope,
      randomUUID(),
    );
    expect(result.items).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(researchSourceStatus())).not.toContain(token);
  });
  it('fails closed when Redis cannot reserve a run or a counter returns an unexpected result', async () => {
    configureApify();
    const redis = new Redis();
    redis.eval.mockRejectedValueOnce(new Error('redis secret error'));
    await expect(
      new ResearchSocialService(redis).collect('facebook', scope, randomUUID()),
    ).rejects.toThrow('ควบคุม quota');
    redis.eval.mockResolvedValueOnce(undefined);
    await expect(
      new ResearchSocialService(redis).collect('facebook', scope, randomUUID()),
    ).rejects.toThrow('ควบคุม quota');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not start another paid Actor after a lost POST response for the same research run', async () => {
    configureApify();
    const redis = new Redis();
    const id = randomUUID();
    fetcher.mockRejectedValueOnce(new Error('network failed with ' + token));
    await expect(
      new ResearchSocialService(redis).collect('facebook', scope, id),
    ).rejects.toThrow('หมดเวลา');
    await expect(
      new ResearchSocialService(redis).collect('facebook', scope, id),
    ).rejects.toThrow('ไม่เริ่มงาน');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('resumes a known remote run after an interrupted worker without starting another Actor', async () => {
    configureApify();
    const redis = new Redis();
    const id = randomUUID();
    fetcher
      .mockResolvedValueOnce(json(apifyResponse))
      .mockRejectedValueOnce(new Error('lost GET'));
    await expect(
      new ResearchSocialService(redis).collect('facebook', scope, id),
    ).rejects.toThrow();
    fetcher
      .mockResolvedValueOnce(json(apifyResponse))
      .mockResolvedValueOnce(json([post]));
    expect(
      (await new ResearchSocialService(redis).collect('facebook', scope, id))
        .items,
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter((x) => x[1]?.method === 'POST'),
    ).toHaveLength(1);
  });
  it('enforces the monthly reserved cost cap before creating a run', async () => {
    configureApify();
    process.env.RESEARCH_APIFY_MONTHLY_BUDGET_USD = '0.04';
    await expect(
      new ResearchSocialService(new Redis()).collect(
        'facebook',
        scope,
        randomUUID(),
      ),
    ).rejects.toThrow('ต่อเดือน');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires a SUCCEEDED run from the exact Task and rejects malformed dataset mappings', async () => {
    configureApify();
    fetcher
      .mockResolvedValueOnce(json(apifyResponse))
      .mockResolvedValueOnce(
        json({ data: { ...apifyResponse.data, actorTaskId: 'other' } }),
      );
    await expect(
      new ResearchSocialService(new Redis()).collect(
        'facebook',
        scope,
        randomUUID(),
      ),
    ).rejects.toThrow('ไม่ตรง');
    successfulApify([{ other: 'shape' }]);
    await expect(
      new ResearchSocialService(new Redis()).collect(
        'facebook',
        scope,
        randomUUID(),
      ),
    ).rejects.toThrow('field mapping');
  });
});
