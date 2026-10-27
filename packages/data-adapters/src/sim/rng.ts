/** xoshiro128** PRNG seeded via splitmix32: fast, deterministic, platform-independent. */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spare: number | undefined;

  constructor(seed: number) {
    let x = seed >>> 0;
    const next = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
  }

  /** Uniform integer in [0, 2^32). */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in [0, 1). */
  uniform(): number {
    return this.nextU32() / 4_294_967_296;
  }

  /** Standard normal (Box–Muller, cached pair). */
  normal(): number {
    if (this.spare !== undefined) {
      const v = this.spare;
      this.spare = undefined;
      return v;
    }
    let u = 0;
    while (u === 0) u = this.uniform();
    const v = this.uniform();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  /** Bernoulli(p). */
  chance(p: number): boolean {
    return this.uniform() < p;
  }
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
