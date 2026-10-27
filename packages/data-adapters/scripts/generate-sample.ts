// Regenerates the committed sample data set (docs/data-format.md).
// Run: pnpm --filter @euroedge/data-adapters sample
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { instrumentKey, type Tick } from '@euroedge/shared';
import { loadMarkets, loadSimConfig } from '@euroedge/shared/config';
import { CSV_HEADER, tickToCsv } from '../src/csv.ts';
import { SimWorld } from '../src/sim/world.ts';

export const SAMPLE = {
  seed: 42,
  // Two weeks spanning the US-only DST weeks, the EU switch (28 Mar), Good Friday/Easter
  // Monday 2027 and the ASML/TTE/NOVO ex-dividend days of the simulated calendar.
  from: '2027-03-15T00:00:00+01:00',
  to: '2027-03-31T00:00:00+02:00',
  markets: ['ASML-PERP', 'SAP-PERP', 'NOVO-PERP', 'SHEL-PERP', 'TTE-PERP'],
  /** Quotes and trades are thinned to the first per instrument per bucket; other kinds are kept. */
  thinSeconds: 60,
};

const dir = fileURLToPath(new URL('../../../data/sample/', import.meta.url));
const markets = (await loadMarkets()).filter((m) => SAMPLE.markets.includes(m.id));
const world = new SimWorld({
  seed: SAMPLE.seed,
  startTs: Date.parse(SAMPLE.from),
  markets,
  config: await loadSimConfig(),
});
const end = Date.parse(SAMPLE.to);
const seen = new Set<string>();
const rows: string[] = [CSV_HEADER];
const keep = (t: Tick) => {
  if (t.kind !== 'quote' && t.kind !== 'trade') return true;
  const key = `${instrumentKey(t.instrument)}|${t.kind}|${Math.floor(t.ts / (SAMPLE.thinSeconds * 1000))}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
};
for (let t = world.now; t < end; t = Math.min(t + 3_600_000, end))
  for (const tick of world.advanceTo(Math.min(t + 3_600_000, end)))
    if (keep(tick)) rows.push(tickToCsv(tick));

const name = 'sim-2027-03-15_2027-03-31.csv.gz';
await writeFile(dir + name, gzipSync(rows.join('\n') + '\n', { level: 9 }));
await writeFile(
  dir + 'manifest.json',
  JSON.stringify(
    { file: name, rows: rows.length - 1, ...SAMPLE, faults: world.faultLog },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${rows.length - 1} ticks to data/sample/${name}`);
