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
    async publishVideo({ videoUrl, caption, privacyLevel }) {
      const d = await call<{ publish_id: string }>('/post/publish/video/init/', {
        post_info: { title: caption.slice(0, 2200), privacy_level: privacyLevel, disable_comment: false, disable_duet: false, disable_stitch: false },
        // PULL_FROM_URL requires the bucket's domain to be verified in the TikTok developer portal.
        source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
      });
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
