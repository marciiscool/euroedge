import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { loadYamlConfig } from './yaml.ts';

const schema = z.object({
  markets: z.array(z.object({ id: z.string(), enabled: z.boolean() })),
});

async function tmpYaml(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cfg-'));
  const file = join(dir, 'c.yaml');
  await writeFile(file, contents);
  return file;
}

describe('loadYamlConfig', () => {
  it('parses and validates', async () => {
    const file = await tmpYaml('markets:\n  - id: ASML-PERP\n    enabled: true\n');
    await expect(loadYamlConfig(file, schema)).resolves.toEqual({
      markets: [{ id: 'ASML-PERP', enabled: true }],
    });
  });

  it('reports schema violations with their path', async () => {
    const file = await tmpYaml('markets:\n  - id: ASML-PERP\n    enabled: "yes"\n');
    await expect(loadYamlConfig(file, schema)).rejects.toThrow(/markets\.0\.enabled/);
  });

  it('rejects duplicate keys', async () => {
    const file = await tmpYaml('markets: []\nmarkets: []\n');
    await expect(loadYamlConfig(file, schema)).rejects.toThrow(/invalid configuration/);
  });
});
