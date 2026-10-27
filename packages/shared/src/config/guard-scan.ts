/**
 * Static scan for the DEV_LOGIN rule (founder, 2026-10-27): CI fails if any tracked config
 * enables DEV_LOGIN together with a non-sim DATA_TIER, or enables it in a deploy config at all.
 */

export interface ScannedFile {
  readonly path: string;
  readonly content: string;
}

export interface GuardFinding {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** Files whose purpose is a deployed build. DEV_LOGIN must never be truthy here. */
const DEPLOY_PATH =
  /(^|\/)(infra\/deploy\/|Dockerfile[^/]*$|compose\.(prod|production|staging)[^/]*$|\.github\/workflows\/deploy[^/]*$)/;

/** Config-like files worth scanning (prose and source code are not). */
export const SCANNED_PATH =
  /(^|\/)(\.env[^/]*|[^/]+\.ya?ml|Dockerfile[^/]*|package\.json|[^/]+\.sh)$|(^|\/)infra\//;

// zod's stringbool truthy values, as KEY=value, KEY: value or "KEY": "value".
const DEV_LOGIN_TRUE = /["']?\bDEV_LOGIN["']?\s*[:=]\s*["']?(true|1|yes|on|y|enabled)\b/i;
const DATA_TIER_VALUE = /["']?\bDATA_TIER["']?\s*[:=]\s*["']?([\w-]+)/;

export function isDeployPath(path: string): boolean {
  return DEPLOY_PATH.test(path);
}

export function scanFile({ path, content }: ScannedFile): GuardFinding[] {
  const lines = content.split('\n');
  const devLoginLines = lines.flatMap((l, i) => (DEV_LOGIN_TRUE.test(l) ? [i + 1] : []));
  if (devLoginLines.length === 0) return [];

  if (isDeployPath(path)) {
    return devLoginLines.map((line) => ({
      path,
      line,
      message: 'DEV_LOGIN=true in a deploy config; dev login must never ship',
    }));
  }

  const tiers = lines.flatMap((l, i) => {
    const m = DATA_TIER_VALUE.exec(l);
    return m?.[1] !== undefined && m[1] !== 'sim' ? [{ line: i + 1, tier: m[1] }] : [];
  });
  return tiers.map(({ line, tier }) => ({
    path,
    line,
    message: `DEV_LOGIN=true together with DATA_TIER=${tier}; dev login requires DATA_TIER=sim`,
  }));
}

export function scanFiles(files: readonly ScannedFile[]): GuardFinding[] {
  return files.filter((f) => SCANNED_PATH.test(f.path)).flatMap(scanFile);
}
