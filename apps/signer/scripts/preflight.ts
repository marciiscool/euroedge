// Base Sepolia preflight (M5-14): checks .env before and after the contract deploy.
// Prints addresses and balances only, never a key. Run: pnpm chain:check
import { existsSync, readFileSync } from 'node:fs';
import {
  createPublicClient,
  formatEther,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const env = process.env;
const ok: string[] = [];
const bad: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : bad.push(fail);
const KEY = /^0x[0-9a-fA-F]{64}$/;
const addr = (name: string): Address | undefined => {
  const k = env[name] ?? '';
  return KEY.test(k) ? privateKeyToAccount(k as Hex).address : undefined;
};

const rpc = env['BASE_SEPOLIA_RPC_URL'] ?? '';
check(rpc !== '', 'BASE_SEPOLIA_RPC_URL set', 'BASE_SEPOLIA_RPC_URL missing');
const client = rpc === '' ? undefined : createPublicClient({ transport: http(rpc) });
if (client !== undefined) {
  const id = await client.getChainId().catch(() => undefined);
  check(
    id === 84532,
    'RPC is Base Sepolia (84532)',
    `RPC chain id is ${String(id)}, expected 84532`,
  );
}

const roles = {
  deployer: addr('DEPLOYER_PRIVATE_KEY'),
  engineSigner: addr('ENGINE_SIGNER_PRIVATE_KEY'),
  rootPoster: addr('ROOT_POSTER_PRIVATE_KEY'),
  relayer: addr('RELAYER_PRIVATE_KEY'),
};
for (const [role, a] of Object.entries(roles))
  check(a !== undefined, `${role} key → ${a}`, `${role} key missing or malformed`);
const distinct = new Set(Object.values(roles).filter((a) => a !== undefined));
check(
  distinct.size === 4,
  'all four keys are different',
  'keys must be four different keys (brief §12)',
);
if (client !== undefined) {
  for (const role of ['deployer', 'relayer', 'rootPoster'] as const) {
    const a = roles[role];
    if (a === undefined) continue;
    const eth = Number(formatEther(await client.getBalance({ address: a })));
    check(
      eth >= 0.01,
      `${role} holds ${eth.toFixed(4)} ETH`,
      `${role} ${a} holds ${eth.toFixed(4)} ETH: fund it with Base Sepolia ETH (≥ 0.01)`,
    );
  }
}
const safe = env['ADMIN_SAFE'] ?? '';
check(isAddress(safe), `ADMIN_SAFE ${safe}`, 'ADMIN_SAFE missing (your Safe on Base Sepolia)');
if (client !== undefined && isAddress(safe)) {
  const code = await client.getCode({ address: safe });
  check(
    code !== undefined && code !== '0x',
    'ADMIN_SAFE is a deployed contract',
    'ADMIN_SAFE has no code on Base Sepolia: is it the right network?',
  );
}
check(
  (env['ETHERSCAN_API_KEY'] ?? '') !== '',
  'ETHERSCAN_API_KEY set (Basescan verification)',
  'ETHERSCAN_API_KEY missing (Etherscan v2 key, works for Basescan)',
);
check(
  (env['NEXT_PUBLIC_PRIVY_APP_ID'] ?? '').length === 25,
  'NEXT_PUBLIC_PRIVY_APP_ID looks valid',
  'NEXT_PUBLIC_PRIVY_APP_ID missing or not 25 characters',
);

const file = new URL('../../../contracts/deployments/84532.json', import.meta.url);
if (!existsSync(file)) {
  console.log('\nStage: before deploy (contracts/deployments/84532.json not found)');
} else {
  console.log('\nStage: after deploy');
  const dep = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  const same = (name: string, key: string) =>
    check(
      (env[name] ?? '').toLowerCase() === (dep[key] ?? '').toLowerCase(),
      `${name} matches the deployment`,
      `${name} must be ${dep[key]}`,
    );
  same('TOKEN_ADDRESS', 'testUsdc');
  same('VAULT_ADDRESS', 'vault');
  same('BALANCE_ROOT_ADDRESS', 'balanceRoot');
  check(
    env['INDEXER_START_BLOCK'] === String(dep['block']),
    'INDEXER_START_BLOCK is the deploy block',
    `INDEXER_START_BLOCK must be ${dep['block']}`,
  );
  for (const flag of ['INDEXER_ENABLED', 'RELAYER_ENABLED', 'SIGNER_ENABLED'])
    check(env[flag] === 'true', `${flag}=true`, `${flag} must be true`);
  check(
    env['GENESIS_SOURCE'] === 'chain',
    'GENESIS_SOURCE=chain',
    'GENESIS_SOURCE must be chain (genesis from the Vault)',
  );
  check(env['DEV_LOGIN'] !== 'true', 'DEV_LOGIN off', 'DEV_LOGIN must be false with a live Vault');
  if (client !== undefined && isAddress(dep['vault'] ?? '')) {
    const vault = dep['vault'] as Address;
    const signer = await client.readContract({
      address: vault,
      abi: parseAbi(['function engineSigner() view returns (address)']),
      functionName: 'engineSigner',
    });
    check(
      signer === roles.engineSigner,
      'Vault trusts the engine signer key',
      `Vault signer is ${signer}, not the ENGINE_SIGNER key's address`,
    );
    const genesis = await client.readContract({
      address: vault,
      abi: parseAbi(['function genesisRecorded() view returns (bool)']),
      functionName: 'genesisRecorded',
    });
    check(genesis, 'Vault genesis recorded', 'Vault genesis not recorded');
  }
}

for (const line of ok) console.log(`  ✓ ${line}`);
for (const line of bad) console.log(`  ✗ ${line}`);
console.log(bad.length === 0 ? '\nAll checks passed.' : `\n${bad.length} to fix.`);
process.exitCode = bad.length === 0 ? 0 : 1;
