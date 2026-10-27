import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMigrations, parseMigration, planMigrations } from './migrations.ts';

describe('parseMigration', () => {
  it('derives version, checksum and transactional flag', () => {
    const m = parseMigration('0001_init.sql', 'SELECT 1;');
    expect(m.version).toBe('0001_init');
    expect(m.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(m.transactional).toBe(true);
  });

  it('honours the no-transaction marker', () => {
    const m = parseMigration(
      '0002_idx.sql',
      '-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY x;',
    );
    expect(m.transactional).toBe(false);
  });

  it.each(['1_init.sql', '0001-init.sql', '0001_Init.sql', '0001_init.txt'])(
    'rejects bad file name %s',
    (name) => expect(() => parseMigration(name, '')).toThrow(/invalid migration file name/),
  );
});

describe('planMigrations', () => {
  const a = parseMigration('0001_a.sql', 'A');
  const b = parseMigration('0002_b.sql', 'B');

  it('returns unapplied migrations in order', () => {
    expect(planMigrations([a, b], []).pending.map((m) => m.version)).toEqual(['0001_a', '0002_b']);
    expect(planMigrations([a, b], [a]).pending.map((m) => m.version)).toEqual(['0002_b']);
  });

  it('fails when an applied migration was modified', () => {
    expect(() => planMigrations([a], [{ version: '0001_a', checksum: 'x' }])).toThrow(/modified/);
  });

  it('fails when an applied migration is missing on disk', () => {
    expect(() => planMigrations([b], [a])).toThrow(/missing on disk/);
  });

  it('fails on out-of-order history', () => {
    expect(() => planMigrations([a, b], [b])).toThrow(/sorts before applied/);
  });
});

describe('loadMigrations', () => {
  it('rejects duplicate migration numbers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    await writeFile(join(dir, '0001_a.sql'), 'A');
    await writeFile(join(dir, '0001_b.sql'), 'B');
    await expect(loadMigrations(dir)).rejects.toThrow(/duplicate migration number 0001/);
  });

  it('loads the shipped migrations', async () => {
    const { MIGRATIONS_DIR } = await import('./migrate.ts');
    const migrations = await loadMigrations(MIGRATIONS_DIR);
    expect(migrations[0]?.version).toBe('0001_init');
  });
});
