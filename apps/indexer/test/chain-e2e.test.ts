import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { balanceTree } from '@euroedge/shared';
import { apply } from '../../engine/src/core/apply.ts';
import type { EngineInput } from '../../engine/src/core/events.ts';
import type { EngineOutput } from '../../engine/src/core/outputs.ts';
import { createState } from '../../engine/src/core/state.ts';
import { balanceSnapshot } from '../../engine/src/balances.ts';
import { EVENT_VERSIONS } from '../../engine/src/log/codec.ts';
import { data, listASML } from '../../engine/test/fixtures.ts';
import { viemRelayChain } from '../../relayer/src/chain.ts';
import { relay, DEFAULT_LIMITS } from '../../relayer/src/relay.ts';
import { leavesOf, postRoot, viemRootChain } from '../../signer/src/poster.ts';
import { signReservation } from '../../signer/src/service.ts';
import { localSigner } from '../../signer/src/signer.ts';
import { viemReader } from '../src/chain.ts';
import { checkExpiries } from '../src/expiry.ts';
import { VaultIndexer } from '../src/indexer.ts';

/**
 * Local end-to-end (M5-13): claim → deposit → trade → withdraw → root, plus an expiry, against
 * the real contracts on anvil, with the engine core, relayer, indexer, signer and poster code
 * in-process. Opt-in: ANVIL_E2E=1 and FOUNDRY_BIN (CI's Node job has no Foundry).
 */
const FOUNDRY = process.env['FOUNDRY_BIN'] ?? '';
const RUN = process.env['ANVIL_E2E'] === '1' && FOUNDRY !== '';
const PORT = 18_645;
const RPC = `http://127.0.0.1:${PORT}`;
// anvil's well-known test keys (public; local chain only).
const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  signer: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  relayer: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  user: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
} as const;
const CONTRACTS = new URL('../../../contracts/', import.meta.url).pathname;
const USDC = 1_000_000n;

describe.skipIf(!RUN)('chain end to end on anvil (M5-13)', () => {
  let anvil: ChildProcess;
  let dep: { testUsdc: Address; vault: Address; balanceRoot: Address };
  const pub = createPublicClient({ transport: http(RPC) });
  const user = privateKeyToAccount(KEYS.user);
  const account = user.address.toLowerCase();

  // Engine core with wall-clock event time plus a controllable offset (for the expiry).
  const state = createState();
  let offset = 0n;
  const engine = (input: EngineInput | Record<string, unknown>): EngineOutput[] => {
    const i = input as EngineInput;
    return apply(state, {
      seq: state.seq + 1n,
      ts: BigInt(Date.now()) + offset,
      v: EVENT_VERSIONS[i.type],
      input: i,
    });
  };
  // The indexer's sink decodes like the engine stream would (bigints arrive as bigints here).
  const indexer = () =>
    new VaultIndexer({
      reader: viemReader(RPC, dep.vault),
      cursor: {
        get: () => Promise.resolve(cursor),
        set: (b) => Promise.resolve(void (cursor = b)),
      },
      sink: (input) => Promise.resolve(void engine(input)),
      startBlock: 0n,
    });
  let cursor: bigint | undefined;
  const mineSafe = () => pub.request({ method: 'anvil_mine' as never, params: ['0x40'] as never });

  beforeAll(async () => {
    anvil = spawn(`${FOUNDRY}/anvil`, ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1_500));
    execFileSync(
      `${FOUNDRY}/forge`,
      ['script', 'script/Deploy.s.sol', '--rpc-url', RPC, '--broadcast'],
      {
        cwd: CONTRACTS,
        env: {
          ...process.env,
          DEPLOYER_PRIVATE_KEY: KEYS.deployer,
          ENGINE_SIGNER_ADDRESS: privateKeyToAccount(KEYS.signer).address,
        },
        stdio: 'ignore',
      },
    );
    const file = `${CONTRACTS}deployments/31337.json`;
    dep = JSON.parse(readFileSync(file, 'utf8')) as typeof dep;
    rmSync(file);
    engine(listASML);
  }, 120_000);

  afterAll(() => {
    anvil.kill();
  });

  const tokenBalance = (a: Address) =>
    pub.readContract({
      address: dep.testUsdc,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [a],
    });

  it('claim → deposit (gasless) → trade → withdraw → root → expiry', async () => {
    const chainId = await pub.getChainId();
    const { chain } = viemRelayChain({
      rpcUrl: RPC,
      privateKey: KEYS.relayer,
      token: dep.testUsdc,
      vault: dep.vault,
    });
    const limiter = { hit: () => Promise.resolve(true) };
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3_600);
    const tokenDomain = {
      name: 'Test USDC',
      version: '1',
      chainId,
      verifyingContract: dep.testUsdc,
    } as const;

    // 1. Gasless claim and deposit through the relayer.
    const claimSig = await user.signTypedData({
      domain: tokenDomain,
      types: {
        Claim: [
          { name: 'user', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Claim',
      message: { user: user.address, amount: 10_000n * USDC, nonce: 0n, deadline },
    });
    const c = await relay(
      chain,
      limiter,
      DEFAULT_LIMITS,
      'claim',
      { user: user.address, amount: 10_000n * USDC, deadline, signature: claimSig },
      'ip',
    );
    if (c.status !== 'sent') throw new Error(`claim ${JSON.stringify(c)}`);
    await pub.waitForTransactionReceipt({ hash: c.txHash });
    const permitSig = await user.signTypedData({
      domain: tokenDomain,
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
      message: {
        owner: user.address,
        spender: dep.vault,
        value: 8_000n * USDC,
        nonce: 1n,
        deadline,
      },
    });
    const d = await relay(
      chain,
      limiter,
      DEFAULT_LIMITS,
      'deposit',
      { user: user.address, amount: 8_000n * USDC, deadline, signature: permitSig },
      'ip',
    );
    if (d.status !== 'sent') throw new Error(`deposit ${JSON.stringify(d)}`);
    await pub.waitForTransactionReceipt({ hash: d.txHash });
    expect(await tokenBalance(user.address)).toBe(2_000n * USDC);
    expect(await pub.getBalance({ address: user.address })).toBe(10_000n * 10n ** 18n); // no gas spent

    // 2. The indexer brings genesis and the deposit into the engine once they are safe.
    await mineSafe();
    expect(await indexer().step()).toBe(2);
    expect(state.genesis).toBe(true);
    const cash = () => state.ledger.balance(`user:${account}`) as bigint;
    expect(cash()).toBe(8_000n * USDC);

    // 3. Trade: buy and sell back 10 shares (fees and spread are the cost).
    engine(data(70_000n));
    const order = (side: 'buy' | 'sell', key: string) =>
      engine({
        type: 'PlaceOrder',
        requestId: key,
        idempotencyKey: key,
        account,
        market: 'ASML-PERP',
        side,
        qty: 1_000n,
        reduceOnly: side === 'sell',
      });
    expect(order('buy', 'o1').some((o) => o.type === 'OrderFilled')).toBe(true);
    expect(order('sell', 'o2').some((o) => o.type === 'OrderFilled')).toBe(true);
    const afterTrade = cash();
    expect(afterTrade).toBeLessThan(8_000n * USDC);

    // 4. Withdraw 5 000: engine reserves, signer authorises, the Vault pays, the indexer settles.
    const signer = localSigner(KEYS.signer, chainId, dep.vault);
    const auths = new Map<string, { signature: string; deadlineSec: string }>();
    const reserve = (key: string, amount: bigint) => {
      const out = engine({ type: 'RequestWithdrawal', requestId: key, account, amount });
      const r = out.find((o) => o.type === 'WithdrawalReserved');
      if (r?.type !== 'WithdrawalReserved')
        throw new Error(
          `no reservation: ${JSON.stringify(out, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))}`,
        );
      return r;
    };
    const sign = async (id: string) => {
      const w = state.withdrawals.get(id);
      if (w === undefined) throw new Error('unknown withdrawal');
      await signReservation(
        {
          record: () =>
            Promise.resolve({
              id,
              account: w.account,
              amount: String(w.amount),
              nonce: String(w.nonce),
              deadlineMs: String(w.deadline),
              status: w.status,
            }),
          hasAuth: (x) => Promise.resolve(auths.has(x)),
          saveAuth: (a) => Promise.resolve(void auths.set(a.id, a)),
        },
        signer,
        { chainId, vault: dep.vault },
        id,
      );
      return auths.get(id);
    };
    const w1 = reserve('w1', 5_000n * USDC);
    const a1 = await sign(w1.withdrawalId);
    const wallet = createWalletClient({ account: user, chain: foundry, transport: http(RPC) });
    const vaultAbi = parseAbi([
      'function withdraw(address user, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)',
      'function nonceUsed(uint256) view returns (bool)',
    ]);
    const tx = await wallet.writeContract({
      address: dep.vault,
      abi: vaultAbi,
      functionName: 'withdraw',
      args: [
        user.address,
        5_000n * USDC,
        w1.nonce,
        BigInt(a1?.deadlineSec ?? '0'),
        a1?.signature as Hex,
      ],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
    expect(await tokenBalance(user.address)).toBe(7_000n * USDC);
    await mineSafe();
    expect(await indexer().step()).toBe(1);
    expect(state.withdrawals.get(w1.withdrawalId)?.status).toBe('executed');
    expect(cash()).toBe(afterTrade - 5_000n * USDC);

    // 5. Balance root: the poster posts it, the proof verifies on-chain.
    const hour = BigInt(Date.now()) / 3_600_000n;
    const snap = balanceSnapshot(state, hour);
    const posted = new Map<string, { root: string }>();
    expect(
      await postRoot(
        {
          snapshot: () => Promise.resolve(snap),
          posted: (h) => Promise.resolve(posted.has(h)),
          savePosted: (p) => Promise.resolve(void posted.set(p.hour, p)),
        },
        viemRootChain(RPC, KEYS.signer, dep.balanceRoot),
        snap.hour,
      ),
    ).toBe('posted');
    const leaves = leavesOf(snap);
    const mine = leaves.find(([a]) => a === account);
    if (mine === undefined) throw new Error('no leaf');
    const proof = balanceTree(leaves).proof(mine) ?? [];
    const verified = await pub.readContract({
      address: dep.balanceRoot,
      abi: parseAbi([
        'function verify(uint64 hour, address account, uint256 balance, bytes32[] proof) view returns (bool)',
      ]),
      functionName: 'verify',
      args: [hour, user.address, mine[1], proof],
    });
    expect(verified).toBe(true);

    // 6. Expiry: a reserved withdrawal nobody submits is re-credited once its deadline is safe.
    const before = cash();
    const w2 = reserve('w2', 100n * USDC);
    await sign(w2.withdrawalId);
    expect(cash()).toBe(before - 100n * USDC);
    await pub.request({ method: 'evm_increaseTime' as never, params: [7_200] as never });
    offset += 7_200_000n;
    await mineSafe();
    const pending = [...state.withdrawals.values()]
      .filter((w) => w.status === 'pending')
      .map((w) => ({
        id: w.id,
        account: w.account,
        amount: String(w.amount),
        nonce: String(w.nonce),
        deadlineMs: String(w.deadline),
        status: w.status,
      }));
    expect(
      await checkExpiries(pending, viemReader(RPC, dep.vault), (i) =>
        Promise.resolve(void engine(i)),
      ),
    ).toBe(1);
    expect(state.withdrawals.get(w2.withdrawalId)?.status).toBe('expired');
    expect(cash()).toBe(before);
    expect(
      await pub.readContract({
        address: dep.vault,
        abi: vaultAbi,
        functionName: 'nonceUsed',
        args: [w2.nonce],
      }),
    ).toBe(false);
  }, 120_000);
});
