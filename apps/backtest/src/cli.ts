import { parseArgs } from 'node:util';

export const USAGE = `euroedge-backtest — replay ticks through fv-core / risk-core (brief §6.6)

Usage:
  pnpm --filter @euroedge/backtest start -- --data <dir> [--from <date>] [--to <date>] [--out <file>]

Options:
  --data <dir>   Replay data directory (default: data/sample)
  --from <date>  First UTC date (YYYY-MM-DD)
  --to <date>    Last UTC date (YYYY-MM-DD)
  --out <file>   Report JSON path (default: stdout)
  --fit          Output a σ-floor fit proposal instead of the report (M3-16)
  -h, --help     Show this help`;

export interface BacktestArgs {
  readonly help: boolean;
  readonly data: string;
  readonly from?: string;
  readonly to?: string;
  readonly out?: string;
  readonly fit?: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseCliArgs(argv: readonly string[]): BacktestArgs {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      data: { type: 'string', default: 'data/sample' },
      from: { type: 'string' },
      to: { type: 'string' },
      out: { type: 'string' },
      fit: { type: 'boolean', default: false },
    },
  });
  for (const key of ['from', 'to'] as const) {
    const v = values[key];
    if (v !== undefined && !DATE.test(v)) throw new Error(`--${key} must be YYYY-MM-DD, got ${v}`);
  }
  return {
    help: values.help,
    data: values.data,
    ...(values.from === undefined ? {} : { from: values.from }),
    ...(values.to === undefined ? {} : { to: values.to }),
    ...(values.out === undefined ? {} : { out: values.out }),
    ...(values.fit ? { fit: true } : {}),
  };
}
