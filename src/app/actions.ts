'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@/db';
import { signOut } from '@/auth';
import { requireCompany, requireUser, canEdit, HttpError } from '@/lib/session';
import { brandInput, companyInput, createCompany, createNewBrandVersion, startTraining } from '@/lib/services/companies';
import { decide } from '@/lib/services/approvals';
import { regenerateCreative } from '@/lib/services/transitions';
import { selectLogo } from '@/lib/services/logos';
import { fulfilRequest } from '@/lib/services/requests';
import { startWorkflow } from '@/lib/engine/runs';
import { monthStart, weekStart } from '@/lib/domain/dates';
import { parseMoneyToCents } from '@/lib/domain/money';

export type ActionState = { error?: string; ok?: string } | undefined;

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? '')
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
const str = (v: FormDataEntryValue | null) => (v == null || String(v).trim() === '' ? undefined : String(v).trim());

async function guard<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e; // redirects
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
    return { error: e instanceof Error ? e.message : 'Something went wrong' };
  }
}

async function editor(companyId: string) {
  const ctx = await requireCompany(companyId);
  if (!canEdit(ctx.role)) throw new HttpError(403, 'You have view-only access.');
  return ctx;
}

// ------------------------------------------------------------------ companies & brand
export async function createCompanyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { db, workspace, user, role } = await requireUser();
  if (!canEdit(role)) return { error: 'You have view-only access.' };
  const result = await guard(() =>
    createCompany(
      db,
      workspace.id,
      user.id,
      {
        name: String(form.get('name') ?? ''),
        industry: str(form.get('industry')),
        websiteUrl: str(form.get('websiteUrl')),
        description: str(form.get('description')),
        headquartersCountry: str(form.get('country')),
        timezone: str(form.get('timezone')) ?? 'UTC',
        currency: str(form.get('currency')) ?? 'USD',
        monthlyAdBudgetCents: form.get('budget') ? parseMoneyToCents(String(form.get('budget'))) : 0,
      },
      {
        primaryColors: form.getAll('primaryColors').map(String),
        secondaryColors: form.getAll('secondaryColors').map(String),
        headingFont: str(form.get('headingFont')),
        bodyFont: str(form.get('bodyFont')),
        toneOfVoice: str(form.get('toneOfVoice')),
        brandValues: lines(form.get('brandValues')),
        usp: str(form.get('usp')),
        targetAudience: str(form.get('targetAudience')),
        competitors: lines(form.get('competitors')),
        dos: lines(form.get('dos')),
        donts: lines(form.get('donts')),
      },
    ),
  );
  if ('error' in result) return result;
  redirect(`/companies/${result.slug}/onboarding`);
}

export async function updateBrandAction(companyId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { db } = await editor(companyId);
  const result = await guard(async () => {
    const b = brandInput.parse({
      primaryColors: form.getAll('primaryColors').map(String),
      secondaryColors: form.getAll('secondaryColors').map(String),
      headingFont: str(form.get('headingFont')),
      bodyFont: str(form.get('bodyFont')),
      toneOfVoice: str(form.get('toneOfVoice')),
      brandValues: lines(form.get('brandValues')),
      usp: str(form.get('usp')),
      targetAudience: str(form.get('targetAudience')),
      competitors: lines(form.get('competitors')),
      dos: lines(form.get('dos')),
      donts: lines(form.get('donts')),
    });
    const { headingFont, bodyFont, ...rest } = b;
    return createNewBrandVersion(db, companyId, {
      ...rest,
      fonts: [
        ...(headingFont ? [{ family: headingFont, role: 'heading' as const }] : []),
        ...(bodyFont ? [{ family: bodyFont, role: 'body' as const }] : []),
      ],
      brandSummary: str(form.get('brandSummary')),
    });
  });
  if ('error' in result) return result;
  revalidatePath('/companies', 'layout');
  return { ok: `Saved as brand version ${result.version}.` };
}

export async function updateCompanyAction(companyId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { db } = await editor(companyId);
  const result = await guard(async () => {
    const c = companyInput.partial().parse({
      name: str(form.get('name')),
      industry: str(form.get('industry')),
      websiteUrl: str(form.get('websiteUrl')),
      description: str(form.get('description')),
      headquartersCountry: str(form.get('country')),
      timezone: str(form.get('timezone')),
      currency: str(form.get('currency')),
      monthlyAdBudgetCents: form.get('budget') ? parseMoneyToCents(String(form.get('budget'))) : undefined,
    });
    await db.update(schema.companies).set({ ...c, updatedAt: new Date() }).where(eq(schema.companies.id, companyId));
  });
  if (result && 'error' in result) return result;
  revalidatePath('/companies', 'layout');
  return { ok: 'Saved.' };
}

export async function trainAction(companyId: string) {
  const { db, company } = await editor(companyId);
  await startTraining(db, companyId);
  redirect(`/companies/${company.slug}`);
}

export async function disconnectTikTokAction(companyId: string) {
  const { db, company } = await editor(companyId);
  await db.delete(schema.tiktokConnections).where(eq(schema.tiktokConnections.companyId, companyId));
  revalidatePath(`/companies/${company.slug}/settings`);
}

// ------------------------------------------------------------------ monthly cycle
export async function createGoalAction(companyId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { db, company, user } = await editor(companyId);
  const result = await guard(async () => {
    const month = monthStart(String(form.get('month')) + (String(form.get('month')).length === 7 ? '-01' : ''));
    const kpis = lines(form.get('kpis')).map((l) => {
      const [metric, target] = l.split(':').map((s) => s.trim());
      const n = Number((target ?? '').replace(/[^0-9.]/g, ''));
      if (!metric || !Number.isFinite(n) || !target) throw new Error(`KPI "${l}" should look like "followers: 20%"`);
      return { metric, target: n, unit: target.includes('%') ? '%' : undefined };
    });
    const prompt = String(form.get('prompt') ?? '').trim();
    if (prompt.length < 10) throw new Error('Describe the goals in a sentence or two.');
    const [goal] = await db
      .insert(schema.monthlyGoals)
      .values({
        companyId,
        month,
        prompt,
        kpis,
        adBudgetCents: form.get('budget') ? parseMoneyToCents(String(form.get('budget'))) : company.monthlyAdBudgetCents,
        locations: lines(form.get('locations')).map((l) => l.toUpperCase()),
        createdBy: user.id,
      })
      .onConflictDoNothing()
      .returning();
    if (!goal) throw new Error('Goals for that month already exist.');
    await startWorkflow('monthly-plan', { companyId, subjectType: 'monthly_goal', subjectId: goal.id, input: { goalId: goal.id } });
    return goal;
  });
  if ('error' in result) return result;
  redirect(`/companies/${company.slug}/plan/${result.month}`);
}

export async function createRequestAction(companyId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { db, user } = await editor(companyId);
  const result = await guard(async () => {
    const format = z.enum(['short_video', 'image_post', 'carousel']).parse(form.get('format'));
    const prompt = String(form.get('prompt') ?? '').trim();
    if (prompt.length < 5) throw new Error('Describe what you want made.');
    const [request] = await db
      .insert(schema.contentRequests)
      .values({ companyId, weekStart: weekStart(String(form.get('week') || new Date().toISOString().slice(0, 10))), format, prompt, isPaid: form.get('isPaid') === 'on', createdBy: user.id })
      .returning();
    return fulfilRequest(db, request.id);
  });
  if ('error' in result) return result;
  revalidatePath('/companies', 'layout');
  return { ok: result.produced ? 'Added to this month’s plan — production has started.' : 'Saved. It will be included when this month’s plan is made.' };
}

// ------------------------------------------------------------------ approvals & creatives
export async function decideAction(approvalId: string, decision: 'approved' | 'rejected' | 'changes_requested', form?: FormData) {
  const { db, user, workspace, role } = await requireUser();
  if (!canEdit(role)) throw new HttpError(403, 'You have view-only access.');
  const [row] = await db
    .select({ id: schema.approvals.id })
    .from(schema.approvals)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.approvals.companyId))
    .where(and(eq(schema.approvals.id, approvalId), eq(schema.companies.workspaceId, workspace.id)));
  if (!row) throw new HttpError(404, 'Approval not found');
  await decide(db, approvalId, user.id, decision, str(form?.get('comment') ?? null));
  revalidatePath('/', 'layout');
}

export async function regenerateAction(creativeId: string, form: FormData) {
  const { db, workspace, role } = await requireUser();
  if (!canEdit(role)) throw new HttpError(403, 'You have view-only access.');
  const [row] = await db
    .select({ creative: schema.creatives, slug: schema.companies.slug })
    .from(schema.creatives)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.creatives.companyId))
    .where(and(eq(schema.creatives.id, creativeId), eq(schema.companies.workspaceId, workspace.id)));
  if (!row) throw new HttpError(404, 'Creative not found');
  const [pending] = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.subjectId, creativeId), eq(schema.approvals.decision, 'pending')));
  const feedback = str(form.get('feedback')) ?? 'Try a different approach.';
  if (pending) await decideAction(pending.id, 'changes_requested', form);
  else await regenerateCreative(db, creativeId, feedback);
  redirect(`/companies/${row.slug}/creatives`);
}

// ------------------------------------------------------------------ logos & reports
export async function logoRequestAction(companyId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { db, user } = await editor(companyId);
  const result = await guard(async () => {
    const prompt = String(form.get('prompt') ?? '').trim();
    if (prompt.length < 5) throw new Error('Describe the logo you want.');
    const [req] = await db
      .insert(schema.logoRequests)
      .values({ companyId, prompt, styles: form.getAll('styles').map(String), conceptCount: Math.min(8, Math.max(1, Number(form.get('count') ?? 4))), createdBy: user.id })
      .returning();
    await startWorkflow('logo-design', { companyId, subjectType: 'logo_request', subjectId: req.id });
  });
  if (result && 'error' in result) return result;
  revalidatePath('/companies', 'layout');
  return { ok: 'Designing concepts…' };
}

export async function selectLogoAction(companyId: string, logoRequestId: string, creativeId: string) {
  const { db, company } = await editor(companyId);
  await selectLogo(db, logoRequestId, creativeId, companyId);
  revalidatePath(`/companies/${company.slug}`, 'layout');
}

export async function generateReportAction(companyId: string, form: FormData) {
  const { company } = await editor(companyId);
  const month = monthStart(String(form.get('month')) + '-01');
  await startWorkflow('monthly-report', { companyId, subjectType: 'company', subjectId: companyId, input: { month } });
  redirect(`/companies/${company.slug}/reports`);
}

export async function optimiseNowAction(companyId: string) {
  const { company } = await editor(companyId);
  await startWorkflow('optimise', { companyId, subjectType: 'company', subjectId: companyId });
  redirect(`/companies/${company.slug}/ads`);
}

export async function retryCreativeAction(creativeId: string) {
  const { db, workspace } = await requireUser();
  const [row] = await db
    .select({ creative: schema.creatives, slug: schema.companies.slug })
    .from(schema.creatives)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.creatives.companyId))
    .where(and(eq(schema.creatives.id, creativeId), eq(schema.companies.workspaceId, workspace.id)));
  if (!row) throw new HttpError(404, 'Creative not found');
  await db.update(schema.creatives).set({ status: 'queued', feedback: null }).where(eq(schema.creatives.id, creativeId));
  await startWorkflow('creative-production', { companyId: row.creative.companyId, subjectType: 'creative', subjectId: creativeId });
  redirect(`/companies/${row.slug}/creatives/${creativeId}`);
}

// ------------------------------------------------------------------ workspace
export async function setAutopilotAction(form: FormData) {
  const { db, workspace, role } = await requireUser();
  if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Only owners and admins can change autopilot.');
  await db.update(schema.workspaces).set({ autopilot: form.get('autopilot') === 'on' }).where(eq(schema.workspaces.id, workspace.id));
  revalidatePath('/settings');
}

export async function signOutAction() {
  await signOut({ redirectTo: '/' });
}
