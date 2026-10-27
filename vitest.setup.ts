import fc from 'fast-check';

// Property tests: default 200 runs locally; CI raises this via FC_NUM_RUNS.
// A failing run prints its seed; reproduce with FC_SEED=<seed>.
const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 200);
const seed = process.env['FC_SEED'];
fc.configureGlobal({ numRuns, ...(seed === undefined ? {} : { seed: Number(seed) }) });
