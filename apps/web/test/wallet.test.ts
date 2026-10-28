import { describe, expect, it } from 'vitest';
import { parseSiweMessage } from 'viem/siwe';
import { shortAccount } from '../src/lib/format';
import { signInMessage } from '../src/wallet/siwe-message';

describe('wallet sign-in (ADR-0020)', () => {
  it('builds the SIWE message the API expects', () => {
    const address = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
    const now = new Date('2026-10-28T12:00:00Z');
    const m = parseSiweMessage(
      signInMessage(
        { nonce: 'abc12345def', domain: 'localhost:8080', chainId: 84532 },
        address,
        'http://localhost:8080',
        now,
      ),
    );
    expect(m).toMatchObject({
      domain: 'localhost:8080',
      address,
      uri: 'http://localhost:8080',
      chainId: 84532,
      nonce: 'abc12345def',
      version: '1',
    });
    expect(m.issuedAt?.toISOString()).toBe(now.toISOString());
  });

  it('shortens wallet accounts only', () => {
    expect(shortAccount('0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a')).toBe('0x19e7…ff2a');
    expect(shortAccount('dev-trader-a1b2c3')).toBe('dev-trader-a1b2c3');
  });
});
