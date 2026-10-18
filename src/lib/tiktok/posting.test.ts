import { describe, it, expect, afterEach, vi } from 'vitest';
import { livePosting } from './posting';

afterEach(() => vi.unstubAllGlobals());

describe('live TikTok posting client', () => {
  it('initialises a FILE_UPLOAD and PUTs every chunk with a correct Content-Range', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/post/publish/video/init/')) {
        return Response.json({ data: { publish_id: 'pub_1', upload_url: 'https://upload.tiktok.test/u1' }, error: { code: 'ok' } });
      }
      return new Response(null, { status: 201 });
    });
    const video = Buffer.alloc(70_000_123, 1);
    const id = await livePosting('token').publishVideo({ video, caption: 'Hello #fyp', privacyLevel: 'SELF_ONLY' });
    expect(id).toBe('pub_1');

    const init = JSON.parse(String(calls[0].init.body));
    expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer token' });
    expect(init.source_info).toEqual({ source: 'FILE_UPLOAD', video_size: 70_000_123, chunk_size: 10_000_000, total_chunk_count: 7 });
    expect(init.post_info).toMatchObject({ title: 'Hello #fyp', privacy_level: 'SELF_ONLY' });

    const puts = calls.slice(1);
    expect(puts).toHaveLength(7);
    expect(puts.every((c) => c.url === 'https://upload.tiktok.test/u1' && c.init.method === 'PUT')).toBe(true);
    expect((puts[0].init.headers as Record<string, string>)['Content-Range']).toBe('bytes 0-9999999/70000123');
    expect((puts[6].init.headers as Record<string, string>)['Content-Range']).toBe('bytes 60000000-70000122/70000123');
    expect((puts[6].init.headers as Record<string, string>)['Content-Length']).toBe('10000123');
  });

  it('surfaces TikTok errors and flags expired tokens', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: { code: 'access_token_invalid', message: 'expired' } }, { status: 401 }));
    await expect(livePosting('t').creatorInfo()).rejects.toMatchObject({ authExpired: true });
  });
});
