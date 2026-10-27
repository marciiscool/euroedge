import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { z } from 'zod';
import { ConfigError } from './errors.ts';

/** Loads a YAML file from `config/` and validates it against a zod schema. */
export async function loadYamlConfig<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = parse(await readFile(path, 'utf8'), { strict: true, uniqueKeys: true });
  } catch (err) {
    throw new ConfigError(path, [err instanceof Error ? err.message : String(err)]);
  }
  return parseConfig(path, raw, schema);
}

export function parseConfig<T extends z.ZodType>(
  source: string,
  raw: unknown,
  schema: T,
): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw ConfigError.fromZod(source, parsed.error);
  return parsed.data;
}
