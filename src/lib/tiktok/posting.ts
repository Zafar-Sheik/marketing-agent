import { TikTokError, type TikTokPosting } from './types';

const BASE = 'https://open.tiktokapis.com/v2';

/** TikTok Content Posting API + Display API (organic posts on the client's account). */
export function livePosting(accessToken: string): TikTokPosting {
  async function call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string } };
    if (!res.ok || (json.error && json.error.code !== 'ok')) {
      const code = json.error?.code ?? res.status;
      throw new TikTokError(code, json.error?.message ?? res.statusText, res.status === 401 || code === 'access_token_invalid');
    }
    return json.data as T;
  }

  return {
    async creatorInfo() {
      const d = await call<{ privacy_level_options: string[]; max_video_post_duration_sec: number; creator_nickname: string }>(
        '/post/publish/creator_info/query/',
        {},
      );
      return { privacyLevels: d.privacy_level_options, maxVideoSeconds: d.max_video_post_duration_sec, nickname: d.creator_nickname };
    },
    async publishVideo({ video, caption, privacyLevel }) {
      // FILE_UPLOAD: we send the bytes, so no domain verification is needed (unlike PULL_FROM_URL).
      const plan = uploadChunks(video.length);
      const d = await call<{ publish_id: string; upload_url: string }>('/post/publish/video/init/', {
        post_info: { title: caption.slice(0, 2200), privacy_level: privacyLevel, disable_comment: false, disable_duet: false, disable_stitch: false },
        source_info: { source: 'FILE_UPLOAD', video_size: video.length, chunk_size: plan.chunkSize, total_chunk_count: plan.chunks.length },
      });
      for (const { start, end } of plan.chunks) {
        const res = await fetch(d.upload_url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${video.length}`,
          },
          body: new Uint8Array(video.subarray(start, end + 1)),
        });
        if (!res.ok) throw new TikTokError(res.status, `video upload failed at bytes ${start}-${end}: ${(await res.text()).slice(0, 200)}`);
      }
      return d.publish_id;
    },
    async publishPhotos({ imageUrls, title, caption, privacyLevel }) {
      const d = await call<{ publish_id: string }>('/post/publish/content/init/', {
        post_info: { title: title.slice(0, 90), description: caption.slice(0, 4000), privacy_level: privacyLevel },
        source_info: { source: 'PULL_FROM_URL', photo_images: imageUrls.slice(0, 35), photo_cover_index: 0 },
        post_mode: 'DIRECT_POST',
        media_type: 'PHOTO',
      });
      return d.publish_id;
    },
    async status(publishId) {
      const d = await call<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(
        '/post/publish/status/fetch/',
        { publish_id: publishId },
      );
      if (d.status === 'PUBLISH_COMPLETE') return { state: 'published', postId: d.publicaly_available_post_id?.[0]?.toString() };
      if (d.status === 'FAILED') return { state: 'failed', reason: d.fail_reason };
      return { state: 'processing' };
    },
    async stats(postIds) {
      if (!postIds.length) return [];
      const res = await fetch(`${BASE}/video/query/?fields=id,view_count,like_count,comment_count,share_count`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ filters: { video_ids: postIds.slice(0, 20) } }),
      });
      const json = (await res.json()) as {
        data?: { videos: { id: string; view_count: number; like_count: number; comment_count: number; share_count: number }[] };
      };
      return (json.data?.videos ?? []).map((v) => ({
        postId: v.id,
        views: v.view_count,
        likes: v.like_count,
        comments: v.comment_count,
        shares: v.share_count,
      }));
    },
  };
}

const MB = 1_000_000;
const SINGLE_CHUNK_MAX = 64 * MB;
const CHUNK = 10 * MB;

/**
 * TikTok FILE_UPLOAD chunking: files up to 64 MB go in one chunk; larger files use 10 MB chunks
 * (allowed range 5-64 MB) and the remainder is merged into the last chunk (allowed up to 128 MB).
 */
export function uploadChunks(size: number) {
  if (size <= 0) throw new Error('Empty video');
  if (size <= SINGLE_CHUNK_MAX) return { chunkSize: size, chunks: [{ start: 0, end: size - 1 }] };
  const count = Math.floor(size / CHUNK);
  if (count > 1000) throw new Error('Video too large for TikTok upload');
  const chunks = Array.from({ length: count }, (_, i) => ({ start: i * CHUNK, end: i === count - 1 ? size - 1 : (i + 1) * CHUNK - 1 }));
  return { chunkSize: CHUNK, chunks };
}
