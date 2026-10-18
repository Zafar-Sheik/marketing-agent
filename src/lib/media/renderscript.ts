import { readableTextOn } from '@/lib/domain/text';

export type BrandStyle = {
  primary: string;
  secondary?: string;
  headingFont: string;
  bodyFont: string;
  logoUrl?: string;
};

export type VideoScene = { clipUrl: string; durationSeconds: number; onScreenText?: string };

/**
 * Creatomate RenderScript for a 1080x1920 TikTok video: scene clips back to back,
 * captions in brand colours, voice-over, logo bug and a branded end card with the CTA.
 */
export function videoComposition(input: {
  scenes: VideoScene[];
  voiceoverUrl?: string;
  callToAction: string;
  brand: BrandStyle;
}): Record<string, unknown> {
  const { brand } = input;
  const captionText = readableTextOn(brand.primary);
  const elements: Record<string, unknown>[] = [];
  let t = 0;
  for (const scene of input.scenes) {
    elements.push({ type: 'video', track: 1, time: t, duration: scene.durationSeconds, source: scene.clipUrl, fit: 'cover' });
    if (scene.onScreenText) {
      elements.push({
        type: 'text',
        track: 2,
        time: t,
        duration: scene.durationSeconds,
        text: scene.onScreenText,
        y: '72%',
        width: '86%',
        x_alignment: '50%',
        font_family: brand.headingFont,
        font_weight: '800',
        font_size: '6.5 vmin',
        fill_color: captionText,
        background_color: brand.primary,
        background_x_padding: '30%',
        background_y_padding: '18%',
        background_border_radius: '20%',
        animations: [{ time: 'start', duration: 0.3, type: 'text-appear', split: 'word' }],
      });
    }
    t += scene.durationSeconds;
  }
  const endCard = 2.5;
  elements.push(
    { type: 'shape', track: 1, time: t, duration: endCard, path: 'M 0 0 L 100 0 L 100 100 L 0 100 Z', fill_color: brand.primary },
    {
      type: 'text',
      track: 2,
      time: t,
      duration: endCard,
      text: input.callToAction,
      y: '62%',
      width: '80%',
      font_family: brand.headingFont,
      font_weight: '800',
      font_size: '8 vmin',
      fill_color: captionText,
      animations: [{ time: 'start', duration: 0.4, type: 'scale', start_scale: '80%' }],
    },
  );
  if (brand.logoUrl) {
    elements.push(
      { type: 'image', track: 3, time: 0, duration: t, source: brand.logoUrl, x: '88%', y: '7%', width: '14%', height: '8%', fit: 'contain', opacity: '90%' },
      { type: 'image', track: 4, time: t, duration: endCard, source: brand.logoUrl, y: '40%', width: '40%', height: '22%', fit: 'contain' },
    );
  }
  if (input.voiceoverUrl) elements.push({ type: 'audio', track: 5, time: 0, source: input.voiceoverUrl, audio_fade_out: 0.5 });
  return { output_format: 'mp4', width: 1080, height: 1920, frame_rate: 30, duration: t + endCard, elements };
}

/** One 1080x1920 PNG slide: generated background, headline and body in brand style. */
export function slideComposition(input: { backgroundUrl: string; headline: string; body?: string; brand: BrandStyle; index: number; total: number }) {
  const { brand } = input;
  const text = readableTextOn(brand.primary);
  const elements: Record<string, unknown>[] = [
    { type: 'image', source: input.backgroundUrl, fit: 'cover' },
    { type: 'shape', path: 'M 0 60 L 100 60 L 100 100 L 0 100 Z', fill_color: brand.primary, opacity: '92%' },
    { type: 'text', text: input.headline, y: '72%', width: '86%', font_family: brand.headingFont, font_weight: '800', font_size: '7 vmin', fill_color: text },
  ];
  if (input.body) {
    elements.push({ type: 'text', text: input.body, y: '86%', width: '84%', font_family: brand.bodyFont, font_size: '4.2 vmin', fill_color: text });
  }
  if (input.total > 1) {
    elements.push({ type: 'text', text: `${input.index + 1}/${input.total}`, x: '90%', y: '5%', font_family: brand.bodyFont, font_size: '3.5 vmin', fill_color: '#FFFFFF' });
  }
  if (brand.logoUrl) elements.push({ type: 'image', source: brand.logoUrl, x: '12%', y: '6%', width: '16%', height: '8%', fit: 'contain' });
  return { output_format: 'png', width: 1080, height: 1920, elements };
}
