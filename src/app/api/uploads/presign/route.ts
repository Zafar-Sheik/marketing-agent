import { z } from 'zod';
import { env } from '@/env';
import { route } from '@/lib/http';
import { providers } from '@/lib/providers';
import { HttpError, requireCompany } from '@/lib/session';
import { extFor } from '@/lib/assets';

const ALLOWED = /^(image\/(png|jpeg|webp|gif|svg\+xml)|video\/(mp4|quicktime|webm)|application\/pdf|text\/(plain|markdown)|font\/(ttf|otf|woff2?))$/;

const body = z.object({
  companyId: z.string().uuid(),
  filename: z.string().min(1).max(200),
  mimeType: z.string(),
  bytes: z.number().int().positive(),
  purpose: z.enum(['portfolio', 'logo', 'font']),
});

/** Browser uploads go straight to S3 with a short-lived signed URL. */
export const POST = route(async (req: Request) => {
  const input = body.parse(await req.json());
  const { company } = await requireCompany(input.companyId);
  if (!ALLOWED.test(input.mimeType)) throw new HttpError(415, `Files of type ${input.mimeType} are not supported.`);
  if (input.bytes > env().S3_MAX_UPLOAD_MB * 1024 * 1024) throw new HttpError(413, `Files must be under ${env().S3_MAX_UPLOAD_MB} MB.`);
  const safe = input.filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 60) || 'file';
  const key = `companies/${company.id}/${input.purpose}/${Date.now()}-${safe}.${extFor(input.mimeType) === 'bin' ? input.filename.split('.').pop() : extFor(input.mimeType)}`;
  const url = await providers().storage.presignPut(key, input.mimeType, input.bytes);
  return { url, key, headers: { 'content-type': input.mimeType } };
});
