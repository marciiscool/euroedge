import { resolveUnits } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import { FLAT } from '@euroedge/risk-core';
import type { EngineEvent, EngineInput } from './events.ts';
import { advanceFunding } from './funding.ts';
import { assertInvariants } from './invariants.ts';
import { liquidateUnderwater } from './liquidation.ts';
import { executeOrder } from './orders.ts';
import type { EngineOutput } from './outputs.ts';
import type { EngineState } from './state.ts';

/**
 * The deterministic reducer (ADR-0001): applies one logged input to the state and returns
 * the derived outputs. No clock, no I/O, no randomness. Invariants are asserted after every
 * event; a violation throws and the caller fail-stops.
 */
export function apply(state: EngineState, e: EngineEvent): EngineOutput[] {
  if (e.seq !== state.seq + 1n)
    throw new Error(`out-of-order event: expected seq ${state.seq + 1n}, got ${e.seq}`);
  if (e.ts < state.ts) throw new Error(`time went backwards at seq ${e.seq}`);
  state.seq = e.seq;
  state.ts = e.ts;
  // Funding first: the index accrues at the state in force before this input.
  const out = [...advanceFunding(state, e.ts), ...dispatch(state, e.input, e.ts)];
  assertInvariants(state);
  return out;
}

const ignored = (input: EngineInput, reason: string): EngineOutput[] => [
  { type: 'InputIgnored', input: input.type, reason },
];

function dispatch(state: EngineState, input: EngineInput, ts: bigint): EngineOutput[] {
  switch (input.type) {
    case 'ClockTick':
      return [];

    case 'GenesisCapital': {
      if (state.genesis) return ignored(input, 'genesis already applied');
      state.ledger.post([
        { from: SYSTEM.external, to: SYSTEM.house, amount: input.house, reason: 'genesis' },
        { from: SYSTEM.external, to: SYSTEM.insurance, amount: input.insurance, reason: 'genesis' },
      ]);
      state.netDeposits += input.house + input.insurance;
      state.genesis = true;
      return [];
    }

    case 'MarketListed': {
      let units;
      try {
        units = resolveUnits({ tickSize: input.tickSize, lotSize: input.lotSize });
      } catch (err) {
        return ignored(input, err instanceof Error ? err.message : 'invalid units');
      }
      const existing = state.markets.get(input.market);
      const sameUnits =
        existing === undefined ||
        (existing.units.tickSize === units.tickSize && existing.units.lotSize === units.lotSize);
      if (!sameUnits && hasOpenInterest(state, input.market)) {
        return ignored(input, 'units cannot change while positions are open');
      }
      state.markets.set(input.market, {
        id: input.market,
        kind: input.kind,
        units,
        minNotional: input.minNotional,
        maintenanceMarginBps: input.maintenanceMarginBps,
        liquidationPenaltyBps: input.liquidationPenaltyBps,
        fundingInterestBpsPerYear: input.fundingInterestBpsPerYear,
        windows: input.windows,
        data: existing?.data,
        funding: existing?.funding ?? {
          index: 0n,
          lastTs: ts,
          quantoDrift: 0n,
          house: { snap: 0n, pending: 0n },
        },
        house: existing?.house ?? FLAT,
      });
      return [{ type: 'MarketChanged', market: input.market }];
    }

    case 'MarketData': {
      const m = state.markets.get(input.market);
      if (m === undefined) return ignored(input, 'unknown market');
      if (!(input.bandLo <= input.fv && input.fv <= input.bandHi))
        return ignored(input, 'fv outside band');
      // Invariant 5 at the boundary: a mark outside the band never enters the state.
      if (input.mark < input.bandLo || input.mark > input.bandHi)
        return ignored(input, 'mark outside band');
      m.data = {
        window: input.window,
        fv: input.fv,
        bandLo: input.bandLo,
        bandHi: input.bandHi,
        index: input.index,
        mark: input.mark,
        sigmaPpm: input.sigmaPpm,
        breaker: input.breaker,
        ts,
      };
      const out: EngineOutput[] = [{ type: 'MarketChanged', market: m.id }];
      if (input.markClamped) {
        out.push({
          type: 'MarkClamped',
          market: m.id,
          mark: input.mark,
          bandLo: input.bandLo,
          bandHi: input.bandHi,
        });
      }
      out.push(...liquidateUnderwater(state, m.id));
      return out;
    }

    case 'DevDeposit': {
      if (!state.genesis) return ignored(input, 'before genesis');
      if (!state.accounts.has(input.account))
        state.accounts.set(input.account, {
          id: input.account,
          positions: new Map(),
          funding: new Map(),
        });
      state.ledger.post([
        {
          from: SYSTEM.external,
          to: userAccount(input.account),
          amount: input.amount,
          reason: 'deposit',
        },
      ]);
      state.netDeposits += input.amount;
      return [{ type: 'AccountChanged', account: input.account }];
    }

    case 'PlaceOrder':
      return executeOrder(state, {
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        account: input.account,
        market: input.market,
        qty: input.side === 'buy' ? input.qty : -input.qty,
        reduceOnly: input.reduceOnly,
      });

    case 'ClosePosition':
      return executeOrder(state, {
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        account: input.account,
        market: input.market,
        qty: undefined,
        reduceOnly: true,
      });
  }
}

function hasOpenInterest(state: EngineState, market: string): boolean {
  for (const acc of state.accounts.values())
    if ((acc.positions.get(market)?.lots ?? 0n) !== 0n) return true;
  return false;
}
