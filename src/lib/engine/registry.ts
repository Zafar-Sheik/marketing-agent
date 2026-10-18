import { brandTraining } from '@/lib/workflows/brand-training';
import { monthlyPlan } from '@/lib/workflows/monthly-plan';
import { creativeProduction } from '@/lib/workflows/creative-production';
import { adsPropose, adsLaunch, organicPublish } from '@/lib/workflows/distribution';
import { optimise } from '@/lib/workflows/optimise';
import { logoDesign } from '@/lib/workflows/logo-design';
import { monthlyReport } from '@/lib/workflows/monthly-report';
import type { WorkflowDef } from './types';

export const workflows = {
  'brand-training': brandTraining,
  'monthly-plan': monthlyPlan,
  'creative-production': creativeProduction,
  'ads-propose': adsPropose,
  'ads-launch': adsLaunch,
  'organic-publish': organicPublish,
  optimise,
  'logo-design': logoDesign,
  'monthly-report': monthlyReport,
} satisfies Record<string, WorkflowDef>;

export type WorkflowName = keyof typeof workflows;
