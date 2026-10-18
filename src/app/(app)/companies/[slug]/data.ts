import { cache } from 'react';
import { notFound } from 'next/navigation';
import { HttpError, requireCompany } from '@/lib/session';

/** Company for a page, 404 if it isn't in the user's workspace. Cached per request. */
export const getCompany = cache(async (slug: string) => {
  try {
    return await requireCompany(slug);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
});
