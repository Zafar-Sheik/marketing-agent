import { route, signedJson } from '@/lib/http';
import { HttpError } from '@/lib/session';
import { runCron } from '@/lib/services/cron';

export const maxDuration = 300;

/** Scheduled jobs, triggered by n8n Schedule nodes. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ job: string }> }) => {
  await signedJson(req);
  const { job } = await params;
  if (job !== 'produce' && job !== 'optimise' && job !== 'monthly-reports') throw new HttpError(404, `Unknown job ${job}`);
  return runCron(job);
});
