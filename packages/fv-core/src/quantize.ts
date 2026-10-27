/** Boundary of fv-core: float prices → integer ticks for the engine (brief §6). */

/** Price in EUR → nearest tick (ties to even). */
export function toTicks(price: number, tickSize: number): bigint {
  if (!(price > 0) || !Number.isFinite(price)) throw new RangeError(`invalid price ${price}`);
  const x = price / tickSize;
  const fl = Math.floor(x);
  const diff = x - fl;
  // Tolerate float noise around exact .5 so 700.005 / 0.01 behaves like the decimal.
  const eps = 1e-9;
  let n: number;
  if (diff > 0.5 + eps) n = fl + 1;
  else if (diff < 0.5 - eps) n = fl;
  else n = fl % 2 === 0 ? fl : fl + 1;
  return BigInt(n);
}

/** Band edges round outward so the quantized band always contains the float band. */
export const toTicksFloor = (price: number, tickSize: number): bigint =>
  BigInt(Math.floor(price / tickSize + 1e-9));
export const toTicksCeil = (price: number, tickSize: number): bigint =>
  BigInt(Math.ceil(price / tickSize - 1e-9));
