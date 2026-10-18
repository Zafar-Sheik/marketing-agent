'use client';
import { useState } from 'react';
import { createCompanyAction } from '@/app/actions';
import { ActionForm } from '@/components/app/action-form';
import { ColorList } from '@/components/app/color-list';
import { Card } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

const STEPS = ['Company', 'Brand identity', 'Voice & audience', 'Budget'];

/** Multi-step wizard; every step stays mounted so one submit sends everything. */
export function NewCompanyForm() {
  const [step, setStep] = useState(0);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <ActionForm action={createCompanyAction} submit="Create client" className="space-y-6">
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => setStep(i)} className={cn('rounded-full border px-3 py-1 text-xs', i === step ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted')}>
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>
      <Card className={cn('grid gap-4 md:grid-cols-2', step !== 0 && 'hidden')}>
        <Field label="Company name" className="md:col-span-2">
          <input name="name" required className="field" placeholder="Kauai Cafe" />
        </Field>
        <Field label="Industry">
          <input name="industry" className="field" placeholder="Food & Beverage" />
        </Field>
        <Field label="Website">
          <input name="websiteUrl" className="field" placeholder="kauai.co.za" />
        </Field>
        <Field label="What the company does" className="md:col-span-2">
          <textarea name="description" rows={4} className="field" placeholder="Products, locations, what makes them different…" />
        </Field>
        <Field label="Country (ISO code)">
          <input name="country" maxLength={2} className="field uppercase" placeholder="ZA" />
        </Field>
        <Field label="Timezone">
          <input name="timezone" defaultValue={tz} className="field" />
        </Field>
      </Card>
      <Card className={cn('grid gap-4', step !== 1 && 'hidden')}>
        <Field label="Primary colours">
          <ColorList name="primaryColors" initial={['#0F766E']} />
        </Field>
        <Field label="Secondary colours">
          <ColorList name="secondaryColors" />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Heading font">
            <input name="headingFont" className="field" placeholder="Montserrat" />
          </Field>
          <Field label="Body font">
            <input name="bodyFont" className="field" placeholder="Inter" />
          </Field>
        </div>
        <p className="text-xs text-muted">You’ll upload the logo and portfolio on the next screen.</p>
      </Card>
      <Card className={cn('grid gap-4 md:grid-cols-2', step !== 2 && 'hidden')}>
        <Field label="Tone of voice" className="md:col-span-2">
          <input name="toneOfVoice" className="field" placeholder="Warm, playful, never pushy" />
        </Field>
        <Field label="Values (one per line)">
          <textarea name="brandValues" rows={3} className="field" placeholder={'Fresh\nLocal\nHonest'} />
        </Field>
        <Field label="Competitors (one per line)">
          <textarea name="competitors" rows={3} className="field" />
        </Field>
        <Field label="What makes them different" className="md:col-span-2">
          <input name="usp" className="field" />
        </Field>
        <Field label="Target audience" className="md:col-span-2">
          <input name="targetAudience" className="field" placeholder="Health-conscious 20–35 year olds in Cape Town" />
        </Field>
        <Field label="Always do (one per line)">
          <textarea name="dos" rows={3} className="field" />
        </Field>
        <Field label="Never do (one per line)">
          <textarea name="donts" rows={3} className="field" />
        </Field>
      </Card>
      <Card className={cn('grid gap-4 md:grid-cols-2', step !== 3 && 'hidden')}>
        <Field label="Currency">
          <input name="currency" defaultValue="USD" maxLength={3} className="field uppercase" />
        </Field>
        <Field label="Default monthly ad budget">
          <input name="budget" inputMode="decimal" className="field" placeholder="15000" />
        </Field>
        <p className="text-xs text-muted md:col-span-2">This is a hard ceiling: the agents never commit more than this to TikTok ads in a month. You can change it per month when setting goals.</p>
      </Card>
      <div className="flex gap-2">
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)} className="text-sm text-muted hover:text-fg">
            ← Back
          </button>
        )}
        {step < STEPS.length - 1 && (
          <button type="button" onClick={() => setStep(step + 1)} className="ml-auto text-sm text-accent hover:underline">
            Next: {STEPS[step + 1]} →
          </button>
        )}
      </div>
    </ActionForm>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
