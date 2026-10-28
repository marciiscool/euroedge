import type { Address } from 'viem';

/** EIP-712 payloads for TestUSDC (contracts/src/TestUSDC.sol): gasless claim and permit (M5). */
export interface TokenChain {
  readonly chainId: number;
  readonly token: Address;
  readonly vault: Address;
}

const domain = (c: TokenChain) =>
  ({ name: 'Test USDC', version: '1', chainId: c.chainId, verifyingContract: c.token }) as const;

export function claimTypedData(
  c: TokenChain,
  user: Address,
  amount: bigint,
  nonce: bigint,
  deadline: bigint,
) {
  return {
    domain: domain(c),
    types: {
      Claim: [
        { name: 'user', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Claim',
    message: { user, amount, nonce, deadline },
  } as const;
}

export function permitTypedData(
  c: TokenChain,
  owner: Address,
  value: bigint,
  nonce: bigint,
  deadline: bigint,
) {
  return {
    domain: domain(c),
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: { owner, spender: c.vault, value, nonce, deadline },
  } as const;
}

/** Signatures the relayer submits stay valid for 30 minutes. */
export const signatureDeadline = (nowMs: number) => BigInt(Math.floor(nowMs / 1000) + 1_800);

/**
 * "1234.5", "1.234,5" or "1 234,50" → µUSDC. The last `.` or `,` is the decimal separator when
 * followed by 1–6 digits; other separators and spaces are grouping. Undefined if not a positive amount.
 */
export function parseUsdc(input: string): bigint | undefined {
  const s = input.replace(/[\s\u00a0\u202f]/g, '');
  if (!/^[\d.,]+$/.test(s)) return undefined;
  const m = /^(.*)[.,](\d{1,6})$/.exec(s);
  const whole = (m === null ? s : (m[1] ?? '')).replace(/[.,]/g, '');
  const frac = m === null ? '' : (m[2] ?? '');
  if (whole === '' && frac === '') return undefined;
  const v = BigInt(whole === '' ? '0' : whole) * 1_000_000n + BigInt(frac.padEnd(6, '0') || '0');
  return v > 0n ? v : undefined;
}

/** µUSDC → "1,234.56" (locale grouping, 2 decimals, truncated). */
export function formatUsdc(micro: bigint, locale: string): string {
  const cents = micro / 10_000n;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents) / 100);
}

export const explorerTx = (chainId: number, hash: string) =>
  chainId === 84532 ? `https://sepolia.basescan.org/tx/${hash}` : undefined;
