import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

/** Table types grow with each milestone's migrations. */
export interface Database {
  schema_migrations: {
    version: string;
    checksum: string;
    applied_at: Date;
  };
}

export interface DbOptions {
  readonly databaseUrl: string;
  readonly maxConnections?: number;
}

// BIGINT (int8) columns must never become JS numbers: money, ticks and seqs are bigint.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => BigInt(v));

export function createDb({ databaseUrl, maxConnections = 10 }: DbOptions): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: databaseUrl, max: maxConnections }),
    }),
  });
}
