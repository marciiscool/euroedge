import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// Guards the guard: the determinism rules (ADR-0001/0011) must fire for core source files.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

async function messages(code: string, filePath = 'packages/fixed/src/__probe__.ts') {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.message);
}

describe('determinism lint rules', () => {
  it.each([
    ['Date.now()', /never reads the clock/],
    ['new Date()', /never reads the clock/],
    ['Math.random()', /No floating-point maths/],
    ['performance.now()', /never reads the clock/],
    ['setTimeout(() => 1, 1)', /No timers/],
    ['process.env', /No environment access/],
    ['Number.parseFloat("1")', /No floats/],
    ['(1).toFixed(2)', /No float formatting/],
    ['0.5', /Non-integer numeric literal/],
    ['1e-6', /Non-integer numeric literal/],
  ])('rejects %s in core code', async (code, pattern) => {
    expect((await messages(`export const probe = () => ${code};`)).join('\n')).toMatch(pattern);
  });

  it('allows integer and bigint arithmetic', async () => {
    expect(
      await messages('export const probe = (a: bigint) => a * 10n + 1_000n + BigInt(3);'),
    ).toEqual([]);
  });

  it('applies to engine core but not to non-core packages', async () => {
    const code = 'export const probe = () => Date.now();';
    expect(await messages(code, 'apps/engine/src/core/__probe__.ts')).not.toEqual([]);
    expect(await messages(code, 'packages/shared/src/__probe__.ts')).toEqual([]);
  });
});
