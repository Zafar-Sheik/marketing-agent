export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'company'
  );
}

/**
 * Split text into overlapping chunks for embedding, preferring paragraph and
 * sentence boundaries. Sizes are in characters (~4 chars per token).
 */
export function chunkText(text: string, maxChars = 3200, overlapChars = 400): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
      if (cut > maxChars * 0.5) end = start + cut + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks.filter(Boolean);
}

export function normalizeHex(input: string): string {
  const v = input.trim().replace(/^#?/, '#').toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (!/^#[0-9A-F]{6}$/.test(v)) throw new Error(`Not a hex colour: ${input}`);
  return v;
}

/** WCAG contrast ratio between two hex colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(normalizeHex(hex).slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Best text colour (near-black or white) on a brand background. */
export function readableTextOn(bg: string): '#0B0B0F' | '#FFFFFF' {
  return contrastRatio(bg, '#FFFFFF') >= contrastRatio(bg, '#0B0B0F') ? '#FFFFFF' : '#0B0B0F';
}
