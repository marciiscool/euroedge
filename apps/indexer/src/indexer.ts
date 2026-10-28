/**
 * Vault indexer (M5-09). Reads logs only up to the chain's `safe` block, so what it forwards
 * does not reorg away; forwarding is at-least-once and the engine applies each log once
 * (txHash, logIndex). The cursor advances only after a range was forwarded.
 */
export interface VaultLog {
  readonly eventName: 'Deposited' | 'Withdrawn' | 'GenesisFunded';
  readonly args: Record<string, unknown>;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: `0x${string}`;
}

export interface ChainReader {
  safeBlock(): Promise<bigint>;
  logs(fromBlock: bigint, toBlock: bigint): Promise<readonly VaultLog[]>;
}

export interface CursorStore {
  /** Last fully forwarded block, or undefined before the first run. */
  get(): Promise<bigint | undefined>;
  set(block: bigint): Promise<void>;
}

export type EngineSink = (input: Record<string, unknown>) => Promise<void>;

/** One Vault log as an engine input (amounts are µUSDC, as on-chain). */
export function toEngineInput(log: VaultLog): Record<string, unknown> {
  const a = log.args;
  const tx = { txHash: log.transactionHash.toLowerCase(), logIndex: log.logIndex };
  switch (log.eventName) {
    case 'GenesisFunded':
      return {
        type: 'GenesisCapital',
        house: a['houseAmount'],
        insurance: a['insuranceAmount'],
        source: 'chain',
      };
    case 'Deposited':
      return {
        type: 'ChainDeposit',
        account: String(a['user']).toLowerCase(),
        amount: a['amount'],
        ...tx,
      };
    case 'Withdrawn':
      return {
        type: 'VaultWithdrawn',
        account: String(a['user']).toLowerCase(),
        amount: a['amount'],
        nonce: a['nonce'],
        ...tx,
      };
  }
}

export class VaultIndexer {
  private readonly reader: ChainReader;
  private readonly cursor: CursorStore;
  private readonly sink: EngineSink;
  private readonly startBlock: bigint;
  private readonly maxRange: bigint;

  constructor(o: {
    reader: ChainReader;
    cursor: CursorStore;
    sink: EngineSink;
    startBlock: bigint;
    maxRange?: bigint;
  }) {
    this.reader = o.reader;
    this.cursor = o.cursor;
    this.sink = o.sink;
    this.startBlock = o.startBlock;
    this.maxRange = o.maxRange ?? 2_000n;
  }

  /**
   * Steps until the cursor reaches the safe block or `maxSteps` ranges are done; returns the
   * number of logs forwarded. Lets a small `maxRange` (free RPC tiers allow 10 blocks per
   * eth_getLogs) still keep up with the chain.
   */
  async catchUp(maxSteps: number): Promise<number> {
    let logs = 0;
    for (let i = 0; i < maxSteps; i++) {
      const before = await this.cursor.get();
      logs += await this.step();
      const after = await this.cursor.get();
      if (after === undefined || after === before || after >= (await this.reader.safeBlock()))
        break;
    }
    return logs;
  }

  /** Forwards one range up to the safe block; returns the number of logs forwarded. */
  async step(): Promise<number> {
    const safe = await this.reader.safeBlock();
    const from = ((await this.cursor.get()) ?? this.startBlock - 1n) + 1n;
    if (from > safe) return 0;
    const to = from + this.maxRange - 1n < safe ? from + this.maxRange - 1n : safe;
    const logs = [...(await this.reader.logs(from, to))].sort((x, y) =>
      x.blockNumber === y.blockNumber
        ? x.logIndex - y.logIndex
        : x.blockNumber < y.blockNumber
          ? -1
          : 1,
    );
    for (const log of logs) await this.sink(toEngineInput(log));
    await this.cursor.set(to);
    return logs.length;
  }
}
