import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.2 AA: 4.5:1 for normal text, 3:1 for UI components / large text.
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

function block(selectorStart: string): Record<string, string> {
  const start = css.indexOf(selectorStart);
  if (start < 0) throw new Error(`selector ${selectorStart} not found`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const entries = [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)].map(
    (m): [string, string] => [m[1] ?? '', m[2] ?? ''],
  );
  return Object.fromEntries(entries);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const dark = block(':root,\n.dark {');
const light = block('.light {');
const themes = {
  dark,
  light,
  'dark blue-orange': { ...dark, ...block(":root[data-updown='blue-orange']") },
  'light blue-orange': { ...light, ...block(".light[data-updown='blue-orange']") },
};

// [foreground, background, minimum ratio]
const textPairs: [string, string, number][] = [
  ['foreground', 'background', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['card-foreground', 'card', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['warning-foreground', 'warning', 4.5],
  ['up', 'background', 4.5],
  ['down', 'background', 4.5],
  ['up', 'card', 4.5],
  ['down', 'card', 4.5],
  ['up-foreground', 'up', 4.5],
  ['down-foreground', 'down', 4.5],
  ['ring', 'background', 3],
  ['brand', 'background', 4.5],
];

describe.each(Object.entries(themes))('%s theme contrast (WCAG 2.2 AA)', (_name, t) => {
  it.each(textPairs)('%s on %s ≥ %s:1', (fg, bg, min) => {
    const a = t[fg];
    const b = t[bg];
    expect(a, fg).toBeDefined();
    expect(b, bg).toBeDefined();
    expect(contrast(a ?? '', b ?? '')).toBeGreaterThanOrEqual(min);
  });
});

describe('up/down distinguishability', () => {
  it.each(Object.entries(themes))('%s: up and down differ in luminance or hue', (_name, t) => {
    expect(t['up']).not.toBe(t['down']);
  });
});
