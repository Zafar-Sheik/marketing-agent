import { NextResponse } from 'next/server';
import { env } from '@/env';
import { verify } from '@/lib/crypto';
import { providers } from '@/lib/providers';

/** Serves the local-disk storage used when no AWS keys are configured (development only). */
async function check(req: Request, key: string, method: 'GET' | 'PUT') {
  if (env().AWS_ACCESS_KEY_ID || env().NODE_ENV === 'production') return 'Local storage is disabled.';
  const url = new URL(req.url);
  const exp = url.searchParams.get('exp');
  const sig = url.searchParams.get('sig');
  if (!verify(`${method}:${key}`, sig ? `sha256=${sig}` : null, exp, Number(exp) * 1000)) return 'Bad signature';
  if (Number(exp) < Date.now() / 1000) return 'Expired';
  return null;
}

type Ctx = { params: Promise<{ key: string[] }> };

export async function GET(req: Request, { params }: Ctx) {
  const key = (await params).key.map(decodeURIComponent).join('/');
  const error = await check(req, key, 'GET');
  if (error) return NextResponse.json({ error }, { status: 403 });
  const storage = providers().storage;
  const head = await storage.head(key);
  if (!head) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new Response(new Uint8Array(await storage.get(key)), { headers: { 'content-type': head.mimeType, 'cache-control': 'private, max-age=300' } });
}

export async function PUT(req: Request, { params }: Ctx) {
  const key = (await params).key.map(decodeURIComponent).join('/');
  const error = await check(req, key, 'PUT');
  if (error) return NextResponse.json({ error }, { status: 403 });
  const bytes = Buffer.from(await req.arrayBuffer());
  await providers().storage.put(key, bytes, req.headers.get('content-type') ?? 'application/octet-stream');
  return new Response(null, { status: 200 });
}
