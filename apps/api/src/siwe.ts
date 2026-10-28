import { createPublicClient, http, isHex, verifyMessage, type Address, type Hex } from 'viem';
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import type { Redis } from '@euroedge/service-kit';

/** Nonces live 5 minutes and work once (M6-01). */
export const NONCE_TTL_SEC = 300;
/** A message older than this, or this far in the future, is refused. */
const MAX_AGE_MS = NONCE_TTL_SEC * 1000;
const MAX_SKEW_MS = 60_000;

export interface SiweConfig {
  /** Expected `domain` (host[:port]) of the single origin (ADR-0012). */
  readonly domain: string;
  /** Expected origin of the message `uri`. */
  readonly origin: string;
  readonly chainId: number;
  /** With an RPC, ERC-1271/6492 smart wallets verify too (ADR-0014); without, EOA only. */
  readonly rpcUrl?: string | undefined;
}

export interface NonceStore {
  issue(nonce: string): Promise<void>;
  /** True exactly once per issued, unexpired nonce. */
  consume(nonce: string): Promise<boolean>;
}

export function valkeyNonces(valkey: Redis): NonceStore {
  const key = (n: string) => `siwe:nonce:${n}`;
  return {
    issue: async (n) => {
      await valkey.set(key(n), '1', 'EX', NONCE_TTL_SEC);
    },
    consume: async (n) => (await valkey.getdel(key(n))) === '1',
  };
}

export async function issueNonce(store: NonceStore): Promise<string> {
  const nonce = generateSiweNonce();
  await store.issue(nonce);
  return nonce;
}

export type SiweResult =
  | { readonly ok: true; readonly address: Address }
  | { readonly ok: false; readonly reason: string };

type Verify = (a: { address: Address; message: string; signature: Hex }) => Promise<boolean>;

export function signatureVerifier(cfg: SiweConfig): Verify {
  if (cfg.rpcUrl === undefined || cfg.rpcUrl === '') return verifyMessage;
  const client = createPublicClient({ transport: http(cfg.rpcUrl) });
  return (a) => client.verifyMessage(a);
}

/** Checks an EIP-4361 message against our origin, chain and a single-use nonce, then its signature. */
export async function verifySiwe(
  cfg: SiweConfig,
  store: NonceStore,
  verify: Verify,
  message: string,
  signature: string,
  now: Date,
): Promise<SiweResult> {
  const fail = (reason: string): SiweResult => ({ ok: false, reason });
  if (!isHex(signature)) return fail('signature must be hex');
  const m = parseSiweMessage(message);
  const { address, nonce, uri, issuedAt, chainId } = m;
  if (address === undefined || nonce === undefined || uri === undefined || issuedAt === undefined)
    return fail('incomplete message');
  if (m.domain !== cfg.domain) return fail('wrong domain');
  if (URL.parse(uri)?.origin !== cfg.origin) return fail('wrong uri');
  if (chainId !== cfg.chainId) return fail('wrong chain');
  const age = now.getTime() - issuedAt.getTime();
  if (age > MAX_AGE_MS || age < -MAX_SKEW_MS) return fail('message expired');
  if (!validateSiweMessage({ message: m, domain: cfg.domain, time: now }))
    return fail('message expired');
  // Burn the nonce before checking the signature: one attempt per nonce.
  if (!(await store.consume(nonce))) return fail('unknown or used nonce');
  const valid = await verify({ address, message, signature }).catch(() => false);
  return valid ? { ok: true, address } : fail('bad signature');
}
