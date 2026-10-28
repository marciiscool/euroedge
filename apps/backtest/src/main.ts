#!/usr/bin/env node
// Backtest CLI. Imports fv-core directly — no duplicated maths (brief §6.6).
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadTickFile } from '@euroedge/data-adapters';
import { instrumentKey } from '@euroedge/shared';
import { loadFvParams, loadMarkets, loadWindows } from '@euroedge/shared/config';
import { parseCliArgs, USAGE } from './cli.ts';
import { reportSchema } from './metrics.ts';
import { fitSigmaFloors } from './fit.ts';
import { scoreTicks } from './run.ts';

const args = parseCliArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
} else {
  const files = (await stat(args.data)).isDirectory()
    ? (await readdir(args.data))
        .filter((f) => /\.csv(\.gz)?$/.test(f))
        .sort()
        .map((f) => join(args.data, f))
    : [args.data];
  const from = args.from === undefined ? -Infinity : Date.parse(`${args.from}T00:00:00Z`);
  const to = args.to === undefined ? Infinity : Date.parse(`${args.to}T23:59:59.999Z`);
  const ticks = (await Promise.all(files.map(loadTickFile)))
    .flat()
    .filter((t) => t.ts >= from && t.ts <= to)
    .sort((a, b) => a.ts - b.ts);
  const seen = new Set(ticks.map((t) => instrumentKey(t.instrument)));
  const markets = (await loadMarkets()).filter(
    (m) => m.kind === 'stock' && seen.has(`${m.primaryMic}:${m.primarySymbol ?? ''}`),
  );
  const params = await loadFvParams();
  const { report, samples } = scoreTicks(ticks, {
    markets,
    params,
    stepCapBpsPerSecond: (await loadWindows()).markStepCapBpsPerSecond,
    data: files,
  });
  const out = args.fit === true ? fitSigmaFloors(samples, params) : reportSchema.parse(report);
  const json = JSON.stringify(out, null, 2) + '\n';
  if (args.out === undefined) process.stdout.write(json);
  else await writeFile(args.out, json);
}
