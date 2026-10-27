import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './cli.ts';

describe('backtest CLI args', () => {
  it('has defaults', () => {
    expect(parseCliArgs([])).toEqual({ help: false, data: 'data/sample' });
  });

  it('parses options', () => {
    expect(
      parseCliArgs(['--data', 'data/historical', '--from', '2026-10-26', '--to', '2026-10-30']),
    ).toEqual({ help: false, data: 'data/historical', from: '2026-10-26', to: '2026-10-30' });
  });

  it('rejects malformed dates and unknown flags', () => {
    expect(() => parseCliArgs(['--from', '26.10.2026'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseCliArgs(['--bogus'])).toThrow();
  });
});
