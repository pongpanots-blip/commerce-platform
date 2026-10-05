import type { AxiosResponse } from 'axios';
import { apiClient } from '../api-client/api-client';

/** Body of `POST /upload/image`; `data` is absent when no file was received (`status: false`). */
export interface UploadImageResponse {
  status: boolean;
  statusCode: number;
  message: string;
  data?: { url: string; filename: string };
}

/** `promotions` stores under `uploads/promotions/` and only deletes the replaced image if nothing references it. */
export type UploadImageScope = 'promotions';

/**
 * `replaceUrl` — the image being overwritten. The backend deletes that object
 * from S3 once the new one is stored, so replacing an image does not orphan the
 * old one. Pass it whenever the field already holds an uploaded URL.
 *
 * `scope` — omit for brand logos (`uploads/brands/`); `'promotions'` for
 * promotion page / campaign images. Unknown values are rejected with 400.
 */
export const uploadImage = async (
  file: File,
  replaceUrl?: string,
  scope?: UploadImageScope,
): Promise<AxiosResponse<UploadImageResponse>> => {
  const formData = new FormData();
  formData.append('file', file);
  if (replaceUrl?.trim()) formData.append('replaceUrl', replaceUrl.trim());
  if (scope) formData.append('scope', scope);
  const response = await apiClient.post<UploadImageResponse>('/upload/image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response;
};
