// Toxic-flow and whale report (M4-25/26): calibration input for the ADR-0019 values.
import { informedArbitrage, whale } from '../test/adversarial.ts';

const report = {
  informedArbitrage: [
    await informedArbitrage('m1', 5_000),
    await informedArbitrage('adr-0019', 5_000),
  ],
  whale: [await whale('m1'), await whale('adr-0019')],
};
console.log(JSON.stringify(report, null, 2));
