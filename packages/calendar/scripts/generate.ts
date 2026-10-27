// Compiles config/calendars/*.yaml into src/generated/calendars.ts (browser-safe, synchronous).
// Run: pnpm --filter @euroedge/calendar gen
import { writeFile } from 'node:fs/promises';
import { buildCalendarsModule, GENERATED_PATH } from '../src/build.ts';

await writeFile(GENERATED_PATH, await buildCalendarsModule());
console.log(`wrote ${GENERATED_PATH}`);
