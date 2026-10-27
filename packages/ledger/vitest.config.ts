import { defineConfig, mergeConfig } from 'vitest/config';
import { coreCoverageThresholds, shared } from '../../vitest.shared.ts';

// defineConfig (not defineProject): coverage thresholds apply to per-package runs.
export default mergeConfig(
  shared,
  defineConfig({
    test: { name: 'ledger', coverage: { thresholds: coreCoverageThresholds } },
  }),
);
