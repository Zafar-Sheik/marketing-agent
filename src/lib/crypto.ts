import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { requireKey } from '@/env';

function key(): Buffer {
  const raw = requireKey('ENCRYPTION_KEY');
  return /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : createHash('sha256').update(raw).digest();
}

/** AES-256-GCM. Output: base64url(iv).base64url(tag).base64url(ciphertext) */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, body] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !body) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Webhook signing between Next.js and n8n (both directions).
// Signature = HMAC-SHA256(secret, `${timestamp}.${rawBody}`), sent as
// `X-Signature: sha256=<hex>` with `X-Timestamp: <unix seconds>`.
// ---------------------------------------------------------------------------
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function sign(rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', requireKey('N8N_WEBHOOK_SECRET')).update(`${timestamp}.${rawBody}`).digest('hex');
  return { 'X-Signature': `sha256=${digest}`, 'X-Timestamp': String(timestamp) };
}

export function verify(rawBody: string, signature: string | null, timestamp: string | null, now = Date.now()): boolean {
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(sign(rawBody, Number(timestamp))['X-Signature']);
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function sha256Hex(data: string | Buffer) {
  return createHash('sha256').update(data).digest('hex');
}
