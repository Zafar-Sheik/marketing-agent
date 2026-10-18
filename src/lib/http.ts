import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { MissingKeyError } from '@/env';
import { verify } from '@/lib/crypto';
import { HttpError } from '@/lib/session';

/** JSON route handler with consistent error responses. */
export function route<Args extends unknown[]>(handler: (...args: Args) => Promise<Response | unknown>) {
  return async (...args: Args): Promise<Response> => {
    try {
      const result = await handler(...args);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (e) {
      if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')) throw e;
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: 'Invalid request', issues: e.issues }, { status: 400 });
      if (e instanceof MissingKeyError) return NextResponse.json({ error: e.message }, { status: 503 });
      console.error(e);
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Internal error' }, { status: 500 });
    }
  };
}

/** Read and verify a body signed by n8n (or anything holding N8N_WEBHOOK_SECRET). */
export async function signedJson<T>(req: Request): Promise<T> {
  const raw = await req.text();
  if (!verify(raw, req.headers.get('x-signature'), req.headers.get('x-timestamp'))) {
    throw new HttpError(401, 'Invalid signature');
  }
  return JSON.parse(raw) as T;
}
