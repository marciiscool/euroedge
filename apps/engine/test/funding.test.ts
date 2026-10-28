import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import type { EngineOutput } from '../src/core/outputs.ts';
import { decodeEvent, encodeEvent } from '../src/log/codec.ts';
import { stateDigest } from '../src/log/digest.ts';
import { replay } from '../src/log/replay.ts';
import { data, Harness, order, USDC } from './fixtures.ts';

const HOUR = 3_600_000n;
/** First UTC hour boundary after the harness start (1 793 000 000 000). */
const H1 = 1_793_001_600_000n;
const H2 = H1 + HOUR;

const settled = (out: EngineOutput[]) =>
  out.filter(
    (o): o is Extract<EngineOutput, { type: 'FundingSettled' }> => o.type === 'FundingSettled',
  );

function longAtH1(window: 'A' | 'D' = 'A') {
  const h = Harness.booted();
  h.at(H1 - 2000n).run(data(70_000n, window));
  h.at(H1).run(order('alice', 'buy', 100n)); // 1 share at ask 700.35 (A) — house short 1.00
  return h;
}

describe('funding (ADR-0016, ADR-0018)', () => {
  it('settles at the UTC hour: the long pays interest + skew, the house receives', () => {
    const h = longAtH1();
    const cash0 = h.state.ledger.balance(userAccount('alice'));
    const house0 = h.state.ledger.balance(SYSTEM.house);
    const fees0 = h.state.ledger.balance(SYSTEM.fees);
    const out = h.at(H2).run({ type: 'ClockTick' });
    // rate = 5 707 762 557 077 + 3e14 × 700 USDC / 2 000 000 USDC = 5 812 762 557 077 Rate/h;
    // owed = 100 lots × 7 000 000 µUSDC × rate / 1e18 = 4 068.93 → long pays 4 069, house gets 4 068.
    expect(settled(out)).toEqual([
      expect.objectContaining({
        market: 'ASML-PERP',
        hourTs: H2,
        paid: 4_069n,
        received: 4_068n,
        residue: 1n,
        insuranceCover: 0n,
      }),
    ]);
    expect(h.state.ledger.balance(userAccount('alice'))).toBe(cash0 - 4_069n);
    expect(h.state.ledger.balance(SYSTEM.house)).toBe(house0 + 4_068n);
    expect(h.state.ledger.balance(SYSTEM.fees)).toBe(fees0 + 1n);
    expect(h.state.ledger.balance(SYSTEM.fundingClearing)).toBe(0n);
  });

  it('Window D is interest only', () => {
    const h = longAtH1('D');
    const out = h.at(H2).run({ type: 'ClockTick' });
    // 7e8 × 5 707 762 557 077 / 1e18 = 3 995.43 → 3 996 / 3 995.
    expect(settled(out)[0]).toMatchObject({ paid: 3_996n, received: 3_995n, residue: 1n });
  });

  it('accrues per unit of event time: a position held 30 min pays half an hour', () => {
    const h = longAtH1();
    h.at(H1 + HOUR / 2n).run({
      type: 'ClosePosition',
      requestId: 'close',
      idempotencyKey: 'close',
      account: 'alice',
      market: 'ASML-PERP',
    });
    const out = h.at(H2).run({ type: 'ClockTick' });
    // Half of 4 068.93 = 2 034.47 → 2 035 / 2 034. Flat afterwards: the accrual is dropped.
    expect(settled(out)[0]).toMatchObject({ paid: 2_035n, received: 2_034n });
    expect(h.state.accounts.get('alice')?.funding.size).toBe(0);
  });

  it('settles every hour passed in one event, accruing to each boundary', () => {
    const h = longAtH1();
    const out = h.at(H1 + 3n * HOUR + 5n).run({ type: 'ClockTick' });
    expect(settled(out).map((s) => s.hourTs)).toEqual([H2, H2 + HOUR, H2 + 2n * HOUR]);
    expect(settled(out).map((s) => s.paid)).toEqual([4_069n, 4_069n, 4_069n]);
  });

  it('a payer without equity pays nothing; insurance covers it', () => {
    const h = Harness.booted();
    h.run({ type: 'DevDeposit', account: 'bob', amount: usdc(200n * USDC) });
    h.at(H1 - 2000n).run(data(70_000n));
    h.at(H1).run(order('bob', 'buy', 142n)); // ≈ 5x
    const liq = h.at(H1 + 600_000n).run(data(50_000n)); // −28 %: wiped out
    expect(liq.some((o) => o.type === 'Liquidated' && o.account === 'bob')).toBe(true);
    expect(h.state.ledger.balance(userAccount('bob'))).toBe(0n);
    const ins0 = h.state.ledger.balance(SYSTEM.insurance);
    const [s] = settled(h.at(H2).run({ type: 'ClockTick' }));
    expect(s?.insuranceCover).toBeGreaterThan(0n);
    expect(h.state.ledger.balance(userAccount('bob'))).toBe(0n);
    expect(h.state.ledger.balance(SYSTEM.insurance)).toBe(ins0 - (s?.insuranceCover ?? 0n));
  });

  it('replay of the log reproduces the funded state bit for bit', () => {
    const h = longAtH1();
    h.at(H1 + 1_234_567n).run(order('alice', 'sell', 40n), data(70_400n));
    h.at(H2 + 99n).run({ type: 'ClockTick' });
    const decoded = h.log.map((e) => decodeEvent(encodeEvent(e)));
    expect(stateDigest(replay(decoded))).toBe(stateDigest(h.state));
  });
});
