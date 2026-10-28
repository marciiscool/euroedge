// Log verifier (M4-19): `pnpm --filter @euroedge/engine verify` with DATABASE_URL set.
// Replays the whole log from genesis (invariants on every event), checks the hash chain and
// compares every stored snapshot with the replayed state. Exits 1 on any mismatch.
import { verifyLog } from './log/restore.ts';
import { EventStore } from './log/store.ts';

const url = process.env['DATABASE_URL'];
if (url === undefined) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}
const store = new EventStore(url);
try {
  const snapshots = new Map((await store.snapshots()).map((s) => [s.seq, s]));
  const r = await verifyLog(store.readAll(), snapshots);
  console.log(
    JSON.stringify({
      events: r.events.toString(),
      head: r.head,
      digest: r.digest,
      snapshotsChecked: r.snapshotsChecked,
      failures: r.failures,
    }),
  );
  process.exitCode = r.failures.length === 0 ? 0 : 1;
} finally {
  await store.close();
}
