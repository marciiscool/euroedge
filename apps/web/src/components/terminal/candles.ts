import type { UTCTimestamp } from 'lightweight-charts';

export interface Bar {
  readonly time: UTCTimestamp;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** Live 1-s marks extend the last candle or open the next one (open = previous close). */
export function nextBar(last: Bar | undefined, ts: number, mark: number, intervalMs: number): Bar {
  const time = (Math.floor(ts / intervalMs) * (intervalMs / 1000)) as UTCTimestamp;
  if (last !== undefined && last.time === time)
    return { ...last, high: Math.max(last.high, mark), low: Math.min(last.low, mark), close: mark };
  const open = last?.close ?? mark;
  return {
    time,
    open,
    high: Math.max(open, mark),
    low: Math.min(open, mark),
    close: mark,
    volume: 0,
  };
}
