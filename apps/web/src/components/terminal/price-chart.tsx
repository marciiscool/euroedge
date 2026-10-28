'use client';

import type { FvDisplaySnapshot } from '@euroedge/shared';
import type {
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { api, type Candle } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { nextBar, type Bar } from './candles';

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** TradingView's own candle colours (its chart library is what we render with). */
const UP = '#089981';
const DOWN = '#f23645';
const VOLUME_UP = 'rgba(8, 153, 129, 0.45)';
const VOLUME_DOWN = 'rgba(242, 54, 69, 0.45)';

export const INTERVALS = [
  { id: '1m', label: '1m', ms: 60_000 },
  { id: '5m', label: '5m', ms: 300_000 },
  { id: '15m', label: '15m', ms: 900_000 },
  { id: '1h', label: '1H', ms: 3_600_000 },
  { id: '4h', label: '4H', ms: 14_400_000 },
  { id: '1d', label: '1D', ms: 86_400_000 },
] as const;
type IntervalId = (typeof INTERVALS)[number]['id'];

const toBar = (c: Candle, lot: number): Bar => ({
  time: (c.t / 1000) as UTCTimestamp,
  open: Number(c.open),
  high: Number(c.high),
  low: Number(c.low),
  close: Number(c.close),
  volume: Number(c.volumeLots) * lot,
});

/**
 * Candlestick chart of the mark in the style of a TradingView chart (same library): OHLC
 * legend that follows the crosshair, volume underneath, timeframes, and the FV band of the
 * model price as faint dashed lines.
 */
export function PriceChart({
  market,
  fv,
  lotSize,
}: {
  market: string;
  fv: FvDisplaySnapshot | undefined;
  lotSize?: string | undefined;
}) {
  const t = useTranslations('Terminal');
  const locale = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{
    candles: ISeriesApi<'Candlestick'>;
    volume: ISeriesApi<'Histogram'>;
    hi: ISeriesApi<'Line'>;
    lo: ISeriesApi<'Line'>;
  } | null>(null);
  const bars = useRef<Bar[]>([]);
  const [interval, setInterval] = useState<IntervalId>('1m');
  const [hover, setHover] = useState<Bar | undefined>();
  const [lastBar, setLastBar] = useState<Bar | undefined>();
  const intervalMs = INTERVALS.find((i) => i.id === interval)?.ms ?? 60_000;
  const lot = Number(lotSize ?? '0.01');

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const lw = await import('lightweight-charts');
      if (disposed || box.current === null) return;
      const grid = css('--border');
      const c = lw.createChart(box.current, {
        autoSize: true,
        localization: { locale, priceFormatter: (p: number) => formatNumber(p, locale) },
        layout: {
          background: { color: 'transparent' },
          textColor: css('--muted-foreground'),
          fontFamily: 'var(--font-geist-mono)',
          fontSize: 11,
          attributionLogo: true,
        },
        grid: { vertLines: { color: grid }, horzLines: { color: grid } },
        crosshair: {
          mode: lw.CrosshairMode.Normal,
          vertLine: { labelBackgroundColor: css('--muted') || '#2a2e39' },
          horzLine: { labelBackgroundColor: css('--muted') || '#2a2e39' },
        },
        rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.08, bottom: 0.22 } },
        timeScale: {
          borderColor: grid,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 6,
          barSpacing: 8,
        },
      });
      const band = {
        color: css('--muted-foreground'),
        lineWidth: 1 as const,
        lineStyle: lw.LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      };
      const s = {
        hi: c.addSeries(lw.LineSeries, band),
        lo: c.addSeries(lw.LineSeries, band),
        candles: c.addSeries(lw.CandlestickSeries, {
          upColor: UP,
          downColor: DOWN,
          borderUpColor: UP,
          borderDownColor: DOWN,
          wickUpColor: UP,
          wickDownColor: DOWN,
        }),
        volume: c.addSeries(lw.HistogramSeries, {
          priceScaleId: 'volume',
          priceFormat: { type: 'volume' },
          lastValueVisible: false,
          priceLineVisible: false,
        }),
      };
      c.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      series.current = s;
      chart.current = c;
      c.subscribeCrosshairMove((p: MouseEventParams<Time>) => {
        const d = p.seriesData.get(s.candles) as { open?: number } | undefined;
        setHover(d?.open === undefined ? undefined : bars.current.find((b) => b.time === p.time));
      });

      const [{ candles }, { points }] = await Promise.all([
        api.candles(market, interval).catch(() => ({ candles: [] as Candle[] })),
        api
          .fvHistory(market, Math.min(24 * 60, Math.round((intervalMs * 300) / 60_000)))
          .catch(() => ({ points: [] })),
      ]);
      if (disposed || series.current === null) return;
      bars.current = candles.map((x) => toBar(x, lot));
      s.candles.setData(bars.current);
      s.volume.setData(
        bars.current.map((b) => ({
          time: b.time,
          value: b.volume,
          color: b.close >= b.open ? VOLUME_UP : VOLUME_DOWN,
        })),
      );
      const at = (p: (typeof points)[number], k: 'bandLo' | 'bandHi') => ({
        time: (p.t / 1000) as UTCTimestamp,
        value: Number(p[k]),
      });
      s.lo.setData(points.map((p) => at(p, 'bandLo')));
      s.hi.setData(points.map((p) => at(p, 'bandHi')));
      setLastBar(bars.current.at(-1));
      c.timeScale().scrollToRealTime();
    })();
    return () => {
      disposed = true;
      chart.current?.remove();
      chart.current = null;
      series.current = null;
    };
  }, [market, locale, interval, intervalMs, lot]);

  useEffect(() => {
    const s = series.current;
    if (fv === undefined || s === null) return;
    const prev = bars.current.at(-1);
    const bar = nextBar(prev, fv.ts, Number(fv.mark), intervalMs);
    if (prev !== undefined && bar.time < prev.time) return;
    if (prev !== undefined && prev.time === bar.time) bars.current[bars.current.length - 1] = bar;
    else bars.current.push(bar);
    s.candles.update(bar);
    s.volume.update({
      time: bar.time,
      value: bar.volume,
      color: bar.close >= bar.open ? VOLUME_UP : VOLUME_DOWN,
    });
    const time = (fv.ts / 1000) as UTCTimestamp;
    s.lo.update({ time, value: Number(fv.bandLo) });
    s.hi.update({ time, value: Number(fv.bandHi) });
    setLastBar(bar);
  }, [fv, intervalMs]);

  const shown = hover ?? lastBar;
  const tone =
    shown === undefined ? '' : shown.close >= shown.open ? 'text-[#089981]' : 'text-[#f23645]';
  const change =
    shown === undefined || shown.open === 0 ? 0 : ((shown.close - shown.open) / shown.open) * 100;
  const fmt = (n: number) => formatNumber(n, locale);
  return (
    <figure className="relative flex min-h-[360px] flex-1 flex-col" aria-label={t('chartLabel')}>
      <div
        role="toolbar"
        aria-label={t('chartIntervals')}
        className="flex gap-1 border-b border-border px-2 py-1 font-mono text-xs"
      >
        {INTERVALS.map((i) => (
          <button
            key={i.id}
            type="button"
            aria-pressed={interval === i.id}
            onClick={() => setInterval(i.id)}
            className={`rounded px-2 py-1 ${interval === i.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {i.label}
          </button>
        ))}
      </div>
      <div className="relative flex-1">
        <div ref={box} className="absolute inset-0" />
        <div className="pointer-events-none absolute top-2 left-3 z-10 flex flex-wrap items-baseline gap-x-3 font-mono text-xs tabular-nums">
          <span className="text-foreground">
            {market} · {INTERVALS.find((i) => i.id === interval)?.label}
          </span>
          {shown !== undefined && (
            <span className={tone}>
              <span className="text-muted-foreground">O</span> {fmt(shown.open)}{' '}
              <span className="text-muted-foreground">H</span> {fmt(shown.high)}{' '}
              <span className="text-muted-foreground">L</span> {fmt(shown.low)}{' '}
              <span className="text-muted-foreground">C</span> {fmt(shown.close)}{' '}
              {change >= 0 ? '+' : '−'}
              {formatNumber(Math.abs(change), locale)}%
            </span>
          )}
        </div>
      </div>
      <figcaption className="sr-only">{t('chartDescription')}</figcaption>
    </figure>
  );
}
