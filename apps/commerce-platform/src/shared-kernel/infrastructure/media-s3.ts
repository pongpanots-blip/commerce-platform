import { ServiceUnavailableException } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const DEFAULT_REGION = 'ap-southeast-7'; // josh DEFAULT_AWS_REGION
let client: S3Client | null = null;

/**
 * Put a public object in josh's media bucket (josh env names — S3_MEDIA_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY, MEDIA_BASE_URL) and return the URL josh would build for it, so files commerce uploads look
 * exactly like josh's. No S3 configured → 503 (commerce serves no local /uploads).
 */
export async function putMediaObject(key: string, body: Buffer, contentType: string): Promise<string> {
  const env = process.env;
  const bucket = ['1', 'true'].includes(env.S3_MEDIA_DISABLED ?? '') ? '' : env.S3_MEDIA_BUCKET?.trim() ?? '';
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) throw new ServiceUnavailableException('media upload is not configured on this server (S3_MEDIA_BUCKET / AWS_*)');
  const region = env.AWS_REGION?.trim() || DEFAULT_REGION;
  client ??= new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  const base = env.MEDIA_BASE_URL?.trim() || `https://${bucket}.s3.${region}.amazonaws.com`;
  return `${base.replace(/\/$/, '')}/${key}`;
}
