import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lots, ticks, usdc } from '@euroedge/fixed';
import type { EngineEvent, EngineInput } from '../core/events.ts';
import { canonicalJson } from './canonical.ts';
import { chainHash, decodeEvent, encodeEvent, GENESIS_HASH, verifyChain } from './codec.ts';

describe('canonicalJson', () => {
  it('sorts keys, encodes bigints as strings, no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [2n, 'x', true, null], c: { z: 0, y: -3n } })).toBe(
      '{"a":["2","x",true,null],"b":1,"c":{"y":"-3","z":0}}',
    );
  });

  it('is independent of key insertion order (property)', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.oneof(fc.integer(), fc.bigInt(), fc.string())),
        (obj) => {
          const reversed = Object.fromEntries(Object.entries(obj).reverse());
          expect(canonicalJson(reversed)).toBe(canonicalJson(obj));
        },
      ),
    );
  });

  it('rejects floats, undefined, Maps and Dates — nothing non-canonical enters the log', () => {
    expect(() => canonicalJson({ x: 0.1 })).toThrow(/non-integer/);
    expect(() => canonicalJson({ x: undefined })).toThrow(/undefined/);
    expect(() => canonicalJson(new Map())).toThrow(/Map/);
    expect(() => canonicalJson(new Date(0))).toThrow(/Date/);
    expect(() => canonicalJson(Number.MAX_SAFE_INTEGER + 2)).toThrow();
  });
});

const sample: EngineInput[] = [
  { type: 'ClockTick' },
  {
    type: 'GenesisCapital',
    house: usdc(50_000_000_000_000n),
    insurance: usdc(5_000_000_000_000n),
    source: 'dev',
  },
  { type: 'DevDeposit', account: 'dev-alice', amount: usdc(10_000_000_000n) },
  {
    type: 'MarketData',
    market: 'ASML-PERP',
    window: 'A',
    fv: ticks(70_000n),
    bandLo: ticks(69_900n),
    bandHi: ticks(70_100n),
    index: ticks(70_010n),
    mark: ticks(70_005n),
    markClamped: false,
    sigmaPpm: 600n,
    breaker: 'none',
  },
  {
    type: 'PlaceOrder',
    requestId: 'r1',
    idempotencyKey: 'k1',
    account: 'dev-alice',
    market: 'ASML-PERP',
    side: 'buy',
    qty: lots(150n),
    reduceOnly: false,
  },
];
const events: EngineEvent[] = sample.map((input, i) => ({
  seq: BigInt(i + 1),
  ts: 1_793_000_000_000n + BigInt(i),
  v: 1,
  input,
}));

describe('event codec', () => {
  it('round-trips every input type with bigints intact', () => {
    for (const e of events) expect(decodeEvent(encodeEvent(e))).toEqual(e);
  });

  it('rejects malformed payloads and future versions', () => {
    expect(() =>
      decodeEvent(
        '{"seq":"1","ts":"1","v":1,"input":{"type":"DevDeposit","account":"a","amount":"-5"}}',
      ),
    ).toThrow();
    expect(() => decodeEvent('{"seq":"1","ts":"1","v":2,"input":{"type":"ClockTick"}}')).toThrow(
      /future version/,
    );
  });

  it('upcasts MarketListed v1 (no funding, no maker fee) with funding off', () => {
    const risk = {
      maxLeverage: '5',
      takerFeeBps: '5',
      houseHalfSpreadBps: '5',
      priceLimitBps: '1000',
    };
    const v1 = JSON.stringify({
      seq: '1',
      ts: '1',
      v: 1,
      input: {
        type: 'MarketListed',
        market: 'ASML-PERP',
        kind: 'stock',
        tickSize: '0.01',
        lotSize: '0.01',
        minNotional: '10000000',
        maintenanceMarginBps: '1000',
        liquidationPenaltyBps: '100',
        windows: { A: risk, B: risk, C: risk, D: risk },
      },
    });
    const e = decodeEvent(v1);
    expect(e.input).toMatchObject({
      fundingInterestBpsPerYear: 0n,
      windows: {
        A: { makerFeeBps: 5n, takerFeeBps: 5n, fundingCapPpmPerHour: null, fundingOiCap: null },
      },
    });
  });

  it('verifies the hash chain and detects tampering and gaps', () => {
    let prev = GENESIS_HASH;
    const records = events.map((e) => {
      const body = encodeEvent(e);
      prev = chainHash(prev, body);
      return { seq: e.seq, body, hash: prev };
    });
    expect(verifyChain(records)).toBe(prev);
    const tampered = records.map((r, i) =>
      i === 2
        ? { ...r, body: Buffer.from(r.body.toString().replace('10000000000', '90000000000')) }
        : r,
    );
    expect(() => verifyChain(tampered)).toThrow(/hash mismatch at seq 3/);
    expect(() => verifyChain([records[0], records[2]].filter((r) => r !== undefined))).toThrow(
      /sequence gap/,
    );
  });
});
