import OpenAI from 'openai';
import { env, requireKey } from '@/env';
import { EMBEDDING_DIMENSIONS } from '@/db/schema';
import type { Embeddings, ImageGenerator } from './types';

let client: OpenAI | undefined;
const openai = () => (client ??= new OpenAI({ apiKey: requireKey('OPENAI_API_KEY') }));

export const openaiEmbeddings: Embeddings = {
  async embed(texts) {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const res = await openai().embeddings.create({
        model: env().OPENAI_EMBEDDING_MODEL,
        input: texts.slice(i, i + 100),
        dimensions: EMBEDDING_DIMENSIONS,
      });
      out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  },
};

export const openaiImages: ImageGenerator = {
  async generate(prompt, { size, transparent }) {
    const res = await openai().images.generate({
      model: env().OPENAI_IMAGE_MODEL,
      prompt,
      size,
      background: transparent ? 'transparent' : 'opaque',
      output_format: 'png',
      n: 1,
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error('Image generation returned no image.');
    return { bytes: Buffer.from(b64, 'base64'), mimeType: 'image/png' };
  },
};
