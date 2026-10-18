import type { z } from 'zod';

export type ImageInput = { url: string } | { base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' };

export type StructuredRequest<S extends z.ZodType> = {
  /** Stable instructions (cached). */
  system: string;
  /** The task, including retrieved brand context. */
  prompt: string;
  schema: S;
  images?: ImageInput[];
  /** `fast` uses ANTHROPIC_FAST_MODEL for cheap, high-volume work. */
  tier?: 'smart' | 'fast';
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Deterministic stand-in used when MOCK_PROVIDERS=true. */
  mock: () => z.infer<S>;
};

export type LlmResult<T> = { data: T; costCents: number; model: string };

export interface Llm {
  structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<LlmResult<z.infer<S>>>;
}

export interface Embeddings {
  embed(texts: string[]): Promise<number[][]>;
}

export interface ImageGenerator {
  generate(prompt: string, opts: { size: '1024x1024' | '1024x1536' | '1536x1024'; transparent?: boolean }): Promise<{
    bytes: Buffer;
    mimeType: 'image/png';
  }>;
}

export type JobStatus = { status: 'pending' | 'succeeded' | 'failed'; url?: string; error?: string };

export interface VideoGenerator {
  /** Animate a key frame into a vertical clip. */
  start(input: { imageUrl: string; prompt: string; durationSeconds: 5 | 10 }): Promise<{ jobId: string }>;
  get(jobId: string): Promise<JobStatus>;
}

export interface VoiceGenerator {
  speak(text: string, voiceId?: string): Promise<{ bytes: Buffer; mimeType: 'audio/mpeg' }>;
}

export interface Editor {
  /** Creatomate RenderScript JSON. */
  render(source: Record<string, unknown>): Promise<{ jobId: string }>;
  get(jobId: string): Promise<JobStatus>;
}

export type SearchResult = { title: string; url: string; content: string };

export interface Research {
  search(query: string, opts?: { maxResults?: number; days?: number }): Promise<SearchResult[]>;
  extract(urls: string[]): Promise<{ url: string; content: string }[]>;
}

export interface Storage {
  bucket: string;
  put(key: string, body: Buffer | string, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<{ bytes: number; mimeType: string } | null>;
  presignPut(key: string, mimeType: string, bytes: number): Promise<string>;
  presignGet(key: string, ttlSeconds?: number): Promise<string>;
}

export interface Mailer {
  send(input: { to: string[]; subject: string; html: string }): Promise<void>;
}

export type Providers = {
  llm: Llm;
  embeddings: Embeddings;
  images: ImageGenerator;
  video: VideoGenerator;
  voice: VoiceGenerator;
  editor: Editor;
  research: Research;
  storage: Storage;
  mail: Mailer;
};
