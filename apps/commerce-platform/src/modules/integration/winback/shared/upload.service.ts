import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { putMediaObject } from '../../../../shared-kernel/infrastructure/media-s3';

const ACTIVITY_UPLOAD_DIR = './uploads/activities';

/** The multer file fields winback's upload route hands over (no @types/multer here). */
export interface UploadedActivityFile { destination?: string; filename: string; path?: string; buffer?: Buffer; mimetype?: string }

/**
 * josh UploadService.uploadActivityPhoto for winback in commerce: the same bucket, key and public
 * URL josh builds (josh media env names — S3_MEDIA_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY, MEDIA_BASE_URL — key `uploads/activities/<multer name>`), so photo URLs
 * stored in winback_activity.photo_urls look exactly like josh's and josh's media tools still find
 * them. No S3 configured → 503 (commerce serves no local /uploads, unlike josh's dev fallback).
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  async uploadActivityPhoto(file: UploadedActivityFile): Promise<{ url: string; filename: string }> {
    const key = `${ACTIVITY_UPLOAD_DIR.replace(/^\.\//, '')}/${file.filename}`;
    const local = file.path ?? (file.destination ? join(file.destination, file.filename) : null);
    try {
      const body = file.buffer ?? (local ? await readFile(local) : null);
      if (!body) throw new ServiceUnavailableException('upload had no file body');
      const url = await putMediaObject(key, body, file.mimetype || 'application/octet-stream');
      this.logger.log(`Uploaded winback activity photo ${key}`);
      return { url, filename: file.filename };
    } finally {
      if (local) await unlink(local).catch(() => undefined);
    }
  }
}
