import { describe, expect, it } from 'vitest';
import { verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { issueNonce, verifySiwe, type NonceStore, type SiweConfig } from './siwe.ts';

const cfg: SiweConfig = {
  domain: 'localhost:8080',
  origin: 'http://localhost:8080',
  chainId: 84532,
};
const alice = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const now = new Date('2026-10-28T12:00:00Z');

function memoryNonces(): NonceStore {
  const live = new Set<string>();
  return {
    issue: (n) => Promise.resolve(void live.add(n)),
    consume: (n) => Promise.resolve(live.delete(n)),
  };
}

async function signed(
  store: NonceStore,
  over: Partial<Parameters<typeof createSiweMessage>[0]> = {},
) {
  const message = createSiweMessage({
    domain: cfg.domain,
    address: alice.address,
    uri: cfg.origin,
    version: '1',
    chainId: cfg.chainId,
    nonce: await issueNonce(store),
    issuedAt: now,
    ...over,
  });
  return { message, signature: await alice.signMessage({ message }) };
}

const run = (store: NonceStore, s: { message: string; signature: string }, at = now) =>
  verifySiwe(cfg, store, verifyMessage, s.message, s.signature, at);

describe('SIWE (M6-01, ADR-0020)', () => {
  it('accepts a signed message once and returns the address', async () => {
    const store = memoryNonces();
    const s = await signed(store);
    expect(await run(store, s)).toEqual({ ok: true, address: alice.address });
    expect(await run(store, s)).toEqual({ ok: false, reason: 'unknown or used nonce' });
  });

  it('refuses a nonce the server never issued', async () => {
    const store = memoryNonces();
    const s = await signed(store, { nonce: 'forgednonce123' });
    expect(await run(store, s)).toMatchObject({ reason: 'unknown or used nonce' });
  });

  it.each([
    ['wrong domain', { domain: 'evil.example' }],
    ['wrong uri', { uri: 'https://evil.example/login' }],
    ['wrong chain', { chainId: 1 }],
    ['message expired', { issuedAt: new Date(now.getTime() - 301_000) }],
    ['message expired', { expirationTime: new Date(now.getTime() - 1) }],
  ] as const)('refuses %s', async (reason, over) => {
    const store = memoryNonces();
    expect(await run(store, await signed(store, over))).toMatchObject({ reason });
  });

  it('refuses a signature by another key and burns the nonce', async () => {
    const store = memoryNonces();
    const s = await signed(store);
    const mallory = privateKeyToAccount(`0x${'22'.repeat(32)}`);
    const forged = { ...s, signature: await mallory.signMessage({ message: s.message }) };
    expect(await run(store, forged)).toMatchObject({ reason: 'bad signature' });
    expect(await run(store, s)).toMatchObject({ reason: 'unknown or used nonce' });
  });

  it('refuses garbage', async () => {
    const store = memoryNonces();
    expect(await run(store, { message: 'hello', signature: '0x00' })).toMatchObject({
      reason: 'incomplete message',
    });
    expect(await run(store, { message: 'hello', signature: 'nope' })).toMatchObject({
      reason: 'signature must be hex',
    });
  });
});
