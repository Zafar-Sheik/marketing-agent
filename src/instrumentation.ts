/**
 * Inline mode (no n8n): a tiny in-process scheduler that does what n8n's scheduler and Wait
 * nodes do in production: wake sleeping runs, produce due content, optimise, write reports.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { env } = await import('@/env');
  if (env().DISPATCH_MODE !== 'inline') return;
  const { resumeDueRuns } = await import('@/lib/engine/runs');
  const { runCron } = await import('@/lib/services/cron');
  let lastHourly = 0;
  const tick = async () => {
    try {
      await resumeDueRuns();
      if (Date.now() - lastHourly > 3600_000) {
        lastHourly = Date.now();
        // All three are idempotent: produce skips items that have content, optimise and reports are keyed per day/month.
        await runCron('produce');
        await runCron('optimise');
        await runCron('monthly-reports');
      }
    } catch (e) {
      console.error('[inline scheduler]', e);
    }
  };
  setInterval(tick, 15_000).unref();
}
