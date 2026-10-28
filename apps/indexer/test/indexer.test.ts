import { describe, expect, it } from 'vitest';
import { toEngineInput, VaultIndexer, type ChainReader, type VaultLog } from '../src/indexer.ts';

const tx = `0x${'ab'.repeat(32)}` as const;
const log = (
  block: bigint,
  logIndex: number,
  eventName: VaultLog['eventName'],
  args: Record<string, unknown>,
): VaultLog => ({
  eventName,
  args,
  blockNumber: block,
  logIndex,
  transactionHash: tx,
});
const USER = '0x00000000000000000000000000000000000A11CE';

function fakeChain(logs: VaultLog[], safe: bigint) {
  const state = {
    safe,
    cursor: undefined as bigint | undefined,
    sent: [] as Record<string, unknown>[],
  };
  const reader: ChainReader = {
    safeBlock: () => Promise.resolve(state.safe),
    logs: (from, to) =>
      Promise.resolve(logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to)),
  };
  return { state, reader };
}

describe('vault indexer (M5-09)', () => {
  it('maps Vault logs to engine inputs (lower-case accounts, tx keys)', () => {
    expect(
      toEngineInput(log(5n, 0, 'GenesisFunded', { houseAmount: 50n, insuranceAmount: 5n })),
    ).toEqual({
      type: 'GenesisCapital',
      house: 50n,
      insurance: 5n,
      source: 'chain',
    });
    expect(toEngineInput(log(6n, 2, 'Deposited', { user: USER, amount: 7n }))).toEqual({
      type: 'ChainDeposit',
      account: USER.toLowerCase(),
      amount: 7n,
      txHash: tx,
      logIndex: 2,
    });
    expect(
      toEngineInput(log(7n, 1, 'Withdrawn', { user: USER, amount: 3n, nonce: 9n })),
    ).toMatchObject({
      type: 'VaultWithdrawn',
      nonce: 9n,
    });
  });

  it('forwards in chain order up to the safe block only, then advances the cursor', async () => {
    const logs = [
      log(12n, 1, 'Deposited', { user: USER, amount: 2n }),
      log(10n, 0, 'GenesisFunded', { houseAmount: 1n, insuranceAmount: 1n }),
      log(12n, 0, 'Deposited', { user: USER, amount: 1n }),
      log(20n, 0, 'Deposited', { user: USER, amount: 3n }), // not yet safe
    ];
    const { state, reader } = fakeChain(logs, 15n);
    const ix = new VaultIndexer({
      reader,
      cursor: {
        get: () => Promise.resolve(state.cursor),
        set: (b) => Promise.resolve(void (state.cursor = b)),
      },
      sink: (i) => Promise.resolve(void state.sent.push(i)),
      startBlock: 10n,
      maxRange: 100n,
    });
    expect(await ix.step()).toBe(3);
    expect(state.sent.map((i) => [i['type'], i['amount'] ?? i['house']])).toEqual([
      ['GenesisCapital', 1n],
      ['ChainDeposit', 1n],
      ['ChainDeposit', 2n],
    ]);
    expect(state.cursor).toBe(15n);
    expect(await ix.step()).toBe(0); // nothing new is safe
    state.safe = 25n;
    expect(await ix.step()).toBe(1);
  });

  it('does not advance the cursor when forwarding fails (at-least-once)', async () => {
    const { state, reader } = fakeChain(
      [log(10n, 0, 'Deposited', { user: USER, amount: 1n })],
      10n,
    );
    const ix = new VaultIndexer({
      reader,
      cursor: {
        get: () => Promise.resolve(state.cursor),
        set: (b) => Promise.resolve(void (state.cursor = b)),
      },
      sink: () => Promise.reject(new Error('valkey down')),
      startBlock: 10n,
    });
    await expect(ix.step()).rejects.toThrow('valkey down');
    expect(state.cursor).toBeUndefined();
  });
});
