import { describe, expect, it } from 'vitest';
import de from '../messages/de.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)/g)].map((m) => m[1] ?? '').sort();
}

describe('i18n messages', () => {
  it('de has exactly the en keys', () => {
    expect(keys(de).sort()).toEqual(keys(en).sort());
  });

  it('placeholders match between locales', () => {
    const lookup = (obj: object, path: string) =>
      path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj) as string;
    for (const k of keys(en)) {
      expect(placeholders(lookup(de, k)), k).toEqual(placeholders(lookup(en, k)));
    }
  });

  it('uses no trademarked index names in user-facing copy (brief §1)', () => {
    const text = JSON.stringify([en, de]);
    expect(text).not.toMatch(/\b(DAX|STOXX|Euro Stoxx|CAC|FTSE)\b/i);
  });
});
