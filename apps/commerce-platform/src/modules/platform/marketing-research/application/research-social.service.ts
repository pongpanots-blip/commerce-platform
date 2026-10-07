import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import {
  CatalogUnavailable,
  type CatalogItem,
  type CatalogResult,
} from './research-catalog.service';
import {
  apifyEnabled,
  apifyTask,
  apifyToken,
  googleNewsEnabled,
  publicSocialRssEnabled,
  SOCIAL_LABELS,
  socialEnabled,
  youtubeKeys,
  type ApifyTask,
  type SocialSource,
} from './research-social.config';
import type { ResearchScope } from '../research.types';

interface ConnectorRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}
type Row = Record<string, unknown>;
const object = (v: unknown): Row | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;
const clean = (v: unknown, max = 1800) =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u001f]/g, ' ')
        .trim()
        .slice(0, max)
    : '';
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const path = (value: unknown, selector: string) =>
  selector.split('.').reduce<unknown>((v, key) => {
    const row = object(v);
    return row && Object.prototype.hasOwnProperty.call(row, key)
      ? row[key]
      : undefined;
  }, value);
const positive = (raw: string | undefined, fallback: number, max: number) => {
  const n = Number(raw === undefined || raw.trim() === '' ? fallback : raw);
  if (!Number.isFinite(n) || n < 0 || n > max)
    throw new CatalogUnavailable(
      'ค่า quota หรืองบไม่ถูกต้อง ให้ผู้ดูแลตรวจ configuration ก่อนค้นข้อมูล',
    );
  return n;
};
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
const DAY = 86_400_000;
const budgetScript = `
local calls = tonumber(redis.call('GET', KEYS[1]) or '0')
if calls >= tonumber(ARGV[1]) then return -1 end
redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 172800)
return calls + 1`;
const apifyBudgetScript = `
if redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
local calls = tonumber(redis.call('GET', KEYS[1]) or '0')
local cents = tonumber(redis.call('GET', KEYS[2]) or '0')
if calls >= tonumber(ARGV[1]) then return -1 end
if cents + tonumber(ARGV[2]) > tonumber(ARGV[3]) then return -2 end
redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 172800)
redis.call('INCRBY', KEYS[2], ARGV[2]); redis.call('EXPIRE', KEYS[2], 2764800)
redis.call('SET', KEYS[3], 'starting', 'EX', 2592000)
return 1`;

/** Fixed provider hosts, bounded datasets, and Redis reservations before any paid Actor starts. */
@Injectable()
export class ResearchSocialService {
  private readonly flights = new Map<string, Promise<CatalogResult>>();
  private readonly freeCache = new Map<
    string,
    { until: number; result: CatalogResult }
  >();
  constructor(
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: ConnectorRedis,
  ) {}

  async collect(
    source: SocialSource,
    scope: ResearchScope,
    researchRunId: string,
  ): Promise<CatalogResult> {
    if (!socialEnabled())
      throw new CatalogUnavailable(
        'social connectors ยังปิดอยู่ ให้ผู้ดูแลเปิดใช้งาน',
      );
    if (!/^[a-f0-9-]{36}$/i.test(researchRunId))
      throw new CatalogUnavailable('รหัสงานค้นข้อมูลไม่ถูกต้อง');
    const indexed =
      ['facebook', 'instagram', 'tiktok'].includes(source) &&
      publicSocialRssEnabled();
    const news = (source === 'google' && googleNewsEnabled()) || indexed;
    const native = news || (source === 'youtube' && youtubeKeys().length > 0);
    const task = native ? null : apifyTask(source);
    if (!native && (!apifyEnabled() || !apifyToken() || !task))
      throw new CatalogUnavailable(
        'แหล่งนี้ยังตั้งค่าไม่ครบ ตรวจ credentials และ Actor Task ในหน้าแหล่งข้อมูล',
      );
    if (!news && !this.redis)
      throw new CatalogUnavailable(
        'ระบบควบคุม quota ยังไม่พร้อม ให้ผู้ดูแลตรวจ Redis ก่อนค้นข้อมูล',
      );
    const cacheKey =
      'research:social:cache:' +
      hash(
        JSON.stringify({
          source,
          scope,
          provider: news ? 'google-news' : native ? 'youtube' : 'apify',
          keys: news ? [] : native ? youtubeKeys() : apifyToken(),
          task,
        }),
      );
    const local = this.freeCache.get(cacheKey);
    if (news && local && local.until > Date.now()) return local.result;
    let cached: string | null = null;
    if (news) {
      try {
        cached = this.redis ? await this.redis.get(cacheKey) : null;
      } catch {
        /* Public RSS has no provider charges; use the bounded local cache. */
      }
    } else cached = await this.redisGet(cacheKey);
    if (cached) {
      try {
        const value: CatalogResult = JSON.parse(cached);
        // Only this collector writes this namespace; stale/foreign shapes are not accepted.
        if (
          value.source === source &&
          Date.parse(value.observedAt) > Date.now() - 3_600_000 &&
          Array.isArray(value.items)
        )
          return value;
      } catch {
        /* Re-fetch an invalid cache entry. */
      }
    }
    const flight = this.flights.get(cacheKey);
    if (flight) return flight;
    const load = (
      news
        ? this.googleNews(scope, source)
        : native
          ? this.youtube(scope)
          : this.apify(source, scope, researchRunId, task!)
    )
      .then(async (result) => {
        if (news) {
          if (this.freeCache.size >= 50)
            this.freeCache.delete(this.freeCache.keys().next().value!);
          this.freeCache.set(cacheKey, {
            until: Date.now() + 3_600_000,
            result,
          });
        }
        try {
          await this.redis?.set(cacheKey, JSON.stringify(result), { EX: 3600 });
        } catch {
          /* The completed report can still be saved. */
        }
        return result;
      })
      .finally(() => this.flights.delete(cacheKey));
    this.flights.set(cacheKey, load);
    return load;
  }

  private async redisGet(key: string) {
    try {
      return await this.redis!.get(key);
    } catch {
      throw new CatalogUnavailable(
        'ระบบควบคุม quota ไม่ตอบ ให้ผู้ดูแลตรวจ Redis แล้วลองใหม่',
      );
    }
  }
  private async reserve(script: string, keys: string[], args: string[]) {
    try {
      const result = await this.redis!.eval(script, { keys, arguments: args });
      if (
        typeof result !== 'number' ||
        !Number.isInteger(result) ||
        (keys.length === 1
          ? result < -1 || result > 1000
          : ![1, 0, -1, -2].includes(result))
      )
        throw new Error('counter');
      return result;
    } catch {
      throw new CatalogUnavailable(
        'ระบบควบคุม quota ไม่พร้อม จึงยังไม่เริ่มการค้นที่อาจมีค่าใช้จ่าย',
      );
    }
  }
  private async body(
    url: URL,
    headers: Record<string, string>,
    init: RequestInit = {},
    timeout = 15_000,
  ): Promise<string> {
    try {
      const response = await fetch(url, {
        ...init,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        switch (response.status) {
          case 401:
          case 403:
            throw new CatalogUnavailable(
              'ผู้ให้บริการไม่อนุญาต ตรวจ API key/token และสิทธิ์ของ project หรือ Actor',
            );
          case 404:
            throw new CatalogUnavailable(
              'ไม่พบ Actor Task หรือข้อมูล ตรวจ task ID และสิทธิ์ในบัญชีบริษัท',
            );
          case 429:
            throw new CatalogUnavailable(
              'ผู้ให้บริการจำกัด quota ลองใหม่ภายหลังหรือตรวจแพ็กเกจ',
            );
          default:
            throw new CatalogUnavailable(
              'ผู้ให้บริการตอบไม่สำเร็จ ลองใหม่ภายหลัง',
            );
        }
      }
      if (!response.body) throw new Error('body');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_000_000) {
          await reader.cancel();
          throw new Error('size');
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString('utf8');
    } catch (error) {
      if (error instanceof CatalogUnavailable) throw error;
      throw new CatalogUnavailable(
        'ข้อมูลจากผู้ให้บริการไม่สมบูรณ์หรือหมดเวลา ลองใหม่ภายหลัง',
      );
    }
  }
  private async json(
    url: URL,
    headers: Record<string, string>,
    init: RequestInit = {},
    timeout = 15_000,
  ): Promise<unknown> {
    try {
      return JSON.parse(
        await this.body(url, headers, init, timeout),
      ) as unknown;
    } catch (error) {
      if (error instanceof CatalogUnavailable) throw error;
      throw new CatalogUnavailable(
        'รูปแบบข้อมูลผู้ให้บริการไม่ถูกต้อง ให้ตรวจ connector',
      );
    }
  }

  private citation(raw: unknown, source: SocialSource): string | null {
    try {
      const url = new URL(clean(raw, 2000));
      const host = url.hostname.toLowerCase();
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.port ||
        isIP(host.replace(/^\[|\]$/g, '')) ||
        !host.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal|lan|test|invalid)$/.test(host) ||
        [...url.searchParams.keys()].some((x) =>
          /token|secret|auth|cookie|api.?key/i.test(x),
        )
      )
        return null;
      const hosts: Record<Exclude<SocialSource, 'google'>, string[]> = {
        facebook: ['facebook.com', 'fb.watch'],
        instagram: ['instagram.com'],
        tiktok: ['tiktok.com'],
        youtube: ['youtube.com', 'youtu.be'],
      };
      if (
        source !== 'google' &&
        !hosts[source].some((h) => host === h || host.endsWith('.' + h))
      )
        return null;
      url.hash = '';
      return url.toString();
    } catch {
      return null;
    }
  }
  private date(value: unknown): string | undefined {
    const time =
      typeof value === 'number'
        ? value < 1e12
          ? value * 1000
          : value
        : Date.parse(clean(value, 80));
    return Number.isFinite(time) && time > 0 && time <= Date.now() + 60_000
      ? new Date(time).toISOString()
      : undefined;
  }
  private result(
    source: SocialSource,
    items: CatalogItem[],
    scope: ResearchScope,
    provider: string,
    extra: string[] = [],
  ): CatalogResult {
    return {
      source,
      observedAt: new Date().toISOString(),
      url: items[0]?.url ?? '',
      groups: [{ label: 'หลักฐานตัวอย่าง', count: items.length }],
      items,
      limitations: [
        `ค้นด้วย ${provider} ตามคำค้นจากโจทย์และเก็บไม่เกิน 10 รายการ ไม่ใช่การสำรวจทุกบัญชีหรือทุกโพสต์`,
        `พื้นที่ ${scope.area} เป็นเงื่อนไขคำค้น ไม่ยืนยันว่าผู้โพสต์หรือธุรกิจตั้งอยู่ในพื้นที่นั้น`,
        'การพบโพสต์ไม่ยืนยันความต้องการซื้อ ราคา สต็อก หรือความนิยมของทั้งตลาด',
        ...extra,
      ],
    };
  }
  private async googleNews(
    scope: ResearchScope,
    source: SocialSource,
  ): Promise<CatalogResult> {
    const url = new URL('https://news.google.com/rss/search');
    const domains: Record<string, string> = {
      facebook: 'facebook.com',
      instagram: 'instagram.com',
      tiktok: 'tiktok.com',
    };
    const domain = domains[source];
    url.search = new URLSearchParams({
      q: `${scope.title} ${scope.area}${domain ? ' site:' + domain : ''} when:${scope.days}d`.slice(
        0,
        700,
      ),
      hl: 'th',
      gl: 'TH',
      ceid: 'TH:th',
    }).toString();
    const xml = await this.body(url, {
      Accept: 'application/rss+xml, application/xml',
    });
    if (!/<rss(?:\s|>)/.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new CatalogUnavailable(
        'RSS ข่าวตอบรูปแบบที่ไม่รองรับ ลองใหม่ภายหลัง',
      );
    // This deliberately reads only the simple RSS item fields, never entities or article HTML.
    const decode = (text: string) =>
      text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(
          /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
          (entity, name: string) => {
            const named: Record<string, string> = {
              amp: '&',
              lt: '<',
              gt: '>',
              quot: '"',
              apos: "'",
            };
            if (!name.startsWith('#'))
              return named[name.toLowerCase()] ?? entity;
            const n =
              name.slice(0, 2).toLowerCase() === '#x'
                ? parseInt(name.slice(2), 16)
                : Number(name.slice(1));
            return Number.isInteger(n) &&
              n >= 32 &&
              n <= 0x10ffff &&
              !(n >= 0xd800 && n <= 0xdfff)
              ? String.fromCodePoint(n)
              : '';
          },
        );
    const items: CatalogItem[] = [];
    const since = Date.now() - scope.days * DAY;
    for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const field = (tag: string) =>
        decode(
          new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`).exec(
            match[1],
          )?.[1] ?? '',
        );
      const citation = this.citation(field('link'), 'google');
      if (!citation || new URL(citation).hostname !== 'news.google.com')
        continue;
      if (domain) {
        const publisherUrl = decode(
          /<source\b[^>]*\burl="([^"]+)"[^>]*>/.exec(match[1])?.[1] ?? '',
        );
        if (!this.citation(publisherUrl, source)) continue;
      }
      const name = clean(field('title'), 500);
      const publishedAt = this.date(field('pubDate'));
      if (!name || !publishedAt || Date.parse(publishedAt) < since) continue;
      const id = hash(citation).slice(0, 24);
      if (items.some((x) => x.id === id)) continue;
      items.push({
        id,
        name,
        detail: [
          domain ? 'ชื่อ/ข้อความสั้นจากดัชนี Google News' : '',
          name,
          clean(field('source'), 200),
        ]
          .filter(Boolean)
          .join(' · '),
        url: citation,
        publishedAt,
      });
      if (items.length >= 10) break;
    }
    const result = this.result(source, items, scope, 'Google News RSS', [
      'อ่านเฉพาะชื่อข่าว สำนักข่าว และลิงก์สาธารณะ ไม่ได้อ่านเนื้อหาบทความเต็มหรือค้น Google Search ทั้งเว็บ',
      'RSS นี้เป็น endpoint สาธารณะที่ตรวจพบ ไม่ใช่ API ที่มีสัญญารับรองความพร้อมของบริการ',
      ...(domain
        ? [
            `ค้นเฉพาะรายการ ${SOCIAL_LABELS[source]} ที่มีบนดัชนี Google News ไม่ได้เชื่อม API หรืออ่านโพสต์เต็ม/คอมเมนต์/บัญชีส่วนตัวของแพลตฟอร์ม`,
          ]
        : []),
    ]);
    result.via = domain
      ? 'ผ่านดัชนี Google News RSS · ไม่ใช่ API ของแพลตฟอร์ม'
      : 'Google News RSS · ชื่อข่าวและลิงก์เท่านั้น';
    return result;
  }
  private async youtube(scope: ResearchScope): Promise<CatalogResult> {
    const items: CatalogItem[] = [];
    const since = new Date(Date.now() - scope.days * DAY).toISOString();
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.search = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      q: scope.title.slice(0, 500),
      publishedAfter: since,
      publishedBefore: new Date().toISOString(),
      maxResults: '10',
      regionCode: 'TH',
      relevanceLanguage: 'th',
      order: 'relevance',
      safeSearch: 'moderate',
    }).toString();
    let body: Row | null = null;
    const keys = youtubeKeys();
    const tried = new Set<string>();
    for (let attempt = 0; attempt < Math.min(2, keys.length); attempt++) {
      const day = new Date().toISOString().slice(0, 10);
      const reserved = await this.reserve(
        budgetScript,
        ['research:social:youtube:day:' + day],
        [
          String(
            Math.floor(
              positive(process.env.RESEARCH_YOUTUBE_DAILY_CALL_LIMIT, 24, 1000),
            ),
          ),
        ],
      );
      if (reserved < 1)
        throw new CatalogUnavailable(
          'ถึงจำนวนเรียก YouTube ที่บริษัทกำหนดต่อวันแล้ว ลองใหม่วันถัดไป',
        );
      const key = Array.from(
        { length: keys.length },
        (_, i) => keys[(reserved - 1 + i) % keys.length],
      ).find((candidate) => !tried.has(candidate))!;
      tried.add(key);
      try {
        body = object(await this.json(url, { 'x-goog-api-key': key }));
        break;
      } catch (error) {
        if (attempt === Math.min(2, keys.length) - 1) throw error;
      }
    }
    if (!Array.isArray(body?.items))
      throw new CatalogUnavailable(
        'รูปแบบข้อมูล YouTube เปลี่ยน ให้ผู้ดูแลตรวจ connector',
      );
    for (const value of body.items.slice(0, 10)) {
      const row = object(value);
      const id = object(row?.id)?.videoId;
      const snippet = object(row?.snippet);
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id) || !snippet)
        continue;
      const publishedAt = this.date(snippet.publishedAt);
      if (!publishedAt || publishedAt < since) continue;
      const name = clean(snippet.title, 300);
      if (!name || items.some((x) => x.id === id)) continue;
      items.push({
        id,
        name,
        detail: [
          name,
          clean(snippet.channelTitle, 200),
          clean(snippet.description),
        ]
          .filter(Boolean)
          .join(' · ')
          .slice(0, 2500),
        url: `https://www.youtube.com/watch?v=${id}`,
        publishedAt,
      });
    }
    return this.result('youtube', items, scope, 'YouTube Data API v3');
  }

  private template(value: unknown, scope: ResearchScope, now: string): unknown {
    if (Array.isArray(value))
      return value.map((x) => this.template(x, scope, now));
    const row = object(value);
    if (row)
      return Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, this.template(v, scope, now)]),
      );
    if (typeof value !== 'string') return value;
    const fields: Record<string, string | number> = {
      query: `${scope.title} ${scope.area}`.slice(0, 600),
      title: scope.title,
      area: scope.area,
      days: scope.days,
      since: new Date(Date.parse(now) - scope.days * DAY).toISOString(),
      until: now,
      limit: 10,
    };
    const exact = /^\{\{(days|limit)\}\}$/.exec(value);
    if (exact) return fields[exact[1]];
    return value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
      String(fields[key]),
    );
  }
  private async apify(
    source: SocialSource,
    scope: ResearchScope,
    researchRunId: string,
    task: ApifyTask,
  ): Promise<CatalogResult> {
    const token = apifyToken();
    const headers = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    };
    const jobKey = `research:social:apify:job:${researchRunId}:${source}`;
    let remoteRunId = await this.redisGet(jobKey);
    if (!remoteRunId) {
      const now = new Date().toISOString();
      const cents = Math.floor(
        positive(process.env.RESEARCH_APIFY_MAX_RUN_USD, 0.05, 1) * 100,
      );
      if (cents < 1)
        throw new CatalogUnavailable(
          'งบต่อ run ของ Apify ปิดอยู่ จึงยังไม่เริ่ม Actor',
        );
      const monthlyCents = Math.floor(
        positive(process.env.RESEARCH_APIFY_MONTHLY_BUDGET_USD, 4, 100) * 100,
      );
      const reserved = await this.reserve(
        apifyBudgetScript,
        [
          'research:social:apify:day:' + now.slice(0, 10),
          'research:social:apify:month:' + now.slice(0, 7),
          jobKey,
        ],
        [
          String(
            Math.floor(
              positive(process.env.RESEARCH_APIFY_DAILY_RUN_LIMIT, 4, 100),
            ),
          ),
          String(cents),
          String(monthlyCents),
        ],
      );
      switch (reserved) {
        case -1:
          throw new CatalogUnavailable(
            'ถึงจำนวนงาน Apify ต่อวันที่บริษัทกำหนดแล้ว ลองใหม่วันถัดไป',
          );
        case -2:
          throw new CatalogUnavailable(
            'ถึงงบ Apify ต่อเดือนที่บริษัทกำหนดแล้ว ให้ผู้ดูแลตรวจงบและเครดิต',
          );
        case 0:
          throw new CatalogUnavailable(
            'งาน Apify เดิมเริ่มแล้วและคำตอบยังไม่พร้อม ระบบไม่เริ่มงานที่อาจคิดเงินซ้ำ',
          );
      }
      const startUrl = new URL(
        `https://api.apify.com/v2/actor-tasks/${encodeURIComponent(task.taskId)}/runs`,
      );
      startUrl.search = new URLSearchParams({
        timeout: '90',
        waitForFinish: '0',
        restartOnError: 'false',
        maxItems: '10',
        maxTotalChargeUsd: (cents / 100).toFixed(2),
      }).toString();
      const started = object(
        await this.json(startUrl, headers, {
          method: 'POST',
          body: JSON.stringify(this.template(task.input, scope, now)),
        }),
      );
      const remote = object(started?.data);
      if (!validId(remote?.id) || remote.id === 'starting')
        throw new CatalogUnavailable(
          'Apify ไม่คืนรหัสงานที่ถูกต้อง ให้ผู้ดูแลตรวจ task',
        );
      remoteRunId = remote.id;
      try {
        await this.redis!.set(jobKey, remoteRunId, { EX: 2_592_000 });
      } catch {
        throw new CatalogUnavailable(
          'บันทึกรหัสงาน Apify ไม่สำเร็จ ระบบไม่เริ่มงานซ้ำ ให้ผู้ดูแลตรวจ Redis',
        );
      }
    }
    if (!validId(remoteRunId) || remoteRunId === 'starting')
      throw new CatalogUnavailable(
        'งาน Apify เดิมยังไม่ทราบผล ระบบไม่เริ่มงานที่อาจคิดเงินซ้ำ ให้ตรวจ Apify Console',
      );
    let remote: Row | null = null;
    for (const wait of [60, 30]) {
      const runUrl = new URL(
        `https://api.apify.com/v2/actor-runs/${remoteRunId}`,
      );
      runUrl.searchParams.set('waitForFinish', String(wait));
      const response = object(
        await this.json(runUrl, headers, {}, (wait + 5) * 1000),
      );
      remote = object(response?.data);
      if (
        !remote ||
        remote.id !== remoteRunId ||
        remote.actorTaskId !== task.taskId
      )
        throw new CatalogUnavailable(
          'รหัส task/run จาก Apify ไม่ตรงกับการตั้งค่า',
        );
      if (['READY', 'RUNNING'].includes(String(remote.status))) continue;
      break;
    }
    if (remote?.status !== 'SUCCEEDED' || !validId(remote.defaultDatasetId))
      throw new CatalogUnavailable(
        'งาน Apify ไม่สำเร็จหรือหมดเวลา ให้ตรวจ Actor และงบใน Apify Console',
      );
    const datasetUrl = new URL(
      `https://api.apify.com/v2/datasets/${remote.defaultDatasetId}/items`,
    );
    datasetUrl.search = new URLSearchParams({
      format: 'json',
      clean: 'true',
      limit: '10',
    }).toString();
    const data = await this.json(datasetUrl, headers);
    if (!Array.isArray(data))
      throw new CatalogUnavailable(
        'รูปแบบ dataset ไม่ถูกต้อง ให้ตรวจ field mapping ของ Actor',
      );
    const rows: unknown[] = task.itemsPath
      ? data.flatMap((row) => {
          const nested = path(row, task.itemsPath!);
          return Array.isArray(nested) ? nested.slice(0, 50) : [];
        })
      : data;
    const items: CatalogItem[] = [];
    let rejected = 0;
    const since = Date.now() - scope.days * DAY;
    for (const row of rows.slice(0, 100)) {
      const url = this.citation(path(row, task.fields.url), source);
      const detail = clean(path(row, task.fields.text))
        .split(token)
        .join('[redacted]');
      const name = clean(
        task.fields.title ? path(row, task.fields.title) : detail,
        300,
      )
        .split(token)
        .join('[redacted]');
      if (!url || !detail || !name) {
        rejected++;
        continue;
      }
      const publishedAt = task.fields.publishedAt
        ? this.date(path(row, task.fields.publishedAt))
        : undefined;
      if (publishedAt && Date.parse(publishedAt) < since) continue;
      const id = hash(url).slice(0, 24);
      if (items.some((item) => item.id === id)) continue;
      items.push({
        id,
        url,
        name,
        detail: [name, detail]
          .filter((s, i, a) => a.indexOf(s) === i)
          .join(' · ')
          .slice(0, 2500),
        publishedAt,
      });
      if (items.length >= 10) break;
    }
    if (rows.length && !items.length && rejected === Math.min(rows.length, 100))
      throw new CatalogUnavailable(
        'ไม่พบลิงก์และข้อความของแพลตฟอร์มที่ใช้ได้ ให้ตรวจ field mapping ของ Actor',
      );
    return this.result(
      source,
      items,
      scope,
      `Apify · ${SOCIAL_LABELS[source]}`,
      [
        'ผลจาก Actor Task ภายนอก ไม่ใช่การยืนยันสิทธิ์หรือความครอบคลุมจาก API ของแพลตฟอร์ม',
        ...(items.some((x) => !x.publishedAt)
          ? [
              'บางหลักฐานไม่ระบุวันเผยแพร่ จึงยืนยันไม่ได้ว่าอยู่ภายในช่วงย้อนหลังที่ขอ',
            ]
          : []),
        ...(rejected
          ? [`ตัดข้อมูลที่ไม่มีลิงก์/ข้อความที่ถูกต้อง ${rejected} รายการ`]
          : []),
      ],
    );
  }
}
