import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, sign, verify } from './crypto';

describe('token encryption', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encrypt('tiktok-access-token');
    expect(decrypt(a)).toBe('tiktok-access-token');
    expect(encrypt('tiktok-access-token')).not.toBe(a);
  });
  it('detects tampering', () => {
    const [iv, tag, body] = encrypt('secret').split('.');
    const flipped = Buffer.from(body, 'base64url');
    flipped[0] ^= 1;
    expect(() => decrypt([iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });
});

describe('webhook signatures', () => {
  const body = JSON.stringify({ run_id: 'r1' });
  it('accepts a valid signature', () => {
    const h = sign(body);
    expect(verify(body, h['X-Signature'], h['X-Timestamp'])).toBe(true);
  });
  it('rejects a modified body, a wrong signature and missing headers', () => {
    const h = sign(body);
    expect(verify(body + ' ', h['X-Signature'], h['X-Timestamp'])).toBe(false);
    expect(verify(body, 'sha256=00', h['X-Timestamp'])).toBe(false);
    expect(verify(body, null, null)).toBe(false);
  });
  it('rejects replays older than five minutes', () => {
    const old = Math.floor(Date.now() / 1000) - 600;
    const h = sign(body, old);
    expect(verify(body, h['X-Signature'], h['X-Timestamp'])).toBe(false);
  });
});
