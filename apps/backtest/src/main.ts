#!/usr/bin/env node
// Backtest CLI. Imports fv-core and risk-core directly — no duplicated maths (brief §6.6).
import { parseCliArgs, USAGE } from './cli.ts';

const args = parseCliArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
} else {
  console.error('backtest runs arrive with fv-core in M3; see --help');
  process.exitCode = 2;
}
