import { getUiLocale } from '@cp/ui';

/** Local bilingual copy keeps protected shared message catalogues unchanged. */
export const commerceText = (th: string, en: string) => getUiLocale() === 'th' ? th : en;
