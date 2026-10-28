import { describe, expect, it } from 'vitest';
import { nextBar } from '../src/components/terminal/candles';

describe('live candles', () => {
  it('extends the current candle and opens the next one at the previous close', () => {
    const a = nextBar(undefined, 60_000, 700, 60_000);
    expect(a).toEqual({ time: 60, open: 700, high: 700, low: 700, close: 700, volume: 0 });
    const b = nextBar(a, 90_000, 702, 60_000);
    expect(b).toMatchObject({ time: 60, open: 700, high: 702, low: 700, close: 702 });
    const c = nextBar(b, 95_000, 699, 60_000);
    expect(c).toMatchObject({ high: 702, low: 699, close: 699 });
    const d = nextBar(c, 120_000, 698.5, 60_000);
    expect(d).toEqual({ time: 120, open: 699, high: 699, low: 698.5, close: 698.5, volume: 0 });
  });
});
