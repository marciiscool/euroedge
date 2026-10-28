import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { migrate } from '@euroedge/db';
import type { EngineEvent } from '../src/core/events.ts';
import { decodeEvent, verifyChain } from '../src/log/codec.ts';
import { EventStore } from '../src/log/store.ts';

const url = process.env['DATABASE_URL'];

describe.skipIf(url === undefined)('EventStore (integration)', () => {
  const dbName = `euroedge_store_${process.pid}`;
  let testUrl = '';

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const u = new URL(url ?? '');
    u.pathname = `/${dbName}`;
    testUrl = u.toString();
    await migrate(testUrl);
  });

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  const ev = (seq: bigint): EngineEvent => ({
    seq,
    ts: 1_793_000_000_000n + seq,
    v: 1,
    input:
      seq === 1n
        ? { type: 'GenesisCapital', house: usdc(1n), insurance: usdc(1n), source: 'dev' }
        : { type: 'ClockTick' },
  });

  it('appends in batches with the cursor, reads back, and the chain verifies', async () => {
    const store = new EventStore(testUrl);
    await store.acquireWriterLock();
    await store.append([ev(1n), ev(2n), ev(3n)], '1-0');
    await store.append([ev(4n)], '2-0');
    await expect(store.append([ev(6n)])).rejects.toThrow(/out of sequence/);
    const head = store.head;
    await store.close();

    const reader = new EventStore(testUrl);
    const records = [];
    for await (const r of reader.readAll(2)) records.push(r);
    expect(records.map((r) => r.seq)).toEqual([1n, 2n, 3n, 4n]);
    expect(verifyChain(records)).toBe(head.hash);
    expect(decodeEvent(records[0]?.body ?? Buffer.alloc(0)).input.type).toBe('GenesisCapital');
    expect(await reader.cursor()).toBe('2-0');
    expect(reader.head).toEqual(head);
    await reader.close();
  });

  it('is append-only and single-writer', async () => {
    const a = new EventStore(testUrl);
    await a.acquireWriterLock();
    const b = new EventStore(testUrl);
    await expect(b.acquireWriterLock()).rejects.toThrow(/writer lock/);
    await b.close();
    const c = new pg.Client({ connectionString: testUrl });
    await c.connect();
    await expect(
      c.query('UPDATE engine_events SET type = $1 WHERE seq = 1', ['x']),
    ).rejects.toThrow(/append-only/);
    await expect(c.query('DELETE FROM engine_events')).rejects.toThrow(/append-only/);
    await c.end();
    await a.close();
  });

  it('stores snapshots for the writer and returns the newest', async () => {
    const store = new EventStore(testUrl);
    for await (const _ of store.readAll()) void _;
    await expect(
      store.writeSnapshot({
        seq: 1n,
        chainHash: store.head.hash,
        digest: 'd1',
        body: Buffer.from('{}'),
      }),
    ).rejects.toThrow(/writer lock/);
    await store.acquireWriterLock();
    await store.writeSnapshot({
      seq: 2n,
      chainHash: 'ab',
      digest: 'd2',
      body: Buffer.from('{"a":1}'),
    });
    await store.writeSnapshot({
      seq: 4n,
      chainHash: 'cd',
      digest: 'd4',
      body: Buffer.from('{"a":2}'),
    });
    await store.writeSnapshot({
      seq: 4n,
      chainHash: 'ef',
      digest: 'other',
      body: Buffer.from('x'),
    });
    expect((await store.snapshots(true)).map((s) => [s.seq, s.chainHash, s.digest])).toEqual([
      [4n, 'cd', 'd4'],
    ]);
    expect((await store.snapshots()).map((s) => s.seq)).toEqual([2n, 4n]);
    await store.close();
  });
});
