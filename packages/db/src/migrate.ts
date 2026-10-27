import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations, planMigrations, type AppliedMigration } from './migrations.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

const ensureTable = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    text PRIMARY KEY,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

// Serialises concurrent migrators (e.g. several services starting at once).
const LOCK_KEY = 7_340_001;

export interface MigrateResult {
  readonly applied: readonly string[];
}

export async function migrate(
  databaseUrl: string,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrateResult> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(ensureTable);
    const { rows } = await client.query<AppliedMigration>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    const { pending } = planMigrations(await loadMigrations(dir), rows);
    const applied: string[] = [];
    for (const m of pending) {
      if (m.transactional) await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          m.version,
          m.checksum,
        ]);
        if (m.transactional) await client.query('COMMIT');
      } catch (err) {
        if (m.transactional) await client.query('ROLLBACK');
        throw new Error(`migration ${m.version} failed`, { cause: err });
      }
      applied.push(m.version);
    }
    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

export async function migrationStatus(
  databaseUrl: string,
  dir: string = MIGRATIONS_DIR,
): Promise<{ applied: string[]; pending: string[] }> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(ensureTable);
    const { rows } = await client.query<AppliedMigration>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    const { pending } = planMigrations(await loadMigrations(dir), rows);
    return { applied: rows.map((r) => r.version), pending: pending.map((m) => m.version) };
  } finally {
    await client.end();
  }
}
