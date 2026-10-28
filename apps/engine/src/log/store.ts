import pg from 'pg';
import type { EngineEvent } from '../core/events.ts';
import { chainHash, encodeEvent, GENESIS_HASH, type ChainedRecord } from './codec.ts';
import type { Snapshot } from './restore.ts';

// Session-level advisory lock: exactly one engine writer per database (ADR-0001).
const WRITER_LOCK_KEY = 7_340_100;

export interface StoredRecord extends ChainedRecord {
  readonly ts: bigint;
}

/** Append-only, hash-chained event log in Postgres. */
export class EventStore {
  private readonly pool: pg.Pool;
  private lockClient: pg.PoolClient | undefined;
  private headHash = GENESIS_HASH;
  private headSeq = 0n;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  }

  /** Takes the single-writer lock; throws if another engine holds it. */
  async acquireWriterLock(): Promise<void> {
    const client = await this.pool.connect();
    const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [
      WRITER_LOCK_KEY,
    ]);
    if (rows[0]?.ok !== true) {
      client.release();
      throw new Error('another engine instance holds the writer lock');
    }
    this.lockClient = client;
  }

  /** Streams all records in seq order (batched) and positions the head after the last one. */
  async *readAll(batchSize = 10_000): AsyncGenerator<StoredRecord> {
    let after = 0n;
    for (;;) {
      const { rows } = await this.pool.query<{
        seq: string;
        ts_ms: string;
        body: Buffer;
        hash: Buffer;
      }>('SELECT seq, ts_ms, body, hash FROM engine_events WHERE seq > $1 ORDER BY seq LIMIT $2', [
        after.toString(),
        batchSize,
      ]);
      for (const r of rows) {
        const rec = {
          seq: BigInt(r.seq),
          ts: BigInt(r.ts_ms),
          body: r.body,
          hash: r.hash.toString('hex'),
        };
        this.headSeq = rec.seq;
        this.headHash = rec.hash;
        yield rec;
      }
      if (rows.length < batchSize) return;
      after = BigInt(rows.at(-1)?.seq ?? '0');
    }
  }

  get head(): { seq: bigint; hash: string } {
    return { seq: this.headSeq, hash: this.headHash };
  }

  /**
   * Group commit: appends events (consecutive seqs after the head) and the input-stream
   * cursor in one transaction. Only the lock holder may call this.
   */
  async append(events: readonly EngineEvent[], cursor?: string): Promise<void> {
    const client = this.lockClient;
    if (client === undefined) throw new Error('append without the writer lock');
    if (events.length === 0 && cursor === undefined) return;
    let hash = this.headHash;
    let seq = this.headSeq;
    const cols = {
      seq: [] as string[],
      ts: [] as string[],
      type: [] as string[],
      v: [] as number[],
      body: [] as Buffer[],
      hash: [] as Buffer[],
      req: [] as (string | null)[],
    };
    for (const e of events) {
      if (e.seq !== seq + 1n) throw new Error(`append out of sequence: head ${seq}, got ${e.seq}`);
      seq = e.seq;
      const body = encodeEvent(e);
      hash = chainHash(hash, body);
      cols.seq.push(e.seq.toString());
      cols.ts.push(e.ts.toString());
      cols.type.push(e.input.type);
      cols.v.push(e.v);
      cols.body.push(body);
      cols.hash.push(Buffer.from(hash, 'hex'));
      cols.req.push('requestId' in e.input ? e.input.requestId : null);
    }
    await client.query('BEGIN');
    try {
      if (events.length > 0) {
        await client.query(
          `INSERT INTO engine_events (seq, ts_ms, type, v, body, hash, request_id)
           SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::smallint[], $5::bytea[], $6::bytea[], $7::text[])`,
          [cols.seq, cols.ts, cols.type, cols.v, cols.body, cols.hash, cols.req],
        );
      }
      if (cursor !== undefined) {
        await client.query(
          'INSERT INTO engine_cursor (id, stream_id) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET stream_id = EXCLUDED.stream_id',
          [cursor],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    this.headSeq = seq;
    this.headHash = hash;
  }

  /** Stores a state snapshot taken right after event `s.seq` was committed (writer only). */
  async writeSnapshot(s: Snapshot): Promise<void> {
    const client = this.lockClient;
    if (client === undefined) throw new Error('snapshot without the writer lock');
    await client.query(
      'INSERT INTO engine_snapshots (seq, chain_hash, digest, body) VALUES ($1, $2, $3, $4) ON CONFLICT (seq) DO NOTHING',
      [s.seq.toString(), Buffer.from(s.chainHash, 'hex'), s.digest, s.body],
    );
  }

  /** The newest snapshot, or all of them (for the verifier). */
  async snapshots(latestOnly = false): Promise<Snapshot[]> {
    const { rows } = await this.pool.query<{
      seq: string;
      chain_hash: Buffer;
      digest: string;
      body: Buffer;
    }>(
      `SELECT seq, chain_hash, digest, body FROM engine_snapshots ORDER BY seq ${latestOnly ? 'DESC LIMIT 1' : 'ASC'}`,
    );
    return rows.map((r) => ({
      seq: BigInt(r.seq),
      chainHash: r.chain_hash.toString('hex'),
      digest: r.digest,
      body: r.body,
    }));
  }

  async cursor(): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ stream_id: string }>(
      'SELECT stream_id FROM engine_cursor WHERE id = 1',
    );
    return rows[0]?.stream_id;
  }

  async close(): Promise<void> {
    if (this.lockClient !== undefined) {
      await this.lockClient
        .query('SELECT pg_advisory_unlock($1)', [WRITER_LOCK_KEY])
        .catch(() => undefined);
      this.lockClient.release();
      this.lockClient = undefined;
    }
    await this.pool.end();
  }
}
