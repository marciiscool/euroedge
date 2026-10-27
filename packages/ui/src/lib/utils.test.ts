import { describe, expect, it } from 'vitest';
import { cn } from './utils.ts';

describe('cn', () => {
  it('merges conditional classes and lets later Tailwind utilities win', () => {
    const hidden = false;
    expect(cn('px-2 py-1', hidden && 'hidden', 'px-4')).toBe('py-1 px-4');
  });
});
