import { deflateSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS } from '@/db/schema';
import type { Providers, Storage } from './types';

/**
 * Offline providers: deterministic, free, and never touch TikTok or spend money.
 * Used by tests and by `MOCK_PROVIDERS=true` for clicking through the app without keys.
 */
export function mockProviders(storage: Storage): Providers & { sentMail: { to: string[]; subject: string; html: string }[] } {
  const sentMail: { to: string[]; subject: string; html: string }[] = [];
  return {
    sentMail,
    llm: {
      async structured(req) {
        return { data: req.schema.parse(req.mock()), costCents: 0, model: 'mock' };
      },
    },
    embeddings: { embed: async (texts) => texts.map(hashEmbedding) },
    images: {
      async generate(prompt) {
        return { bytes: solidPng(colorFrom(prompt), 108, 192), mimeType: 'image/png' };
      },
    },
    video: {
      start: async ({ prompt }) => ({ jobId: `mock-video-${hash(prompt).slice(0, 12)}` }),
      get: async (jobId) => ({ status: 'succeeded', url: pngDataUrl(colorFrom(jobId)) }),
    },
    voice: { speak: async () => ({ bytes: Buffer.from('ID3mock-voiceover'), mimeType: 'audio/mpeg' }) },
    editor: {
      render: async (source) => ({ jobId: `mock-render-${hash(JSON.stringify(source)).slice(0, 12)}` }),
      get: async (jobId) => ({ status: 'succeeded', url: pngDataUrl(colorFrom(jobId)) }),
    },
    research: {
      async search(query) {
        return [1, 2, 3].map((n) => ({
          title: `${query} — insight ${n}`,
          url: `https://example.com/research/${hash(query).slice(0, 8)}/${n}`,
          content: `Mock finding ${n} for "${query}": short vertical videos with a strong first-second hook outperform.`,
        }));
      },
      async extract(urls) {
        return urls.map((url) => ({ url, content: `Mock page content for ${url}. The brand is friendly and modern.` }));
      },
    },
    storage,
    mail: {
      async send(msg) {
        sentMail.push(msg);
        console.info(`[mock email] to=${msg.to.join(',')} subject="${msg.subject}"`);
      },
    },
  };
}

function hash(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

/** Bag-of-words hashing embedding: similar texts get similar vectors, good enough for tests. */
export function hashEmbedding(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const h = createHash('md5').update(word).digest();
    v[h.readUInt32BE(0) % EMBEDDING_DIMENSIONS] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

function colorFrom(seed: string): [number, number, number] {
  const h = createHash('md5').update(seed).digest();
  return [h[0], h[1], h[2]];
}

/** Minimal valid PNG of one colour. */
export function solidPng([r, g, b]: [number, number, number], width: number, height: number): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngDataUrl(color: [number, number, number]) {
  return `data:image/png;base64,${solidPng(color, 108, 192).toString('base64')}`;
}
