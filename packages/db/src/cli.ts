import { migrate, migrationStatus } from './migrate.ts';

const url = process.env['DATABASE_URL'];
if (url === undefined || url === '') {
  console.error('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const command = process.argv[2];
if (command === 'migrate') {
  const { applied } = await migrate(url);
  console.log(applied.length === 0 ? 'up to date' : `applied: ${applied.join(', ')}`);
} else if (command === 'status') {
  const { applied, pending } = await migrationStatus(url);
  console.log(`applied: ${applied.join(', ') || '-'}\npending: ${pending.join(', ') || '-'}`);
} else {
  console.error('usage: cli.ts <migrate|status>');
  process.exit(1);
}
