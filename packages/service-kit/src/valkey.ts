import { Redis } from 'ioredis';

/**
 * Valkey connection (ADR-0010: ioredis is wire-compatible). Use separate connections for
 * blocking reads (XREAD BLOCK), pub/sub subscribers and normal commands.
 */
export function createValkey(url: string, name: string): Redis {
  return new Redis(url, {
    connectionName: name,
    maxRetriesPerRequest: null,
    enableAutoPipelining: true,
  });
}

export type { Redis };
