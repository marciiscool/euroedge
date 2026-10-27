import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, migrationStatus } from '../src/migrate.ts';

const url = process.env['DATABASE_URL'];

// Integration test: runs when DATABASE_URL points at a TimescaleDB instance
// (docker compose locally, a service container in CI). Uses a throwaway database.
describe.skipIf(url === undefined)('migrate (integration)', () => {
  const dbName = `euroedge_test_${process.pid}`;
  let testUrl = '';

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const u = new URL(url ?? '');
    u.pathname = `/${dbName}`;
    testUrl = u.toString();
  });

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it('applies all migrations once and is idempotent', async () => {
    const first = await migrate(testUrl);
    expect(first.applied).toContain('0001_init');
    const second = await migrate(testUrl);
    expect(second.applied).toEqual([]);
    const status = await migrationStatus(testUrl);
    expect(status.pending).toEqual([]);
  });

  it('enabled TimescaleDB', async () => {
    const c = new pg.Client({ connectionString: testUrl });
    await c.connect();
    const { rows } = await c.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'timescaledb'",
    );
    await c.end();
    expect(rows).toHaveLength(1);
  });
});
