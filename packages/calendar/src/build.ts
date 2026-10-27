// Node-only: reads and validates the curated calendar YAML (ADR-0004).
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir, ConfigError, loadYamlConfig } from '@euroedge/shared/config';
import { calendarFileSchema, type CalendarFile } from './schema.ts';

export const GENERATED_PATH = fileURLToPath(new URL('./generated/calendars.ts', import.meta.url));

export async function loadCalendarFiles(
  dir = join(configDir(), 'calendars'),
): Promise<CalendarFile[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort();
  const cals: CalendarFile[] = [];
  for (const f of files) {
    const cal = await loadYamlConfig(join(dir, f), calendarFileSchema);
    if (`${cal.venue}.yaml` !== f)
      throw new ConfigError(join(dir, f), [`file must be named ${cal.venue}.yaml`]);
    cals.push(cal);
  }
  return cals;
}

export async function buildCalendarsModule(dir?: string): Promise<string> {
  const cals = await loadCalendarFiles(dir);
  return [
    '// GENERATED from config/calendars/*.yaml by `pnpm --filter @euroedge/calendar gen`. Do not edit.',
    "import type { CalendarFile } from '../schema.ts';",
    '',
    `export const CALENDAR_FILES: readonly CalendarFile[] = ${JSON.stringify(cals, null, 2)};`,
    '',
  ].join('\n');
}
