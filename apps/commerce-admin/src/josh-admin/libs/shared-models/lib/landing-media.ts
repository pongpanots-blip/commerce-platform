/**
 * Every image/video on the landing page (`apps/landing-web`) that currently
 * renders with an empty `alt`/no `aria-label` — the admin-editable id list for
 * `LandingSeo.mediaAlt` (see `apps/landing-web/docs/landing-seo.html` and
 * `src/seo.ts`). `id` must match what `apps/landing-web` looks up in
 * `mediaAlt`; a poster image and the video playing over it share one id (same
 * visual, one alt/aria-label). Decorative marks (footer/nav logo) are not
 * listed — they intentionally stay `alt=""` with no admin control.
 */

export type LandingMediaItem = {
  id: string;
  label: string;
  kind: 'image' | 'video';
  section: string;
};

const brand = (slug: string, name: string): LandingMediaItem => ({
  id: `brand-${slug}`,
  label: `TrustedBrands — โลโก้ ${name} (${slug}.svg)`,
  kind: 'image',
  section: 'trusted-brands',
});

export const LANDING_MEDIA: LandingMediaItem[] = [
  {
    id: 'hero-video',
    label: 'Hero — วิดีโอพื้นหลังหน้าแรก (hero.mp4 / hero-poster.webp)',
    kind: 'video',
    section: 'hero',
  },

  // WhyJosh's five accordion cards — each is a poster image + a video that
  // plays over it while the card is open, same shot, one id per card.
  { id: 'why-skus', label: 'WhyJosh — การ์ด 1: จำนวน SKU (01-skus.mp4)', kind: 'video', section: 'why-josh' },
  { id: 'why-categories', label: 'WhyJosh — การ์ด 2: หมวดหมู่วัตถุดิบ (02-categories.mp4)', kind: 'video', section: 'why-josh' },
  { id: 'why-delivery', label: 'WhyJosh — การ์ด 3: การจัดส่ง (03-delivery.mp4)', kind: 'video', section: 'why-josh' },
  { id: 'why-support', label: 'WhyJosh — การ์ด 4: ทีมซัพพอร์ต (04-support.mp4)', kind: 'video', section: 'why-josh' },
  { id: 'why-scale', label: 'WhyJosh — การ์ด 5: การขยายธุรกิจ (05-scale.mp4)', kind: 'video', section: 'why-josh' },

  // Gallery strip, left to right as it scrolls.
  { id: 'gallery-square-1', label: 'Gallery — ชุดภาพที่ 1 รูปสี่เหลี่ยมซ้าย (square-1.webp)', kind: 'image', section: 'gallery' },
  { id: 'gallery-square-2', label: 'Gallery — ชุดภาพที่ 1 รูปสี่เหลี่ยมขวา (square-2.webp)', kind: 'image', section: 'gallery' },
  { id: 'gallery-wide-1', label: 'Gallery — ชุดภาพที่ 1 รูปกว้างด้านล่าง (wide-1.webp)', kind: 'image', section: 'gallery' },
  { id: 'gallery-tall-1', label: 'Gallery — รูปแนวตั้งเต็มความสูง ชุดที่ 1 (tall-1.webp)', kind: 'image', section: 'gallery' },
  { id: 'gallery-square-3', label: 'Gallery — ชุดภาพที่ 2 รูปสี่เหลี่ยมซ้าย (square-3.webp)', kind: 'image', section: 'gallery' },
  { id: 'gallery-square-4', label: 'Gallery — ชุดภาพที่ 2 รูปสี่เหลี่ยมขวา (square-4.webp)', kind: 'image', section: 'gallery' },
  { id: 'gallery-wide-2', label: 'Gallery — ชุดภาพที่ 2 รูปกว้างด้านบน (wide-2.webp)', kind: 'image', section: 'gallery' },
  { id: 'gallery-tall-2', label: 'Gallery — รูปแนวตั้งเต็มความสูง ชุดที่ 2 (tall-2.webp)', kind: 'image', section: 'gallery' },
  { id: 'gallery-square-5', label: 'Gallery — ชุดภาพที่ 3 รูปสี่เหลี่ยมซ้าย (square-5.webp)', kind: 'image', section: 'gallery' },
  { id: 'gallery-square-6', label: 'Gallery — ชุดภาพที่ 3 รูปสี่เหลี่ยมขวา (square-6.webp)', kind: 'image', section: 'gallery' },
  { id: 'gallery-wide-3', label: 'Gallery — ชุดภาพที่ 3 รูปกว้างด้านล่าง (wide-3.webp)', kind: 'image', section: 'gallery' },

  // TrustedBrands marquee — every partner logo, in the same order as
  // `BRANDS_MEDIA` in `apps/landing-web/src/media.ts`.
  brand('36-south', '36 South'),
  brand('ammerlander', 'Ammerländer'),
  brand('bass-strait', 'Bass Strait'),
  brand('betty-crocker', 'Betty Crocker'),
  brand('callebaut', 'Callebaut'),
  brand('casa-rinaldi', 'Casa Rinaldi'),
  brand('clearwater', 'Clearwater'),
  brand('dots', 'Dots'),
  brand('ebony', 'Ebony'),
  brand('evian', 'Evian'),
  brand('ferrarelle', 'Ferrarelle'),
  brand('grand-or', "Grand'Or"),
  brand('gund-agai-lamb', 'Gundagai Lamb'),
  brand('haagen-dazs', 'Häagen-Dazs'),
  brand('harvey-beef', 'Harvey Beef'),
  brand('leroy', 'Leroy'),
  brand('let-s-plant-meat', "Let's Plant Meat"),
  brand('nature-valley', 'Nature Valley'),
  brand('prime-valley', 'Prime Valley'),
  brand('salumi-villani', 'Salumi Villani'),
  brand('sunny-day', 'Sunny Day'),

  // Closing's social row.
  { id: 'closing-social-facebook', label: 'Closing — ไอคอนโซเชียล Facebook (facebook.svg)', kind: 'image', section: 'closing' },
  { id: 'closing-social-instagram', label: 'Closing — ไอคอนโซเชียล Instagram (instagram.svg)', kind: 'image', section: 'closing' },
  { id: 'closing-social-tiktok', label: 'Closing — ไอคอนโซเชียล TikTok (tiktok.svg)', kind: 'image', section: 'closing' },
  { id: 'closing-social-linkedin', label: 'Closing — ไอคอนโซเชียล LinkedIn (linkedin.svg)', kind: 'image', section: 'closing' },
];
