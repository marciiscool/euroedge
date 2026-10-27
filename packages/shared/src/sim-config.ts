import { z } from 'zod';

const vol = z.number().min(0).max(2);
const rate = z.number().min(0).max(100);

const fxPairSchema = z
  .object({
    start: z.number().positive(),
    annualVol: vol,
    /** Fraction of the gap to the start level closed per day (peg strength); default weak. */
    meanReversionPerDay: z.number().min(0).max(1).default(0.02),
  })
  .strict();

/** Global parameters of the simulated world (config/sim.yaml). */
export const simConfigSchema = z
  .object({
    factors: z.object({ marketVol: vol, sectorVol: vol }).strict(),
    fx: z.object({ EURUSD: fxPairSchema, EURGBP: fxPairSchema, EURDKK: fxPairSchema }).strict(),
    faults: z.object({ badPrintsPerDay: rate, staleFeedsPerDay: rate, haltsPerDay: rate }).strict(),
  })
  .strict();
export type SimConfig = z.infer<typeof simConfigSchema>;
export type FxPair = keyof SimConfig['fx'];

/** Defaults used when no sim.yaml is supplied (tests): no faults. */
export const DEFAULT_SIM_CONFIG: SimConfig = {
  factors: { marketVol: 0.14, sectorVol: 0.1 },
  fx: {
    EURUSD: { start: 1.08, annualVol: 0.07, meanReversionPerDay: 0.02 },
    EURGBP: { start: 0.86, annualVol: 0.05, meanReversionPerDay: 0.02 },
    EURDKK: { start: 7.46038, annualVol: 0.003, meanReversionPerDay: 0.5 },
  },
  faults: { badPrintsPerDay: 0, staleFeedsPerDay: 0, haltsPerDay: 0 },
};
