// Live smoke test (M5-14): the whole money path against the running stack and Base Sepolia,
// with a fresh throwaway test wallet: SIWE sign-in → gasless claim → gasless deposit → credit
// (safe head) → trade → withdraw → paid out. The relayer pays the gas.
// Run: pnpm chain:smoke   (stack running, .env switched to the chain)
import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

const ORIGIN = process.env['PUBLIC_ORIGIN'] ?? 'http://localhost:8080';
const rpc = process.env['BASE_SEPOLIA_RPC_URL'] ?? 'https://sepolia.base.org';
const pub = createPublicClient({ transport: http(rpc) });
const user = privateKeyToAccount(generatePrivateKey());
const USDC = 1_000_000n;
let cookie = '';
const t0 = Date.now();
const log = (step: string, detail = '') =>
  console.log(
    `[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${step}${detail === '' ? '' : `: ${detail}`}`,
  );

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ORIGIN}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      ...(cookie === '' ? {} : { cookie }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const set = res.headers.get('set-cookie');
  if (set !== null) cookie = set.split(';')[0] ?? '';
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${json.error?.message ?? res.statusText}`);
  return json;
}

const until = async <T>(
  what: string,
  fn: () => Promise<T | undefined>,
  timeoutMs: number,
  everyMs = 5_000,
): Promise<T> => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
};

const TOKEN = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function nonces(address) view returns (uint256)',
]);

async function main() {
  log('test wallet', user.address);
  // 1. SIWE sign-in.
  const n = await call<{ nonce: string; domain: string; chainId: number }>('/api/auth/nonce');
  const message = createSiweMessage({
    domain: n.domain,
    address: user.address,
    uri: ORIGIN,
    version: '1',
    chainId: n.chainId,
    nonce: n.nonce,
    issuedAt: new Date(),
  });
  const { account } = await call<{ account: string }>('/api/auth/siwe', {
    message,
    signature: await user.signMessage({ message }),
  });
  log('signed in', account);
  const chain = await call<{ enabled: boolean; chainId: number; token: Address; vault: Address }>(
    '/api/chain',
  );
  if (!chain.enabled) throw new Error('chain not enabled in the API');
  const domain = {
    name: 'Test USDC',
    version: '1',
    chainId: chain.chainId,
    verifyingContract: chain.token,
  } as const;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1_800);
  const balance = () =>
    pub.readContract({
      address: chain.token,
      abi: TOKEN,
      functionName: 'balanceOf',
      args: [user.address],
    });
  const nonce = () =>
    pub.readContract({
      address: chain.token,
      abi: TOKEN,
      functionName: 'nonces',
      args: [user.address],
    });
  const relayed = async (kind: string, body: Record<string, string>) => {
    const { txHash } = await call<{ txHash: Hex }>(`/relay/${kind}`, body);
    const r = await pub.waitForTransactionReceipt({ hash: txHash });
    if (r.status !== 'success') throw new Error(`${kind} tx reverted: ${txHash}`);
    return txHash;
  };

  // 2. Gasless claim.
  const claimSig = await user.signTypedData({
    domain,
    types: {
      Claim: [
        { name: 'user', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Claim',
    message: { user: user.address, amount: 10_000n * USDC, nonce: await nonce(), deadline },
  });
  log(
    'claim sent',
    await relayed('claim', {
      user: user.address,
      amount: String(10_000n * USDC),
      deadline: String(deadline),
      signature: claimSig,
    }),
  );
  await until(
    'claimed balance',
    async () => ((await balance()) >= 10_000n * USDC ? true : undefined),
    60_000,
    2_000,
  );
  log('wallet holds', `${(await balance()) / USDC} tUSDC`);

  // 3. Gasless deposit.
  const permitSig = await user.signTypedData({
    domain,
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
      spender: chain.vault,
      value: 5_000n * USDC,
      nonce: await nonce(),
      deadline,
    },
  });
  log(
    'deposit sent',
    await relayed('deposit', {
      user: user.address,
      amount: String(5_000n * USDC),
      deadline: String(deadline),
      signature: permitSig,
    }),
  );

  // 4. Credited once the block is safe (indexer).
  const cash = async () => Number((await call<{ cash: string }>('/api/account')).cash);
  await until(
    'deposit credited',
    async () => ((await cash()) >= 5_000 ? true : undefined),
    20 * 60_000,
    10_000,
  );
  log('deposit credited', `${await cash()} USDC trading balance`);

  // 5. Trade and close.
  const fill = await call<{ status: string; fill?: { price: string } }>('/api/orders', {
    market: 'ASML-PERP',
    side: 'buy',
    size: '1',
    idempotencyKey: crypto.randomUUID(),
  });
  log('bought 1 ASML', `${fill.status} @ ${fill.fill?.price ?? '-'}`);
  const close = await call<{ status: string }>('/api/positions/ASML-PERP/close', {
    idempotencyKey: crypto.randomUUID(),
  });
  log('closed', close.status);

  // 6. Withdraw 1 000: engine reserves, signer authorises, relayer submits, indexer settles.
  const before = await balance();
  const { withdrawalId } = await call<{ withdrawalId: string }>('/api/withdrawals', {
    amount: String(1_000n * USDC),
    idempotencyKey: crypto.randomUUID(),
  });
  type W = {
    id: string;
    amount: string;
    nonce: string;
    status: string;
    authorisation: { deadlineSec: string; signature: string } | null;
  };
  const w = await until(
    'authorisation',
    async () => {
      const x = (await call<{ withdrawals: W[] }>('/api/withdrawals')).withdrawals.find(
        (y) => y.id === withdrawalId,
      );
      return x?.authorisation === null || x === undefined ? undefined : x;
    },
    60_000,
    1_000,
  );
  log('authorised by the engine signer');
  log(
    'withdraw sent',
    await relayed('withdraw', {
      user: user.address,
      amount: w.amount,
      nonce: w.nonce,
      deadline: w.authorisation?.deadlineSec ?? '',
      signature: w.authorisation?.signature ?? '',
    }),
  );
  log(
    'wallet holds',
    `${(await balance()) / USDC} tUSDC (+${((await balance()) - before) / USDC})`,
  );
  await until(
    'withdrawal settled',
    async () => {
      const x = (await call<{ withdrawals: W[] }>('/api/withdrawals')).withdrawals.find(
        (y) => y.id === withdrawalId,
      );
      return x?.status === 'executed' ? true : undefined;
    },
    20 * 60_000,
    10_000,
  );
  log('withdrawal paid out and settled', `trading balance ${await cash()} USDC`);
  log('ALL STEPS PASSED');
}

main().catch((err: unknown) => {
  log('FAILED', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
