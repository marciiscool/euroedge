import { createPublicClient, http, type Address } from 'viem';
import { VAULT_EVENTS, VAULT_READS } from './abi.ts';
import type { ExpiryChain } from './expiry.ts';
import type { ChainReader, VaultLog } from './indexer.ts';

/** viem reader for the Vault: `safe` tag head, logs by range, nonce state for expiries. */
export function viemReader(rpcUrl: string, vault: Address): ChainReader & ExpiryChain {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    async safeBlock() {
      return (await client.getBlock({ blockTag: 'safe' })).number;
    },
    async safeHead() {
      const b = await client.getBlock({ blockTag: 'safe' });
      return { number: b.number, timestamp: b.timestamp };
    },
    nonceUsed: (nonce, block) =>
      client.readContract({
        address: vault,
        abi: VAULT_READS,
        functionName: 'nonceUsed',
        args: [nonce],
        blockNumber: block,
      }),
    async logs(fromBlock, toBlock) {
      const logs = await client.getLogs({
        address: vault,
        events: VAULT_EVENTS,
        fromBlock,
        toBlock,
      });
      return logs.map((l): VaultLog => ({
        eventName: l.eventName,
        args: l.args,
        blockNumber: l.blockNumber,
        logIndex: l.logIndex,
        transactionHash: l.transactionHash,
      }));
    },
  };
}
