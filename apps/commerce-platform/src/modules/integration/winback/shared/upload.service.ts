import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const ACTIVITY_UPLOAD_DIR = './uploads/activities';
const DEFAULT_REGION = 'ap-southeast-7'; // josh DEFAULT_AWS_REGION

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
  private client: S3Client | null = null;

  async uploadActivityPhoto(file: UploadedActivityFile): Promise<{ url: string; filename: string }> {
    const env = process.env;
    const bucket = ['1', 'true'].includes(env.S3_MEDIA_DISABLED ?? '') ? '' : env.S3_MEDIA_BUCKET?.trim() ?? '';
    const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
    if (!bucket || !accessKeyId || !secretAccessKey) throw new ServiceUnavailableException('photo upload is not configured on this server (S3_MEDIA_BUCKET / AWS_*)');
    const region = env.AWS_REGION?.trim() || DEFAULT_REGION;
    const key = `${ACTIVITY_UPLOAD_DIR.replace(/^\.\//, '')}/${file.filename}`;
    const local = file.path ?? (file.destination ? join(file.destination, file.filename) : null);
    try {
      const body = file.buffer ?? (local ? await readFile(local) : null);
      if (!body) throw new ServiceUnavailableException('upload had no file body');
      this.client ??= new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
      await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: file.mimetype || 'application/octet-stream' }));
      this.logger.log(`Uploaded winback activity photo to s3://${bucket}/${key}`);
    } finally {
      if (local) await unlink(local).catch(() => undefined);
    }
    const base = env.MEDIA_BASE_URL?.trim() || `https://${bucket}.s3.${region}.amazonaws.com`;
    return { url: `${base.replace(/\/$/, '')}/${key}`, filename: file.filename };
  }
}
