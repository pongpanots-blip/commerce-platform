import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ResearchScope, ResearchSource } from '../research.types';

export const TAT_PACKAGE =
  'https://datacatalog.tat.or.th/api/3/action/package_show?id=restaurant';
export const OSM_ENDPOINT = 'https://overpass.private.coffee/api/interpreter';
const TAT_PAGE = 'https://datacatalog.tat.or.th/dataset/restaurant';
const HOUR = 3_600_000;
const GROUPS = [
  {
    label: 'ร้านอาหาร',
    selector: '["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]',
  },
  {
    label: 'โรงแรม / จัดเลี้ยง',
    selector: '["tourism"~"^(hotel|guest_house|hostel|motel)$"]',
  },
  {
    label: 'ร้านค้าปลีก',
    selector:
      '["shop"~"^(supermarket|convenience|butcher|bakery|seafood|deli|greengrocer)$"]',
  },
  {
    label: 'โรงงานอาหาร',
    selector: '["industrial"~"^(food|bakery|brewery|dairy)$"]',
  },
] as const;
const METRO = new Set([
  'กรุงเทพมหานคร',
  'นนทบุรี',
  'ปทุมธานี',
  'สมุทรปราการ',
  'นครปฐม',
  'สมุทรสาคร',
]);
type Row = Record<string, unknown>;
export type CatalogItem = {
  id: string;
  name: string;
  detail: string;
  url: string;
  publishedAt?: string;
};
export type CatalogResult = {
  via?: string;
  source: ResearchSource;
  observedAt: string;
  url: string;
  groups: Array<{ label: string; count: number }>;
  items: CatalogItem[];
  limitations: string[];
};
type TatItem = { id: string; name: string; province: string; detail: string };
type TatDataset = {
  observedAt: string;
  modified: string;
  url: string;
  items: TatItem[];
};
type Cached<T> = { expiresAt: number; data: T };
interface RedisCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
}
export class CatalogUnavailable extends Error {}
const record = (value: unknown): Row | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : null;
const text = (value: unknown, limit = 300) =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f]/g, ' ')
        .trim()
        .slice(0, limit)
    : '';

/** Only fixed, public provider hosts are contacted; questions never become URLs or query code. */
@Injectable()
export class ResearchCatalogService {
  private readonly memory = new Map<string, Cached<unknown>>();
  private readonly flights = new Map<string, Promise<unknown>>();
  private readonly failures = new Map<
    string,
    { until: number; reason: string }
  >();
  constructor(
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: RedisCache,
  ) {}

  async collect(
    source: 'tat' | 'osm',
    scope: ResearchScope,
  ): Promise<CatalogResult> {
    switch (source) {
      case 'tat':
        return this.tat(scope);
      case 'osm':
        return this.cached(`osm:${scope.area}:${scope.sector}`, HOUR, () =>
          this.osm(scope),
        );
    }
  }

  private async cached<T>(
    key: string,
    ttl: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const failure = this.failures.get(key);
    if (failure && failure.until > Date.now())
      throw new CatalogUnavailable(failure.reason);
    const cached = this.memory.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data as T;
    const existing = this.flights.get(key);
    if (existing) return existing as Promise<T>;
    const work = (async () => {
      const redisKey = `marketing-research:free:v1:${key}`;
      try {
        const raw = await this.redis?.get(redisKey);
        if (raw) {
          const saved = JSON.parse(raw) as Cached<T>;
          if (
            Number.isFinite(saved.expiresAt) &&
            saved.expiresAt > Date.now() &&
            saved.data
          ) {
            this.remember(key, saved);
            return saved.data;
          }
        }
      } catch {
        /* A cache outage must not become fabricated search results. */
      }
      const data = await load();
      const saved = { expiresAt: Date.now() + ttl, data };
      this.remember(key, saved);
      try {
        await this.redis?.set(redisKey, JSON.stringify(saved), {
          EX: Math.ceil(ttl / 1000),
        });
      } catch {
        /* bounded process cache remains available */
      }
      return data;
    })();
    this.flights.set(key, work);
    try {
      return await work;
    } catch (error) {
      const reason =
        error instanceof CatalogUnavailable
          ? error.message
          : 'แหล่งข้อมูลไม่ตอบ กรุณาลองใหม่ภายหลัง';
      if (this.failures.size >= 20) this.failures.clear();
      this.failures.set(key, { until: Date.now() + 5 * 60_000, reason });
      throw new CatalogUnavailable(reason);
    } finally {
      this.flights.delete(key);
    }
  }
  private remember(key: string, value: Cached<unknown>) {
    if (this.memory.size >= 20 && !this.memory.has(key))
      this.memory.delete(this.memory.keys().next().value!);
    this.memory.set(key, value);
  }

  private async json(
    url: string,
    maxBytes: number,
    timeoutMs: number,
  ): Promise<unknown> {
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'JoshMarketingResearch/1.0 (+https://joshapp.io)',
      },
    });
    if (!response.ok || !response.body)
      throw new CatalogUnavailable(
        `แหล่งข้อมูลตอบ HTTP ${response.status} กรุณาลองใหม่ภายหลัง`,
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maxBytes)
          throw new CatalogUnavailable(
            'ข้อมูลเกินขนาดที่รองรับ กรุณาตรวจแหล่งข้อมูล',
          );
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof CatalogUnavailable) throw error;
      throw new CatalogUnavailable(
        'อ่านข้อมูลจากแหล่งนี้ไม่สำเร็จ รูปแบบข้อมูลอาจเปลี่ยนหรือหมดเวลารอ',
      );
    } finally {
      reader.releaseLock();
    }
  }

  private async loadTat(): Promise<TatDataset> {
    const root = record(await this.json(TAT_PACKAGE, 2_000_000, 30_000));
    const info = record(root?.result);
    const resources = info?.resources;
    if (root?.success !== true || !Array.isArray(resources))
      throw new CatalogUnavailable('ททท. ไม่ส่งรายการทรัพยากรที่รองรับ');
    const resource = resources
      .map(record)
      .find((item) => item?.format === 'JSON');
    const url = text(resource?.url, 2000);
    // CKAN metadata is untrusted: no redirects, private hosts, arbitrary URLs or user-provided origins.
    if (
      !/^https:\/\/datacatalog\.tat\.or\.th\/dataset\/[a-z0-9-]+\/resource\/[a-z0-9-]+\/download\/restaurant\.json$/.test(
        url,
      )
    )
      throw new CatalogUnavailable(
        'URL ชุดข้อมูล ททท. เปลี่ยน ต้องตรวจการเชื่อมต่อก่อน',
      );
    const payload = await this.json(url, 64_000_000, 45_000);
    const object = record(payload);
    const arrays = Array.isArray(payload)
      ? [payload]
      : object
        ? Object.values(object).filter(Array.isArray)
        : [];
    if (arrays.length !== 1 || arrays[0].length > 50_000)
      throw new CatalogUnavailable(
        'รูปแบบรายชื่อ ททท. เปลี่ยน ต้องตรวจการเชื่อมต่อก่อน',
      );
    const seen = new Set<string>();
    const items: TatItem[] = [];
    for (const value of arrays[0]) {
      const row = record(value);
      const id = text(row?.PLACE_ID, 80);
      const name = text(row?.PLACE_NAME_TH) || text(row?.PLACE_NAME_EN);
      const province = text(row?.PROVINCE_NAME_TH, 100);
      if (!id || !name || !province || seen.has(id)) continue;
      seen.add(id);
      const detail = [
        name,
        text(row?.PLACE_ADDRESS),
        text(row?.DISTRICT_NAME_TH),
        province,
        text(row?.FOOD_TYPE_LABEL),
        text(row?.PLACE_PHONE, 100),
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 1800);
      items.push({ id, name, province, detail });
    }
    if (arrays[0].length && !items.length)
      throw new CatalogUnavailable('ททท. ไม่มีฟิลด์รายชื่อที่รองรับ');
    return {
      items,
      url,
      observedAt: new Date().toISOString(),
      modified: text(info?.metadata_modified, 80),
    };
  }

  private async tat(scope: ResearchScope): Promise<CatalogResult> {
    if (!['ร้านอาหาร', 'ทุกกลุ่ม · น้ำหนักเท่ากัน'].includes(scope.sector))
      throw new CatalogUnavailable(
        'ชุดข้อมูล ททท. นี้มีเฉพาะร้านอาหาร ไม่ครอบคลุมกลุ่มลูกค้าที่เลือก',
      );
    const data = await this.cached('tat', 24 * HOUR, () => this.loadTat());
    const selected = data.items.filter((item) => {
      switch (scope.area) {
        case 'กรุงเทพมหานคร':
          return item.province === 'กรุงเทพมหานคร';
        case 'กรุงเทพฯ และปริมณฑล':
          return METRO.has(item.province);
        case 'ทั่วประเทศไทย':
          return true;
        default:
          throw new CatalogUnavailable('พื้นที่นี้ยังไม่รองรับ');
      }
    });
    return {
      source: 'tat',
      observedAt: data.observedAt,
      url: data.url,
      groups: [{ label: 'ร้านอาหาร', count: selected.length }],
      items: selected.slice(0, 10).map((item) => ({
        id: item.id,
        name: item.name,
        detail: `${item.detail} · PLACE_ID ${item.id}`,
        url: `${data.url}#${encodeURIComponent(item.id)}`,
      })),
      limitations: [
        `ททท. มีเฉพาะรายชื่อร้านอาหาร ชุดข้อมูลระบุวันปรับปรุง ${data.modified || 'ไม่ทราบ'} ไม่ใช่ข้อมูลเหตุการณ์ย้อนหลัง ${scope.days} วัน`,
        'แสดงตัวอย่างไม่เกิน 10 รายการจากชุดข้อมูล ไม่ใช่การจัดอันดับความต้องการซื้อ',
        `อ้างอิงชุดข้อมูล ททท.: ${TAT_PAGE}`,
      ],
    };
  }

  private async osm(scope: ResearchScope): Promise<CatalogResult> {
    let area: string;
    switch (scope.area) {
      case 'กรุงเทพมหานคร':
        area = 'area["ISO3166-2"="TH-10"]';
        break;
      case 'กรุงเทพฯ และปริมณฑล':
        area = 'area["ISO3166-2"~"^TH-(10|11|12|13|73|74)$"]';
        break;
      case 'ทั่วประเทศไทย':
        area = 'area["ISO3166-1"="TH"]["admin_level"="2"]';
        break;
      default:
        throw new CatalogUnavailable('พื้นที่นี้ยังไม่รองรับ');
    }
    const groups = GROUPS.filter(
      (group) =>
        scope.sector === 'ทุกกลุ่ม · น้ำหนักเท่ากัน' ||
        scope.sector === group.label,
    );
    if (!groups.length)
      throw new CatalogUnavailable('กลุ่มลูกค้านี้ยังไม่รองรับ');
    const query =
      `[out:json][timeout:25][maxsize:8000000];${area}->.a;.a out count;` +
      groups
        .map(
          (group) =>
            `nwr${group.selector}(area.a)->.g;.g out count;.g out tags center 10;`,
        )
        .join('');
    const root = record(
      await this.json(
        `${OSM_ENDPOINT}?${new URLSearchParams({ data: query })}`,
        2_000_000,
        35_000,
      ),
    );
    if (!root || root.remark || !Array.isArray(root.elements))
      throw new CatalogUnavailable(
        'OSM ส่งผลค้นไม่ครบหรือหมดเวลา กรุณาลองใหม่',
      );
    const counts = root.elements
      .map(record)
      .filter((item) => item?.type === 'count');
    if (
      counts.length !== groups.length + 1 ||
      Number(record(counts[0]?.tags)?.total) < 1
    )
      throw new CatalogUnavailable('OSM ไม่พบขอบเขตพื้นที่หรือส่งผลค้นไม่ครบ');
    const seen = new Set<string>();
    const items: CatalogItem[] = [];
    for (const value of root.elements) {
      const element = record(value);
      if (
        !element ||
        !['node', 'way', 'relation'].includes(String(element.type)) ||
        !Number.isSafeInteger(element.id)
      )
        continue;
      const tags = record(element.tags);
      const name =
        text(tags?.['name:th']) || text(tags?.name) || text(tags?.['name:en']);
      const id = `${element.type}/${element.id}`;
      if (!name || seen.has(id)) continue;
      seen.add(id);
      const detail = [
        name,
        text(tags?.amenity),
        text(tags?.tourism),
        text(tags?.shop),
        text(tags?.industrial),
        text(tags?.cuisine),
        text(tags?.['addr:street']),
        text(tags?.['addr:district']),
        text(tags?.['contact:phone']) || text(tags?.phone),
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 1800);
      items.push({
        id,
        name,
        detail,
        url: `https://www.openstreetmap.org/${id}`,
      });
    }
    const statistics = groups.map((group, index) => ({
      label: group.label,
      count: Number(record(counts[index + 1]?.tags)?.total),
    }));
    if (
      statistics.some(
        (group) => !Number.isSafeInteger(group.count) || group.count < 0,
      )
    )
      throw new CatalogUnavailable('OSM ส่งจำนวนผลค้นที่ไม่ถูกต้อง');
    return {
      source: 'osm',
      observedAt: new Date().toISOString(),
      url: 'https://www.openstreetmap.org/copyright',
      groups: statistics,
      items,
      limitations: [
        `OSM เป็นฐานสถานที่ตาม tag ปัจจุบัน ไม่ใช่ข่าวหรือข้อมูลความต้องการซื้อย้อนหลัง ${scope.days} วัน`,
        'แสดงตัวอย่างไม่เกิน 10 elements ต่อกลุ่ม อาจมี elements แทนธุรกิจเดียวกัน และ tag อาจไม่ครบ',
        'กลุ่มโรงแรม / จัดเลี้ยงใน OSM รอบนี้ค้น tag ที่พัก ไม่ครอบคลุมกิจการจัดเลี้ยงทั้งหมด',
        'OSM © OpenStreetMap contributors, ODbL — ตรวจรายละเอียดและความสดจากลิงก์หลักฐาน',
      ],
    };
  }
}
