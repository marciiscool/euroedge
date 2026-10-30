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
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, type Candle } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { nextBar, type Bar } from './candles';
import {
  CHART_THEMES,
  CHART_TIME_ZONE,
  chartThemeStore,
  saveChartTheme,
  type ChartThemeName,
} from './chart-themes';

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

/** UTC bar time → exchange time on the axis and the crosshair label. */
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: CHART_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const day = new Intl.DateTimeFormat('en-GB', {
  timeZone: CHART_TIME_ZONE,
  day: '2-digit',
  month: 'short',
});
const asDate = (t: Time) => new Date((t as number) * 1000);

/**
 * Candlestick chart of the mark, styled like the user's Trading Hub chart (same library,
 * TradingView look): theme presets with his "Mein TradingView" as default, compact status
 * line with OHLC, volume underneath, timeframes, » / ⟲ / A navigation, exchange time on the
 * axis, and the FV band of the model price as faint dashed lines.
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
  const themeName = useSyncExternalStore(
    chartThemeStore.subscribe,
    chartThemeStore.get,
    chartThemeStore.server,
  );
  const [autoScale, setAutoScale] = useState(true);
  const [hover, setHover] = useState<Bar | undefined>();
  const [lastBar, setLastBar] = useState<Bar | undefined>();
  const intervalMs = INTERVALS.find((i) => i.id === interval)?.ms ?? 60_000;
  const lot = Number(lotSize ?? '0.01');
  const theme = CHART_THEMES[themeName];

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const lw = await import('lightweight-charts');
      if (disposed || box.current === null) return;
      const c = lw.createChart(box.current, {
        autoSize: true,
        localization: {
          locale,
          priceFormatter: (p: number) => formatNumber(p, locale),
          timeFormatter: (time: Time) =>
            `${day.format(asDate(time))} ${clock.format(asDate(time))}`,
        },
        layout: {
          background: { color: theme.bg },
          textColor: theme.text,
          fontFamily: 'var(--font-geist-mono)',
          fontSize: 11,
          attributionLogo: true,
        },
        grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
        crosshair: {
          mode: lw.CrosshairMode.Normal,
          vertLine: { color: theme.cross, labelBackgroundColor: '#2A2E39' },
          horzLine: { color: theme.cross, labelBackgroundColor: '#2A2E39' },
        },
        rightPriceScale: { borderColor: theme.scale, scaleMargins: { top: 0.08, bottom: 0.22 } },
        timeScale: {
          borderColor: theme.scale,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 6,
          barSpacing: 8,
          tickMarkFormatter: (time: Time, kind: number) =>
            kind <= 2 ? day.format(asDate(time)) : clock.format(asDate(time)),
        },
      });
      const band = {
        color: theme.cross,
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
          upColor: theme.up,
          downColor: theme.down,
          borderUpColor: theme.up,
          borderDownColor: theme.down,
          wickUpColor: theme.up,
          wickDownColor: theme.down,
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
          color: b.close >= b.open ? theme.volUp : theme.volDown,
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
  }, [market, locale, interval, intervalMs, lot, theme]);

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
      color: bar.close >= bar.open ? theme.volUp : theme.volDown,
    });
    const time = (fv.ts / 1000) as UTCTimestamp;
    s.lo.update({ time, value: Number(fv.bandLo) });
    s.hi.update({ time, value: Number(fv.bandHi) });
    setLastBar(bar);
  }, [fv, intervalMs, theme]);

  const nav = {
    latest: () => chart.current?.timeScale().scrollToRealTime(),
    reset: () => {
      chart.current?.timeScale().resetTimeScale();
      chart.current?.priceScale('right').applyOptions({ autoScale: true });
      setAutoScale(true);
    },
    auto: () => {
      const next = !autoScale;
      chart.current?.priceScale('right').applyOptions({ autoScale: next });
      setAutoScale(next);
    },
  };

  const shown = hover ?? lastBar;
  const tone = shown === undefined ? theme.text : shown.close >= shown.open ? theme.up : theme.down;
  const change =
    shown === undefined || shown.open === 0 ? 0 : ((shown.close - shown.open) / shown.open) * 100;
  const fmt = (n: number) => formatNumber(n, locale);
  return (
    <figure
      className="relative flex min-h-[360px] flex-1 flex-col"
      style={{ background: theme.bg }}
      aria-label={t('chartLabel')}
    >
      <div className="flex items-center gap-1 border-b border-border bg-background px-2 py-1 font-mono text-xs">
        <div role="toolbar" aria-label={t('chartIntervals')} className="flex gap-1">
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
        <label className="ml-auto flex items-center gap-1 text-muted-foreground">
          <span className="sr-only sm:not-sr-only">{t('chartTheme')}</span>
          <select
            value={themeName}
            onChange={(e) => {
              saveChartTheme(e.target.value as ChartThemeName);
            }}
            className="rounded border border-border bg-background px-1 py-0.5 text-foreground"
          >
            {Object.keys(CHART_THEMES).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="relative flex-1">
        <div ref={box} className="absolute inset-0" />
        <div
          className="pointer-events-none absolute top-1.5 left-2 z-10 flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] leading-tight tabular-nums"
          style={{ color: theme.text }}
        >
          <span className="font-semibold">
            {market} · {INTERVALS.find((i) => i.id === interval)?.label} ·{' '}
            {CHART_TIME_ZONE.split('/')[1]}
          </span>
          {shown !== undefined && (
            <span className="font-mono" style={{ color: tone }}>
              <b className="font-normal opacity-60">O</b>
              {fmt(shown.open)} <b className="font-normal opacity-60">H</b>
              {fmt(shown.high)} <b className="font-normal opacity-60">L</b>
              {fmt(shown.low)} <b className="font-normal opacity-60">C</b>
              {fmt(shown.close)} {change >= 0 ? '+' : '−'}
              {formatNumber(Math.abs(change), locale)}%
            </span>
          )}
        </div>
        <div className="absolute right-[72px] bottom-8 z-10 flex gap-1 font-mono text-xs">
          <button
            type="button"
            title={t('chartLatest')}
            aria-label={t('chartLatest')}
            onClick={nav.latest}
            className="rounded border border-[#2A2E39] bg-[rgba(30,34,45,0.85)] px-2 py-0.5 text-[#D1D4DC] hover:bg-[#2A2E39]"
          >
            »
          </button>
          <button
            type="button"
            title={t('chartReset')}
            aria-label={t('chartReset')}
            onClick={nav.reset}
            className="rounded border border-[#2A2E39] bg-[rgba(30,34,45,0.85)] px-2 py-0.5 text-[#D1D4DC] hover:bg-[#2A2E39]"
          >
            ⟲
          </button>
          <button
            type="button"
            title={t('chartAutoScale')}
            aria-label={t('chartAutoScale')}
            aria-pressed={autoScale}
            onClick={nav.auto}
            className={`rounded border px-2 py-0.5 ${autoScale ? 'border-[#2962FF] bg-[#2962FF] text-white' : 'border-[#2A2E39] bg-[rgba(30,34,45,0.85)] text-[#D1D4DC] hover:bg-[#2A2E39]'}`}
          >
            A
          </button>
        </div>
      </div>
      <figcaption className="sr-only">{t('chartDescription')}</figcaption>
    </figure>
  );
}
