import { env } from '@/env';
import { claude } from './claude';
import { openaiEmbeddings, openaiImages } from './openai';
import { runway, elevenlabs, creatomate, tavily, resend } from './media';
import { s3Storage, localStorage } from './storage';
import { mockProviders } from './mock';
import type { Providers } from './types';

export type { Providers } from './types';

let current: Providers | undefined;

export function providers(): Providers {
  if (current) return current;
  const e = env();
  // Without AWS keys in development, files go to .data/storage so uploads still work.
  const storage = e.AWS_ACCESS_KEY_ID ? s3Storage : localStorage();
  current = e.MOCK_PROVIDERS
    ? mockProviders(storage)
    : {
        llm: claude,
        embeddings: openaiEmbeddings,
        images: openaiImages,
        video: runway,
        voice: elevenlabs,
        editor: creatomate,
        research: tavily,
        storage,
        mail: resend,
      };
  return current;
}

/** Tests swap in their own providers. */
export function setProviders(next: Providers | undefined) {
  current = next;
}

/** Download a provider result (https or data: URL). */
export async function download(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  if (url.startsWith('data:')) {
    const [, mimeType, data] = url.match(/^data:([^;,]+)(?:;base64)?,(.*)$/s) ?? [];
    if (!mimeType) throw new Error('Bad data URL');
    return { bytes: Buffer.from(data, 'base64'), mimeType };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get('content-type') ?? 'application/octet-stream' };
}
