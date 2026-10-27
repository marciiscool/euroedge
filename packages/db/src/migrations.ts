import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Migration {
  /** Sortable version, the file name without extension, e.g. `0001_init`. */
  readonly version: string;
  readonly sql: string;
  /** sha256 of the file contents; applied migrations must never change. */
  readonly checksum: string;
  /** Set with a `-- migrate:no-transaction` first line (e.g. CREATE INDEX CONCURRENTLY). */
  readonly transactional: boolean;
}

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
const NO_TRANSACTION = '-- migrate:no-transaction';

export function parseMigration(fileName: string, sql: string): Migration {
  if (!FILE_PATTERN.test(fileName)) {
    throw new Error(`invalid migration file name "${fileName}" (expected NNNN_snake_case.sql)`);
  }
  return {
    version: fileName.slice(0, -'.sql'.length),
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
    transactional: !sql.trimStart().startsWith(NO_TRANSACTION),
  };
}

/** Reads `dir/*.sql`, validates names, returns migrations sorted by version with no duplicates. */
export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations = await Promise.all(
    files.map(async (f) => parseMigration(f, await readFile(join(dir, f), 'utf8'))),
  );
  const prefixes = new Set<string>();
  for (const m of migrations) {
    const prefix = m.version.slice(0, 4);
    if (prefixes.has(prefix)) throw new Error(`duplicate migration number ${prefix}`);
    prefixes.add(prefix);
  }
  return migrations;
}

export interface AppliedMigration {
  readonly version: string;
  readonly checksum: string;
}

export interface MigrationPlan {
  readonly pending: readonly Migration[];
}

/**
 * Compares files with the applied set. Fails if an applied migration was edited or deleted,
 * or if a new file sorts before the latest applied one (out-of-order history).
 */
export function planMigrations(
  available: readonly Migration[],
  applied: readonly AppliedMigration[],
): MigrationPlan {
  const byVersion = new Map(available.map((m) => [m.version, m]));
  for (const a of applied) {
    const file = byVersion.get(a.version);
    if (file === undefined) throw new Error(`applied migration ${a.version} is missing on disk`);
    if (file.checksum !== a.checksum) {
      throw new Error(`applied migration ${a.version} was modified (checksum mismatch)`);
    }
  }
  const appliedVersions = new Set(applied.map((a) => a.version));
  const latestApplied = applied
    .map((a) => a.version)
    .sort()
    .at(-1);
  const pending = available.filter((m) => !appliedVersions.has(m.version));
  const early = pending.find((m) => latestApplied !== undefined && m.version < latestApplied);
  if (early !== undefined) {
    throw new Error(`migration ${early.version} sorts before applied ${latestApplied}`);
  }
  return { pending };
}
