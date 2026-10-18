import { z } from 'zod';

/** TikTok Marketing API enums. */
export const AGE_GROUPS = ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'] as const;
export const GENDERS = ['GENDER_MALE', 'GENDER_FEMALE', 'GENDER_UNLIMITED'] as const;

/**
 * Characteristics TikTok's ad policy (and most privacy law) forbids targeting on.
 * Any segment mentioning these in its targeting fields is rejected before it reaches TikTok.
 */
export const SENSITIVE_TERMS = [
  'religion',
  'religious',
  'faith',
  'muslim',
  'christian',
  'jewish',
  'hindu',
  'buddhist',
  'sikh',
  'atheist',
  'ethnicity',
  'race',
  'sexual orientation',
  'gay',
  'lesbian',
  'political',
  'health condition',
  'disability',
  'pregnant',
  'pregnancy',
  'financial hardship',
] as const;

export const audienceSegmentSchema = z.object({
  name: z.string().min(1),
  ageGroups: z.array(z.enum(AGE_GROUPS)).min(1),
  genders: z.array(z.enum(GENDERS)).min(1),
  /** TikTok location ids (from /tool/region/). */
  locationIds: z.array(z.string().regex(/^\d+$/)).min(1),
  languages: z.array(z.string().regex(/^[a-z]{2}$/)).default([]),
  interestCategoryIds: z.array(z.string().regex(/^\d+$/)).default([]),
  actionCategoryIds: z.array(z.string().regex(/^\d+$/)).default([]),
  hashtagIds: z.array(z.string().regex(/^\d+$/)).default([]),
  /** Human-readable interests, kept for the report. */
  interestLabels: z.array(z.string()).default([]),
  rationale: z.string().min(1),
});
export type AudienceSegment = z.infer<typeof audienceSegmentSchema>;

export class SensitiveTargetingError extends Error {
  constructor(public readonly term: string) {
    super(
      `Targeting on "${term}" is not allowed: TikTok prohibits targeting by religion and other sensitive characteristics. ` +
        'Reach these audiences through creative, language, timing and location instead.',
    );
    this.name = 'SensitiveTargetingError';
  }
}

/** Ages from a free-form range, e.g. 21-40 -> AGE_18_24, AGE_25_34, AGE_35_44. Never below 18. */
export function ageGroupsForRange(min: number, max: number): (typeof AGE_GROUPS)[number][] {
  const bounds: [number, number, (typeof AGE_GROUPS)[number]][] = [
    [18, 24, 'AGE_18_24'],
    [25, 34, 'AGE_25_34'],
    [35, 44, 'AGE_35_44'],
    [45, 54, 'AGE_45_54'],
    [55, 200, 'AGE_55_100'],
  ];
  const lo = Math.max(18, min);
  return bounds.filter(([a, b]) => b >= lo && a <= max).map(([, , g]) => g);
}

export function assertNoSensitiveTargeting(segment: Pick<AudienceSegment, 'name' | 'interestLabels'>) {
  const haystack = [segment.name, ...segment.interestLabels].join(' ');
  const hit = SENSITIVE_TERMS.find((t) => new RegExp(`\\b${t}\\b`, 'i').test(haystack));
  if (hit) throw new SensitiveTargetingError(hit);
}

/** Validated segment -> the `targeting` fields of a TikTok /adgroup/create request. */
export function toTikTokTargeting(input: AudienceSegment) {
  const segment = audienceSegmentSchema.parse(input);
  assertNoSensitiveTargeting(segment);
  const genders = segment.genders.includes('GENDER_UNLIMITED') || segment.genders.length > 1 ? 'GENDER_UNLIMITED' : segment.genders[0];
  return {
    location_ids: segment.locationIds,
    age_groups: segment.ageGroups,
    gender: genders,
    ...(segment.languages.length ? { languages: segment.languages } : {}),
    ...(segment.interestCategoryIds.length ? { interest_category_ids: segment.interestCategoryIds } : {}),
    ...(actions(segment).length ? { actions: actions(segment) } : {}),
  };
}

/** Behaviour targeting: people who engaged with similar videos or followed hashtags. */
function actions(segment: AudienceSegment) {
  const list: Record<string, unknown>[] = [];
  if (segment.actionCategoryIds.length) {
    list.push({
      action_scene: 'VIDEO_RELATED',
      action_period: 15,
      video_user_actions: ['WATCHED_TO_END', 'LIKED', 'COMMENTED', 'SHARED'],
      action_category_ids: segment.actionCategoryIds,
    });
  }
  if (segment.hashtagIds.length) {
    list.push({
      action_scene: 'HASHTAG_RELATED',
      action_period: 15,
      video_user_actions: ['VIEW_HASHTAG'],
      action_category_ids: segment.hashtagIds,
    });
  }
  return list;
}
