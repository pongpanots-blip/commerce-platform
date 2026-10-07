import { randomUUID } from 'node:crypto';
import {
  ResearchCatalogService,
  CatalogUnavailable,
  TAT_PACKAGE,
  OSM_ENDPOINT,
} from './research-catalog.service';
import { MarketingResearchService } from './marketing-research.service';
import { ResearchFreeWorker } from './research-free.worker';
import { ResearchSocialService } from './research-social.service';
import {
  freeResearchEnabled,
  researchSourceStatus,
  type ResearchScope,
} from '../research.types';

const scope: ResearchScope = {
  title: 'รายชื่อร้านอาหาร',
  kind: 'sales',
  area: 'กรุงเทพมหานคร',
  sector: 'ทุกกลุ่ม · น้ำหนักเท่ากัน',
  days: 30,
  sources: ['tat', 'osm', 'facebook'],
};
const datasetUrl =
  'https://datacatalog.tat.or.th/dataset/6d8193a1-7187-4625-a22d-504ab69b427d/resource/53af01a0-9ef5-459a-88c1-befe4690b1f2/download/restaurant.json';
const metadata = (url = datasetUrl) => ({
  success: true,
  result: {
    metadata_modified: '2026-06-12T03:55:17',
    resources: [{ format: 'JSON', url }],
  },
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

describe('Free Research real-data collectors', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());
  it('loads the TAT dataset, filters the actual province, deduplicates IDs and shares its daily cache', async () => {
    const rows = [
      {
        PLACE_ID: 'a',
        PLACE_NAME_TH: 'ร้าน ก',
        PROVINCE_NAME_TH: 'กรุงเทพมหานคร',
        PLACE_ADDRESS: 'สีลม',
      },
      {
        PLACE_ID: 'a',
        PLACE_NAME_TH: 'duplicate',
        PROVINCE_NAME_TH: 'กรุงเทพมหานคร',
      },
      { PLACE_ID: 'b', PLACE_NAME_TH: 'ร้าน ข', PROVINCE_NAME_TH: 'นนทบุรี' },
      { PLACE_ID: 'c', PLACE_NAME_TH: 'ร้าน ค', PROVINCE_NAME_TH: 'ภูเก็ต' },
    ];
    fetchMock
      .mockResolvedValueOnce(json(metadata()))
      .mockResolvedValueOnce(json({ query: rows }));
    const collector = new ResearchCatalogService();
    const [bangkok, metro] = await Promise.all([
      collector.collect('tat', scope),
      collector.collect('tat', { ...scope, area: 'กรุงเทพฯ และปริมณฑล' }),
    ]);
    expect(bangkok.groups).toEqual([{ label: 'ร้านอาหาร', count: 1 }]);
    expect(bangkok.items[0]).toMatchObject({
      id: 'a',
      name: 'ร้าน ก',
      url: `${datasetUrl}#a`,
    });
    expect(metro.groups[0].count).toBe(2);
    expect(bangkok.limitations.join(' ')).toContain('2026-06-12');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(TAT_PACKAGE);
  });
  it('does not follow a provider metadata URL to an arbitrary/private host', async () => {
    fetchMock.mockResolvedValue(json(metadata('http://127.0.0.1/private')));
    await expect(
      new ResearchCatalogService().collect('tat', scope),
    ).rejects.toBeInstanceOf(CatalogUnavailable);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects ambiguous dataset schemas instead of selecting an unrelated array', async () => {
    fetchMock
      .mockResolvedValueOnce(json(metadata()))
      .mockResolvedValueOnce(json({ a: [], b: [] }));
    await expect(
      new ResearchCatalogService().collect('tat', scope),
    ).rejects.toThrow('รูปแบบรายชื่อ');
  });
  it('reports unsupported TAT sectors without issuing a vendor call', async () => {
    await expect(
      new ResearchCatalogService().collect('tat', {
        ...scope,
        sector: 'โรงงานอาหาร',
      }),
    ).rejects.toThrow('ไม่ครอบคลุม');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('caps metadata response bytes and fails rather than accepting oversized data', async () => {
    fetchMock.mockResolvedValue(new Response(' '.repeat(2_000_001)));
    await expect(
      new ResearchCatalogService().collect('tat', scope),
    ).rejects.toThrow('เกินขนาด');
  });
  it('uses a fixed OSM provider and selected geographical bounds; question text cannot become query code', async () => {
    fetchMock.mockResolvedValue(
      json({
        elements: [
          { type: 'count', tags: { total: '1' } },
          { type: 'count', tags: { total: '25' } },
          {
            type: 'node',
            id: 12,
            tags: { name: 'ร้าน ก', amenity: 'restaurant' },
          },
        ],
      }),
    );
    const result = await new ResearchCatalogService().collect('osm', {
      ...scope,
      sector: 'ร้านอาหาร',
      title: 'arbitrary-question-code',
    });
    const request = new URL(fetchMock.mock.calls[0][0]);
    expect(`${request.origin}${request.pathname}`).toBe(OSM_ENDPOINT);
    expect(request.searchParams.get('data')).toContain('TH-10');
    expect(request.searchParams.get('data')).not.toContain(
      'arbitrary-question-code',
    );
    expect(result.groups[0].count).toBe(25);
    expect(result.items[0].url).toBe('https://www.openstreetmap.org/node/12');
  });
  it.each([
    { remark: 'timeout', elements: [] },
    {
      elements: [
        { type: 'count', tags: { total: '0' } },
        { type: 'count', tags: { total: '0' } },
      ],
    },
  ])(
    'does not turn an incomplete OSM response into a zero-result success',
    async (payload) => {
      fetchMock.mockResolvedValue(json(payload));
      await expect(
        new ResearchCatalogService().collect('osm', {
          ...scope,
          sector: 'ร้านอาหาร',
        }),
      ).rejects.toBeInstanceOf(CatalogUnavailable);
    },
  );
  it('backs off after rate limiting, rather than repeating calls for every waiting topic', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));
    const collector = new ResearchCatalogService();
    await expect(collector.collect('osm', scope)).rejects.toThrow('429');
    await expect(collector.collect('osm', scope)).rejects.toThrow('429');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Free Research worker lifecycle', () => {
  const prior = process.env.RESEARCH_FREE_WORKER_ENABLED;
  beforeEach(() => {
    delete process.env.RESEARCH_FREE_WORKER_ENABLED;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.RESEARCH_FREE_WORKER_ENABLED;
    else process.env.RESEARCH_FREE_WORKER_ENABLED = prior;
  });
  const setup = () => {
    const run = {
      id: randomUUID(),
      leaseToken: randomUUID(),
      scope,
      availableSources: ['tat', 'osm'],
    };
    const service = {
      claim: jest.fn().mockResolvedValueOnce(run).mockResolvedValue(null),
      finish: jest.fn(),
      fail: jest.fn(),
    };
    const catalogs = {
      collect: jest.fn().mockResolvedValue({
        source: 'tat',
        observedAt: '2026-10-03T11:00:00Z',
        groups: [{ label: 'ร้านอาหาร', count: 1 }],
        items: [
          {
            id: 'a',
            name: 'ร้าน ก',
            detail: 'ร้าน ก · สีลม',
            url: `${datasetUrl}#a`,
          },
        ],
        limitations: ['dataset snapshot only'],
      }),
    };
    const worker = new ResearchFreeWorker(
      service as unknown as MarketingResearchService,
      catalogs as unknown as ResearchCatalogService,
    );
    return { run, service, catalogs, worker };
  };
  it('claims only supported queued work and saves actual cited records with missing-source coverage', async () => {
    const { worker, service, catalogs, run } = setup();
    catalogs.collect.mockRejectedValueOnce(
      new CatalogUnavailable('ททท. ไม่ตอบ'),
    );
    await worker.tick();
    expect(service.claim).toHaveBeenCalledWith(expect.any(Date), [
      'tat',
      'osm',
    ]);
    const [id, report] = service.finish.mock.calls[0];
    expect(id).toBe(run.id);
    expect(report.leaseToken).toBe(run.leaseToken);
    expect(report.coverage).toEqual([
      { source: 'tat', status: 'unavailable', reason: 'ททท. ไม่ตอบ' },
      {
        source: 'osm',
        status: 'searched',
        from: '2026-10-03T11:00:00Z',
        to: '2026-10-03T11:00:00Z',
      },
      { source: 'facebook', status: 'unavailable', reason: expect.any(String) },
    ]);
    expect(report.findings[0].evidenceIds).toEqual([report.evidence[0].id]);
    expect(report.limitations.join(' ')).toContain('ไม่ยืนยันความต้องการซื้อ');
    expect(service.fail).not.toHaveBeenCalled();
  });
  it('fails without inventing a report when no provider returns usable data', async () => {
    const { worker, service, catalogs, run } = setup();
    catalogs.collect.mockRejectedValue(
      new CatalogUnavailable('source unavailable'),
    );
    await worker.tick();
    expect(service.fail).toHaveBeenCalledWith(
      run.id,
      run.leaseToken,
      expect.stringContaining('source unavailable'),
    );
    expect(service.finish).not.toHaveBeenCalled();
  });
  it('does not start overlapping local consumers', async () => {
    const { worker, service, catalogs } = setup();
    let resume!: () => void;
    catalogs.collect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resume = () =>
            resolve({
              observedAt: new Date().toISOString(),
              groups: [],
              items: [],
              limitations: [],
            });
        }),
    );
    const pending = worker.tick();
    await Promise.resolve();
    await worker.tick();
    expect(service.claim).toHaveBeenCalledTimes(1);
    resume();
    await pending;
  });
  it('can disable the built-in worker without weakening the external-worker HTTP guard', async () => {
    process.env.RESEARCH_FREE_WORKER_ENABLED = 'false';
    const { worker, service } = setup();
    await worker.tick();
    expect(freeResearchEnabled()).toBe(false);
    expect(service.claim).not.toHaveBeenCalled();
    delete process.env.RESEARCH_FREE_WORKER_ENABLED;
    expect(
      researchSourceStatus()
        .filter((source) => source.ready)
        .map((source) => source.id),
    ).toEqual(['facebook', 'instagram', 'google', 'tiktok', 'tat', 'osm']);
  });
  it('collects a Google-only content run even when the business-directory worker is disabled', async () => {
    process.env.RESEARCH_FREE_WORKER_ENABLED = 'false';
    const { service, catalogs, run } = setup();
    run.availableSources = ['google'];
    Object.assign(run, {
      scope: { ...scope, kind: 'content', sources: ['google'] },
    });
    const publishedAt = new Date().toISOString();
    const social = {
      collect: jest
        .fn()
        .mockResolvedValue({
          source: 'google',
          observedAt: publishedAt,
          groups: [{ label: 'ชื่อข่าว', count: 1 }],
          items: [
            {
              id: 'news1',
              name: 'หัวข้อข่าว',
              detail: 'หัวข้อข่าว · สำนักข่าว',
              url: 'https://news.google.com/rss/articles/abc',
              publishedAt,
            },
          ],
          limitations: ['ชื่อข่าวเท่านั้น'],
        }),
    };
    const worker = new ResearchFreeWorker(
      service as unknown as MarketingResearchService,
      catalogs as unknown as ResearchCatalogService,
      social as unknown as ResearchSocialService,
    );
    await worker.tick();
    expect(service.claim).toHaveBeenCalledWith(expect.any(Date), [
      'facebook',
      'instagram',
      'google',
      'tiktok',
    ]);
    expect(social.collect).toHaveBeenCalledWith(
      'google',
      expect.objectContaining({ kind: 'content' }),
      run.id,
    );
    expect(service.finish.mock.calls[0][1].evidence[0]).toMatchObject({
      source: 'google',
      publishedAt,
    });
    expect(service.finish.mock.calls[0][1].coverage).toEqual([
      {
        source: 'google',
        status: 'searched',
        from: publishedAt,
        to: publishedAt,
      },
    ]);
    expect(catalogs.collect).not.toHaveBeenCalled();
  });
});
