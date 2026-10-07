import type { ResearchSource } from '../research.types';

export type SocialSource = Exclude<ResearchSource, 'tat' | 'osm'>;
export type ApifyTask = {
  taskId: string;
  input: Record<string, unknown>;
  fields: { url: string; text: string; title?: string; publishedAt?: string };
  itemsPath?: string;
};
export const SOCIAL_SOURCES: SocialSource[] = [
  'facebook',
  'instagram',
  'google',
  'tiktok',
  'youtube',
];
export const SOCIAL_LABELS: Record<ResearchSource, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google: 'Google / เว็บไซต์',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  tat: 'ททท.',
  osm: 'OpenStreetMap',
};
export const socialEnabled = () =>
  !['false', '0'].includes(process.env.RESEARCH_SOCIAL_ENABLED ?? 'true');
export const googleNewsEnabled = () =>
  !['false', '0'].includes(process.env.RESEARCH_GOOGLE_NEWS_ENABLED ?? 'true');
export const publicSocialRssEnabled = () =>
  !['false', '0'].includes(
    process.env.RESEARCH_PUBLIC_SOCIAL_RSS_ENABLED ?? 'true',
  );
export const youtubeKeys = () => {
  const keys = (process.env.RESEARCH_YOUTUBE_API_KEYS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return keys.length > 0 &&
    keys.length <= 5 &&
    keys.every((x) => /^[A-Za-z0-9_-]{20,200}$/.test(x))
    ? [...new Set(keys)]
    : [];
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const fieldPath = (value: unknown) =>
  typeof value === 'string' &&
  value.length <= 120 &&
  /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(value) &&
  !value
    .split('.')
    .some((x) => ['__proto__', 'prototype', 'constructor'].includes(x));

/** Task schemas differ by Actor. An operator supplies the tested input and output mapping. */
export function apifyTask(source: SocialSource): ApifyTask | null {
  if (source === 'youtube') return null;
  try {
    const raw = process.env.RESEARCH_APIFY_TASKS ?? '';
    if (raw.length > 32_000) return null;
    const tasks: unknown = JSON.parse(raw);
    if (!record(tasks)) return null;
    const task = tasks[source];
    if (
      !record(task) ||
      typeof task.taskId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(task.taskId) ||
      !record(task.input) ||
      !record(task.fields) ||
      !fieldPath(task.fields.url) ||
      !fieldPath(task.fields.text) ||
      (task.fields.title !== undefined && !fieldPath(task.fields.title)) ||
      (task.fields.publishedAt !== undefined &&
        !fieldPath(task.fields.publishedAt)) ||
      (task.itemsPath !== undefined && !fieldPath(task.itemsPath))
    )
      return null;
    const input = JSON.stringify(task.input);
    if (
      input.length > 8_000 ||
      !/\{\{(?:query|title)\}\}/.test(input) ||
      /"(?:cookies?|accessToken|apiToken|password|authorization|session|proxyPassword)"\s*:/i.test(
        input,
      )
    )
      return null;
    const placeholders = input.match(/\{\{[^{}]+\}\}/g) ?? [];
    if (
      placeholders.some(
        (x) =>
          ![
            '{{query}}',
            '{{title}}',
            '{{area}}',
            '{{days}}',
            '{{since}}',
            '{{until}}',
            '{{limit}}',
          ].includes(x),
      )
    )
      return null;
    return task as unknown as ApifyTask;
  } catch {
    return null;
  }
}
export const apifyToken = () => {
  const token = process.env.RESEARCH_APIFY_API_TOKEN?.trim() ?? '';
  return /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : '';
};
export const apifyEnabled = () =>
  socialEnabled() && process.env.RESEARCH_APIFY_ENABLED === 'true';

export function socialSourceStatus(source: SocialSource) {
  const news = source === 'google' && googleNewsEnabled();
  const indexed =
    ['facebook', 'instagram', 'tiktok'].includes(source) &&
    publicSocialRssEnabled();
  const native =
    news || indexed || (source === 'youtube' && youtubeKeys().length > 0);
  const task = apifyTask(source);
  const configured = native || (Boolean(apifyToken()) && task !== null);
  const ready = socialEnabled() && (native || (apifyEnabled() && configured));
  const youtube = source === 'youtube';
  return {
    provider: news
      ? 'google-news-rss'
      : indexed
        ? 'public-social-rss'
        : youtube
          ? 'youtube-api'
          : 'apify',
    costMode: news || indexed ? 'free' : youtube ? 'free-quota' : 'credit',
    ready,
    setupUrl:
      news || indexed
        ? 'https://news.google.com/'
        : native || source === 'youtube'
          ? 'https://console.cloud.google.com/apis/library/youtube.googleapis.com'
          : 'https://console.apify.com/',
    reason: ready
      ? ''
      : !socialEnabled()
        ? 'ผู้ดูแลยังไม่เปิด social connectors ตั้งค่า credentials แล้วเปิด RESEARCH_SOCIAL_ENABLED'
        : source === 'youtube' && !configured
          ? 'เพิ่ม RESEARCH_YOUTUBE_API_KEYS และเปิด YouTube Data API v3 ใน project บริษัท'
          : !apifyEnabled()
            ? 'ตั้งค่า Apify ของบริษัทและเปิด RESEARCH_APIFY_ENABLED เพื่อค้นข้อมูลสาธารณะ'
            : 'เพิ่ม RESEARCH_APIFY_API_TOKEN และ task/input/field mapping ของแหล่งนี้ใน RESEARCH_APIFY_TASKS',
    scope: indexed
      ? `ชื่อและลิงก์ ${SOCIAL_LABELS[source]} ที่ Google News เปิดดัชนี ไม่อ่านโพสต์เต็ม/คอมเมนต์หรือ API ของแพลตฟอร์ม`
      : news
        ? 'RSS ข่าวสาธารณะ ไม่ต้องใช้ key เป็นข่าวและชื่อบทความ ไม่ใช่ Google Search ทั้งเว็บ'
        : youtube
          ? 'ค้นวิดีโอสาธารณะตามคำค้นและวันเผยแพร่ ไม่ยืนยันตำแหน่งธุรกิจ ล้างข้อมูล API ภายใน 30 วัน'
          : 'ค้นข้อมูลสาธารณะตาม Actor Task ของบริษัท ขอบเขตและค่าใช้จ่ายขึ้นกับ Actor',
  };
}
