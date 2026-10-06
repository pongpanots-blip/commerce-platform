export type ProductMediaItem = {
  product_media_id: string;
  source: string;
  media_type: 'image' | 'video';
  sort_order: number;
};

export type ProductTranslation = {
  language_code: string;
  product_name?: string;
  product_description?: string;
};

export const API_BASE = 'http://localhost:3000';

export function resolveMediaUrl(source: string): string {
  if (!source) return '';
  return source.startsWith('http') ? source : `${API_BASE}${source}`;
}

export function sortProductMedia(media: ProductMediaItem[] = []): ProductMediaItem[] {
  const normalized = media.map((item) => ({
    ...item,
    media_type: (item.media_type?.toLowerCase() === 'video' ? 'video' : 'image') as
      | 'image'
      | 'video',
    sort_order: Number(item.sort_order ?? 0),
  }));

  const images = normalized
    .filter((item) => item.media_type === 'image')
    .sort((a, b) => a.sort_order - b.sort_order);
  const videos = normalized
    .filter((item) => item.media_type === 'video')
    .sort((a, b) => a.sort_order - b.sort_order);

  return [...images, ...videos];
}

export function getTranslation(
  translations: ProductTranslation[] | undefined,
  languageCode: 'th' | 'en',
) {
  return translations?.find((item) => item.language_code === languageCode);
}
