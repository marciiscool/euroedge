'use client';

import type { FvDisplaySnapshot } from '@euroedge/shared';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Mark + FV with its band (the fan chart proper arrives in M7). */
export function PriceChart({ market, fv }: { market: string; fv: FvDisplaySnapshot | undefined }) {
  const t = useTranslations('Terminal');
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{
    mark: ISeriesApi<'Line'>;
    fv: ISeriesApi<'Line'>;
    hi: ISeriesApi<'Line'>;
    lo: ISeriesApi<'Line'>;
  } | null>(null);
  const last = useRef(0);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const lw = await import('lightweight-charts');
      if (disposed || box.current === null) return;
      const c = lw.createChart(box.current, {
        autoSize: true,
        layout: {
          background: { color: 'transparent' },
          textColor: css('--muted-foreground'),
          fontFamily: 'var(--font-geist-mono)',
          attributionLogo: true,
        },
        grid: { vertLines: { color: css('--border') }, horzLines: { color: css('--border') } },
        rightPriceScale: { borderColor: css('--border') },
        timeScale: { borderColor: css('--border'), timeVisible: true, secondsVisible: false },
      });
      const band = {
        color: css('--muted-foreground'),
        lineWidth: 1 as const,
        lineStyle: lw.LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      };
      series.current = {
        hi: c.addSeries(lw.LineSeries, band),
        lo: c.addSeries(lw.LineSeries, band),
        fv: c.addSeries(lw.LineSeries, {
          color: css('--brand'),
          lineWidth: 1,
          priceLineVisible: false,
        }),
        mark: c.addSeries(lw.LineSeries, { color: css('--foreground'), lineWidth: 2 }),
      };
      chart.current = c;
      const { points } = await api.fvHistory(market).catch(() => ({ points: [] }));
      if (disposed || series.current === null) return;
      const at = (p: (typeof points)[number], k: 'fv' | 'bandLo' | 'bandHi' | 'mark') => ({
        time: (p.t / 1000) as UTCTimestamp,
        value: Number(p[k]),
      });
      series.current.fv.setData(points.map((p) => at(p, 'fv')));
      series.current.lo.setData(points.map((p) => at(p, 'bandLo')));
      series.current.hi.setData(points.map((p) => at(p, 'bandHi')));
      series.current.mark.setData(points.map((p) => at(p, 'mark')));
      last.current = points.at(-1)?.t ?? 0;
    })();
    return () => {
      disposed = true;
      chart.current?.remove();
      chart.current = null;
      series.current = null;
    };
  }, [market]);

  useEffect(() => {
    const s = series.current;
    if (fv === undefined || s === null || fv.ts <= last.current) return;
    last.current = fv.ts;
    const time = (fv.ts / 1000) as UTCTimestamp;
    s.fv.update({ time, value: Number(fv.fv) });
    s.lo.update({ time, value: Number(fv.bandLo) });
    s.hi.update({ time, value: Number(fv.bandHi) });
    s.mark.update({ time, value: Number(fv.mark) });
  }, [fv]);

  return (
    <figure className="relative min-h-[320px] flex-1" aria-label={t('chartLabel')}>
      <div ref={box} className="absolute inset-0" />
      <figcaption className="sr-only">{t('chartDescription')}</figcaption>
    </figure>
  );
}
