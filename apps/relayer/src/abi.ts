import { parseAbi } from 'viem';

/** Custom errors, so a failed simulation reports e.g. "InvalidSignature" instead of a selector. */
const ERRORS = [
  'error InvalidSignature()',
  'error ExpiredSignature(uint256 deadline)',
  'error ClaimCapExceeded(uint256 requested, uint256 available)',
  'error TransferRestricted(address from, address to)',
  'error ZeroAmount()',
  'error InsufficientAllowance()',
  'error EnforcedPause()',
  'error ExpiredAuthorisation(uint256 deadline)',
  'error NonceUsed(uint256 nonce)',
  'error InvalidAuthorisation()',
  'error DailyLimitExceeded(uint256 requested, uint256 remaining)',
] as const;

export const TOKEN_ABI = parseAbi([
  'function claimFor(address user, uint256 amount, uint256 deadline, bytes signature)',
  ...ERRORS,
]);
export const VAULT_ABI = parseAbi([
  'function depositWithPermit(address user, uint256 amount, uint256 deadline, bytes signature)',
  'function withdraw(address user, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)',
  ...ERRORS,
]);
