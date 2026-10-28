// Engine benchmark (M4-28): core apply latency and, with DATABASE_URL, acknowledged-order
// latency (apply + hash-chained Postgres commit) at the target rate. Non-blocking in CI:
// it reports against the targets but always exits 0.
import { appendFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { lots, ticks, usdc } from '@euroedge/fixed';
import { migrate } from '@euroedge/db';
import { apply } from '../src/core/apply.ts';
import type { EngineInput } from '../src/core/events.ts';
import { createState } from '../src/core/state.ts';
import { EVENT_VERSIONS } from '../src/log/codec.ts';
import { EventStore } from '../src/log/store.ts';
import { Sequencer } from '../src/sequencer.ts';
import { listASML, WINDOWS } from '../test/fixtures.ts';

const TARGET_RATE = 50; // orders/s sustained
const TARGET_P99_MS = 50; // ack latency
const ACCOUNTS = 200;
const USDC = 1_000_000n;

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const ms = (x: number) => Math.round(x * 1000) / 1000;

function setup(): EngineInput[] {
  const inputs: EngineInput[] = [
    {
      type: 'GenesisCapital',
      house: usdc(50_000_000n * USDC),
      insurance: usdc(5_000_000n * USDC),
      source: 'dev',
    },
    { ...listASML, windows: WINDOWS } as EngineInput,
    md(70_000n),
  ];
  for (let i = 0; i < ACCOUNTS; i++)
    inputs.push({ type: 'DevDeposit', account: `a${i}`, amount: usdc(100_000n * USDC) });
  return inputs;
}

function md(px: bigint): EngineInput {
  return {
    type: 'MarketData',
    market: 'ASML-PERP',
    window: 'A',
    fv: ticks(px),
    bandLo: ticks(px - 500n),
    bandHi: ticks(px + 500n),
    index: ticks(px),
    mark: ticks(px),
    markClamped: false,
    sigmaPpm: 500n,
    breaker: 'none',
  };
}

/** Orders round-robin over accounts, alternating sides; a market-data tick every 10 orders. */
function* workload(n: number): Generator<EngineInput> {
  let px = 70_000n;
  for (let i = 0; i < n; i++) {
    if (i % 10 === 0) {
      px += BigInt((i % 7) - 3) * 5n;
      yield md(px);
    }
    yield {
      type: 'PlaceOrder',
      requestId: `r${i}`,
      idempotencyKey: `k${i}`,
      account: `a${i % ACCOUNTS}`,
      market: 'ASML-PERP',
      side: (i / ACCOUNTS) % 2 < 1 ? 'buy' : 'sell',
      qty: lots(BigInt(10 + (i % 90))),
      reduceOnly: false,
    };
  }
}

function core(n: number) {
  const state = createState();
  let seq = 0n;
  let fills = 0;
  const run = (input: EngineInput) => {
    seq += 1n;
    const out = apply(state, {
      seq,
      ts: 1_793_000_000_000n + seq,
      v: EVENT_VERSIONS[input.type],
      input,
    });
    fills += out.filter((o) => o.type === 'OrderFilled').length;
  };
  setup().forEach(run);
  const lat: number[] = [];
  const t0 = performance.now();
  for (const input of workload(n)) {
    const t = performance.now();
    run(input);
    if (input.type === 'PlaceOrder') lat.push(performance.now() - t);
  }
  const secs = (performance.now() - t0) / 1000;
  return {
    orders: n,
    filled: fills,
    ordersPerSec: Math.round(n / secs),
    p50: ms(pct(lat, 50)),
    p99: ms(pct(lat, 99)),
    max: ms(pct(lat, 100)),
  };
}

async function withDb(url: string, n: number) {
  const name = `euroedge_bench_${process.pid}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(url);
  u.pathname = `/${name}`;
  try {
    await migrate(u.toString());
    const store = new EventStore(u.toString());
    await store.acquireWriterLock();
    const seq = new Sequencer(createState(), store);
    await seq.processInputs(setup());
    const lat: number[] = [];
    const gap = 1000 / TARGET_RATE;
    const t0 = performance.now();
    let i = 0;
    for (const input of workload(n)) {
      // Paced at the target rate: each order is its own batch (worst case for the commit).
      const due = t0 + i * gap;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const t = performance.now();
      await seq.processInputs([input]);
      if (input.type === 'PlaceOrder') {
        lat.push(performance.now() - t);
        i += 1;
      }
    }
    const secs = (performance.now() - t0) / 1000;
    await store.close();
    return {
      orders: n,
      ordersPerSec: Math.round(n / secs),
      p50: ms(pct(lat, 50)),
      p99: ms(pct(lat, 99)),
      max: ms(pct(lat, 100)),
    };
  } finally {
    const a = new pg.Client({ connectionString: url });
    await a.connect();
    await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await a.end();
  }
}

const result: Record<string, unknown> = { core: core(20_000) };
const url = process.env['DATABASE_URL'];
if (url !== undefined) result['ack'] = await withDb(url, 500);
const ack = result['ack'] as { ordersPerSec: number; p99: number } | undefined;
const verdict =
  ack === undefined
    ? 'core only (no DATABASE_URL)'
    : ack.ordersPerSec >= TARGET_RATE * 0.95 && ack.p99 < TARGET_P99_MS
      ? 'PASS'
      : 'MISS';
result['targets'] = { ordersPerSec: TARGET_RATE, p99Ms: TARGET_P99_MS, verdict };
console.log(JSON.stringify(result, null, 2));
const summary = process.env['GITHUB_STEP_SUMMARY'];
if (summary !== undefined)
  appendFileSync(
    summary,
    `### Engine benchmark (M4-28)\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`,
  );
