import { createPublicClient, http, type Address } from 'viem';
import { VAULT_EVENTS } from './abi.ts';
import type { ChainReader, VaultLog } from './indexer.ts';

/** viem reader for the Vault: `safe` tag head, logs by range. */
export function viemReader(rpcUrl: string, vault: Address): ChainReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    async safeBlock() {
      return (await client.getBlock({ blockTag: 'safe' })).number;
    },
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
