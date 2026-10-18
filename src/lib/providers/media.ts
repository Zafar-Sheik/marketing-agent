import { env, requireKey } from '@/env';
import { http } from './http';
import type { Editor, JobStatus, Research, VideoGenerator, VoiceGenerator, Mailer } from './types';

// ------------------------------------------------------------------ Runway (video)
const RUNWAY = 'https://api.dev.runwayml.com/v1';
const runwayHeaders = () => ({ authorization: `Bearer ${requireKey('RUNWAY_API_KEY')}`, 'X-Runway-Version': '2024-11-06' });

export const runway: VideoGenerator = {
  async start({ imageUrl, prompt, durationSeconds }) {
    const res = await http<{ id: string }>('runway', `${RUNWAY}/image_to_video`, {
      method: 'POST',
      headers: runwayHeaders(),
      json: { model: 'gen4_turbo', promptImage: imageUrl, promptText: prompt.slice(0, 1000), ratio: '720:1280', duration: durationSeconds },
    });
    return { jobId: res.id };
  },
  async get(jobId) {
    const res = await http<{ status: string; output?: string[]; failure?: string }>('runway', `${RUNWAY}/tasks/${jobId}`, {
      headers: runwayHeaders(),
    });
    return mapStatus(res.status, res.output?.[0], res.failure);
  },
};

// ------------------------------------------------------------------ ElevenLabs (voice)
export const elevenlabs: VoiceGenerator = {
  async speak(text, voiceId = env().ELEVENLABS_DEFAULT_VOICE_ID) {
    const bytes = await http<Buffer>('elevenlabs', `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': requireKey('ELEVENLABS_API_KEY'), accept: 'audio/mpeg' },
      json: { text, model_id: 'eleven_multilingual_v2' },
    });
    return { bytes, mimeType: 'audio/mpeg' };
  },
};

// ------------------------------------------------------------------ Creatomate (editing/render)
const CREATOMATE = 'https://api.creatomate.com/v1';
const creatomateHeaders = () => ({ authorization: `Bearer ${requireKey('CREATOMATE_API_KEY')}` });

export const creatomate: Editor = {
  async render(source) {
    const res = await http<{ id: string }[] | { id: string }>('creatomate', `${CREATOMATE}/renders`, {
      method: 'POST',
      headers: creatomateHeaders(),
      json: { source },
    });
    return { jobId: Array.isArray(res) ? res[0].id : res.id };
  },
  async get(jobId) {
    const res = await http<{ status: string; url?: string; error_message?: string }>('creatomate', `${CREATOMATE}/renders/${jobId}`, {
      headers: creatomateHeaders(),
    });
    return mapStatus(res.status, res.url, res.error_message);
  },
};

// ------------------------------------------------------------------ Tavily (research)
export const tavily: Research = {
  async search(query, { maxResults = 8, days } = {}) {
    const res = await http<{ results: { title: string; url: string; content: string }[] }>('tavily', 'https://api.tavily.com/search', {
      method: 'POST',
      headers: { authorization: `Bearer ${requireKey('TAVILY_API_KEY')}` },
      json: { query, search_depth: 'advanced', max_results: maxResults, ...(days ? { topic: 'news', days } : {}) },
    });
    return res.results.map(({ title, url, content }) => ({ title, url, content }));
  },
  async extract(urls) {
    if (!urls.length) return [];
    const res = await http<{ results: { url: string; raw_content: string }[] }>('tavily', 'https://api.tavily.com/extract', {
      method: 'POST',
      headers: { authorization: `Bearer ${requireKey('TAVILY_API_KEY')}` },
      json: { urls: urls.slice(0, 20) },
    });
    return res.results.map((r) => ({ url: r.url, content: r.raw_content }));
  },
};

// ------------------------------------------------------------------ Resend (email)
export const resend: Mailer = {
  async send({ to, subject, html }) {
    await http('resend', 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${requireKey('RESEND_API_KEY')}` },
      json: { from: env().EMAIL_FROM, to, subject, html },
    });
  },
};

export function mapStatus(status: string, url?: string, error?: string): JobStatus {
  const s = status.toLowerCase();
  if (s === 'succeeded') return { status: 'succeeded', url };
  if (s === 'failed' || s === 'cancelled') return { status: 'failed', error: error ?? s };
  return { status: 'pending' };
}
