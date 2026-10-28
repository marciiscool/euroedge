import { describe, expect, it } from 'vitest';
import { hashTypedData, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { claimTypedData, formatUsdc, parseUsdc, permitTypedData } from '../src/wallet/funds-model';

const chain = {
  chainId: 84532,
  token: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  vault: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
} as const;

describe('funds model (M5 web)', () => {
  it('parses amounts in either decimal convention', () => {
    expect(parseUsdc('1234.5')).toBe(1_234_500_000n);
    expect(parseUsdc('1.234,5')).toBe(1_234_500_000n);
    expect(parseUsdc('1 234,50')).toBe(1_234_500_000n);
    expect(parseUsdc('10')).toBe(10_000_000n);
    expect(parseUsdc('0,000001')).toBe(1n);
    for (const bad of ['', '0', 'abc', '-5', '1e3']) expect(parseUsdc(bad)).toBeUndefined();
  });

  it('formats µUSDC per locale', () => {
    expect(formatUsdc(1_234_567_890n, 'en')).toBe('1,234.56');
    expect(formatUsdc(1_234_567_890n, 'de')).toBe('1.234,56');
  });

  it('builds claim and permit payloads the wallet can sign and the contract recovers', async () => {
    const user = privateKeyToAccount(`0x${'77'.repeat(32)}`);
    const claim = claimTypedData(chain, user.address, 5_000_000n, 0n, 1_900_000_000n);
    const claimSig = await user.signTypedData(claim);
    expect(await recoverTypedDataAddress({ ...claim, signature: claimSig })).toBe(user.address);
    const permit = permitTypedData(chain, user.address, 5_000_000n, 1n, 1_900_000_000n);
    const permitSig = await user.signTypedData(permit);
    expect(await recoverTypedDataAddress({ ...permit, signature: permitSig })).toBe(user.address);
    expect(hashTypedData(claim)).not.toBe(hashTypedData(permit));
    expect(permitTypedData(chain, user.address, 1n, 0n, 1n).message.spender).toBe(chain.vault);
  });
});
