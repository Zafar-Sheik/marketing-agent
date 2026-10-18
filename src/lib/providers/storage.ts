import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, NotFound } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env, requireKey } from '@/env';
import { sign } from '@/lib/crypto';
import type { Storage } from './types';

let s3: S3Client | undefined;
const client = () =>
  (s3 ??= new S3Client({
    region: env().AWS_REGION,
    // Otherwise presigned PUT URLs carry a checksum of an empty body and browser uploads fail.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: requireKey('AWS_ACCESS_KEY_ID'), secretAccessKey: requireKey('AWS_SECRET_ACCESS_KEY') },
  }));

export const s3Storage: Storage = {
  get bucket() {
    return env().S3_BUCKET;
  },
  async put(key, body, mimeType) {
    await client().send(new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: body, ContentType: mimeType }));
  },
  async get(key) {
    const res = await client().send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  },
  async head(key) {
    try {
      const res = await client().send(new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
      return { bytes: res.ContentLength ?? 0, mimeType: res.ContentType ?? 'application/octet-stream' };
    } catch (e) {
      if (e instanceof NotFound || (e as { name?: string }).name === 'NotFound') return null;
      throw e;
    }
  },
  presignPut(key, mimeType, bytes) {
    return getSignedUrl(
      client(),
      new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, ContentType: mimeType, ContentLength: bytes }),
      { expiresIn: env().S3_PRESIGN_TTL_SECONDS },
    );
  },
  presignGet(key, ttlSeconds = env().S3_PRESIGN_TTL_SECONDS) {
    return getSignedUrl(client(), new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }), { expiresIn: ttlSeconds });
  },
};

/**
 * Disk-backed stand-in for S3 (MOCK_PROVIDERS=true or no AWS keys in development).
 * Files live in .data/storage and are served by /api/dev/storage with signed URLs.
 */
export function localStorage(root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), '.data/storage')): Storage {
  const file = (key: string) => {
    const p = path.resolve(/*turbopackIgnore: true*/ root, key);
    if (!p.startsWith(root + path.sep)) throw new Error('Invalid key');
    return p;
  };
  const signedUrl = (key: string, method: 'GET' | 'PUT', ttl: number) => {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = sign(`${method}:${key}`, exp)['X-Signature'].slice(7);
    return `${env().NEXT_PUBLIC_APP_URL}/api/dev/storage/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sig}`;
  };
  return {
    bucket: 'local',
    async put(key, body, mimeType) {
      await mkdir(path.dirname(file(key)), { recursive: true });
      await writeFile(file(key), body);
      await writeFile(`${file(key)}.mime`, mimeType);
    },
    get: (key) => readFile(file(key)),
    async head(key) {
      try {
        const s = await stat(file(key));
        const mimeType = await readFile(`${file(key)}.mime`, 'utf8').catch(() => 'application/octet-stream');
        return { bytes: s.size, mimeType };
      } catch {
        return null;
      }
    },
    async presignPut(key) {
      return signedUrl(key, 'PUT', env().S3_PRESIGN_TTL_SECONDS);
    },
    async presignGet(key, ttl = env().S3_PRESIGN_TTL_SECONDS) {
      return signedUrl(key, 'GET', ttl);
    },
  };
}
