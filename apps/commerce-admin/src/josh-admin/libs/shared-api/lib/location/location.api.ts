import { apiClient } from '../api-client/api-client';

export type ThaiLocationItem = {
  code: number;
  name: string;
  name_th: string;
  name_en: string;
};

export type ThaiPostalLookupItem = {
  subdistrict_code: number;
  subdistrict_name: string;
  subdistrict_name_th: string;
  subdistrict_name_en: string;
  district_code: number;
  district_name: string;
  district_name_th: string;
  district_name_en: string;
  province_code: number;
  province_name: string;
  province_name_th: string;
  province_name_en: string;
  postal_code: string;
};

export type ThaiGeographyMeta = {
  source: string;
  data_version: string | null;
  source_commit: string | null;
  imported_at: string;
  province_count: number;
  district_count: number;
  subdistrict_count: number;
};

export type ThaiGeographyImportResult = ThaiGeographyMeta & {
  duration_ms: number;
};

type LocationLang = 'th' | 'en';

export const getThaiGeographyMeta = async (): Promise<ThaiGeographyMeta> => {
  const response = await apiClient.get<ThaiGeographyMeta>('/location/meta');
  return response.data;
};

export const getThaiProvinces = async (
  lang: LocationLang = 'th',
): Promise<ThaiLocationItem[]> => {
  const response = await apiClient.get<ThaiLocationItem[]>('/location/provinces', {
    params: { lang },
  });
  return response.data;
};

export const getThaiDistricts = async (
  provinceCode: number,
  lang: LocationLang = 'th',
): Promise<ThaiLocationItem[]> => {
  const response = await apiClient.get<ThaiLocationItem[]>('/location/districts', {
    params: { province_code: provinceCode, lang },
  });
  return response.data;
};

export const getThaiSubdistricts = async (
  districtCode: number,
  lang: LocationLang = 'th',
): Promise<ThaiLocationItem[]> => {
  const response = await apiClient.get<ThaiLocationItem[]>(
    '/location/subdistricts',
    {
      params: { district_code: districtCode, lang },
    },
  );
  return response.data;
};

export const lookupThaiPostalCode = async (
  code: string,
  lang: LocationLang = 'th',
): Promise<ThaiPostalLookupItem[]> => {
  const response = await apiClient.get<ThaiPostalLookupItem[]>(
    '/location/postal-codes',
    {
      params: { code, lang },
    },
  );
  return response.data;
};

export const importThaiGeographyMaster = async (
  accessToken?: string,
): Promise<ThaiGeographyImportResult> => {
  const response = await apiClient.post<ThaiGeographyImportResult>(
    '/location/import',
    undefined,
    accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  );
  return response.data;
};
