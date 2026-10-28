import { resolveUnits } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import { FLAT } from '@euroedge/risk-core';
import type { EngineEvent, EngineInput } from './events.ts';
import { assertInvariants } from './invariants.ts';
import { liquidateUnderwater } from './liquidation.ts';
import { cancelMarketOrders, cancelOrder, matchResting, placeRestingOrder } from './limits.ts';
import { evaluateCapitalFloor } from './capital.ts';
import { evaluateHouseLoss, rollHouseDay } from './house-risk.ts';
import { executeOrder } from './orders.ts';
import { requestWithdrawal, settleWithdrawal } from './withdrawals.ts';
import { applyDividend } from './dividends.ts';
import { trackSnap } from './snap.ts';
import { adjustMarket, freezeMarket, unfreezeMarket } from './corporate-actions.ts';
import { HOUR_MS, settleFunding } from './funding.ts';
import type { EngineOutput } from './outputs.ts';
import type { EarningsStep, EngineState } from './state.ts';

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
  // Hourly funding first: hours that ended before this input settle at the pre-input state.
  const out = [
    ...settleFunding(state, e.ts),
    ...rollHouseDay(state, e.ts),
    ...dispatch(state, e.input, e.ts),
  ];
  // CB7 and the daily loss limit on the post-event state; they take effect from the next input.
  out.push(...evaluateCapitalFloor(state), ...evaluateHouseLoss(state));
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
      state.genesisCapital = { house: input.house, insurance: input.insurance };
      state.houseRisk.dayStartEquity += input.house;
      return [];
    }

    case 'HouseRiskParams':
      state.houseRisk.dailyLossLimit = input.dailyLossLimit;
      return [];

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
        windows: input.windows,
        fundingInterestBpsPerYear: input.fundingInterestBpsPerYear,
        partialLiquidationBufferBps: input.partialLiquidationBufferBps,
        flowParams: input.flow,
        flow: existing?.flow ?? { sum: 0n, sec: ts / 1000n, window: 0n, wallets: new Map() },
        funding: existing?.funding ?? { lastHour: ts / HOUR_MS, index: 0n, lastRate: 0n },
        data: existing?.data,
        house: existing?.house ?? FLAT,
        corporateAction: existing?.corporateAction ?? null,
        earnings: existing?.earnings ?? new Map<string, EarningsStep>(),
        snap: existing?.snap ?? null,
        snapReduceOnlyUntil: existing?.snapReduceOnlyUntil ?? null,
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
      trackSnap(m, input, ts);
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
      out.push(...matchResting(state, m.id), ...liquidateUnderwater(state, m.id));
      return out;
    }

    case 'DevDeposit': {
      if (!state.genesis) return ignored(input, 'before genesis');
      if (!state.accounts.has(input.account))
        state.accounts.set(input.account, { id: input.account, positions: new Map() });
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
      if (
        input.limitPrice !== undefined ||
        input.stop !== undefined ||
        input.timeInForce !== undefined ||
        input.postOnly !== undefined
      )
        return placeRestingOrder(state, {
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          account: input.account,
          market: input.market,
          qty: input.side === 'buy' ? input.qty : -input.qty,
          reduceOnly: input.reduceOnly,
          limitPrice: input.limitPrice ?? null,
          stop: input.stop ?? null,
          ocoGroup: input.ocoGroup ?? null,
          timeInForce: input.timeInForce ?? 'gtc',
          postOnly: input.postOnly ?? false,
        });
      return executeOrder(state, {
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        account: input.account,
        market: input.market,
        qty: input.side === 'buy' ? input.qty : -input.qty,
        reduceOnly: input.reduceOnly,
      });

    case 'CancelOrder':
      return cancelOrder(state, input);

    case 'EarningsWindow': {
      const m = state.markets.get(input.market);
      if (m === undefined) return ignored(input, 'unknown market');
      if (input.endTs <= input.startTs) return ignored(input, 'empty window');
      m.earnings.set(input.id, {
        startTs: input.startTs,
        endTs: input.endTs,
        maxLeverage: input.maxLeverage,
      });
      return [{ type: 'MarketChanged', market: m.id }];
    }

    case 'CorporateActionFreeze':
      return freezeMarket(state, input, (market) => cancelMarketOrders(state, market));

    case 'CorporateActionAdjust':
      return adjustMarket(state, input);

    case 'CorporateActionUnfreeze':
      return unfreezeMarket(state, input);

    case 'DividendExDate':
      return applyDividend(state, input);

    case 'RequestWithdrawal':
      return requestWithdrawal(state, input);

    case 'WithdrawalExecuted':
      return settleWithdrawal(state, input.withdrawalId, 'executed');

    case 'WithdrawalExpired':
      return settleWithdrawal(state, input.withdrawalId, 'expired');

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
