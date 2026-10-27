import { describe, expect, it } from 'vitest';
import { isDeployPath, scanFiles } from './guard-scan.ts';

describe('DEV_LOGIN static guard', () => {
  it('accepts dev login with the sim tier (or no tier) in local configs', () => {
    expect(
      scanFiles([
        { path: '.env.example', content: 'DATA_TIER=sim\nDEV_LOGIN=false\n' },
        { path: 'compose.yaml', content: 'environment:\n  DEV_LOGIN: "true"\n  DATA_TIER: sim\n' },
        { path: '.github/workflows/ci.yml', content: 'env:\n  DEV_LOGIN: true\n' },
      ]),
    ).toEqual([]);
  });

  it('flags dev login combined with a non-sim tier', () => {
    const findings = scanFiles([
      { path: 'compose.yaml', content: 'environment:\n  DEV_LOGIN: "1"\n  DATA_TIER: live-min\n' },
      { path: '.env.replay', content: 'DEV_LOGIN=yes\nDATA_TIER=replay\n' },
      {
        path: 'package.json',
        content: '{"scripts":{"x":"DEV_LOGIN=true DATA_TIER=replay node a"}}',
      },
    ]);
    expect(findings.map((f) => [f.path, f.line])).toEqual([
      ['compose.yaml', 3],
      ['.env.replay', 2],
      ['package.json', 1],
    ]);
    expect(findings[0]?.message).toMatch(/requires DATA_TIER=sim/);
  });

  it.each([
    'infra/deploy/prod.env',
    'apps/web/Dockerfile',
    'Dockerfile.api',
    'compose.prod.yaml',
    '.github/workflows/deploy-staging.yml',
  ])('flags any truthy DEV_LOGIN in deploy config %s', (path) => {
    expect(isDeployPath(path)).toBe(true);
    const findings = scanFiles([{ path, content: 'ENV DEV_LOGIN=true\nENV DATA_TIER=sim\n' }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/must never ship/);
  });

  it('ignores prose and source files', () => {
    expect(
      scanFiles([
        { path: 'README.md', content: 'Set DEV_LOGIN=true with DATA_TIER=replay to break CI.' },
        {
          path: 'packages/shared/src/x.test.ts',
          content: "DEV_LOGIN: 'true', DATA_TIER: 'replay'",
        },
      ]),
    ).toEqual([]);
  });
});
