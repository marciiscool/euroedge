import type pg from 'pg';
import type { CursorStore } from './indexer.ts';

export function pgCursor(db: pg.Pool, chainId: number): CursorStore {
  return {
    async get() {
      const { rows } = await db.query<{ block: string }>(
        'SELECT block::text FROM indexer_cursor WHERE chain_id = $1',
        [chainId],
      );
      return rows[0] === undefined ? undefined : BigInt(rows[0].block);
    },
    async set(block) {
      await db.query(
        `INSERT INTO indexer_cursor (chain_id, block) VALUES ($1, $2)
         ON CONFLICT (chain_id) DO UPDATE SET block = GREATEST(indexer_cursor.block, EXCLUDED.block)`,
        [chainId, block.toString()],
      );
    },
  };
}
