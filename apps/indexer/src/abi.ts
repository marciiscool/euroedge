import { parseAbi } from 'viem';

/** Vault events the indexer reads (contracts/src/Vault.sol). */
export const VAULT_EVENTS = parseAbi([
  'event Deposited(address indexed user, uint256 amount)',
  'event Withdrawn(address indexed user, uint256 amount, uint256 indexed nonce)',
  'event GenesisFunded(uint256 houseAmount, uint256 insuranceAmount)',
]);

export const VAULT_READS = parseAbi(['function nonceUsed(uint256 nonce) view returns (bool)']);
