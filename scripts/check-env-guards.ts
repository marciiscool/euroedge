// CI guard (founder rule, 2026-10-27): fail if DEV_LOGIN=true is combined with DATA_TIER≠sim,
// or appears in any deploy config. Checks the running environment and every tracked config file.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ConfigError, loadEnv, scanFiles, SCANNED_PATH } from '@euroedge/shared/config';

const problems: string[] = [];

try {
  loadEnv({});
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  problems.push(...err.issues.map((i) => `environment: ${i}`));
}

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((p) => p !== '' && SCANNED_PATH.test(p));
const findings = scanFiles(tracked.map((path) => ({ path, content: readFileSync(path, 'utf8') })));
problems.push(...findings.map((f) => `${f.path}:${f.line}: ${f.message}`));

if (problems.length > 0) {
  console.error(`env guard failed:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`env guard ok (environment + ${tracked.length} tracked config files)`);
