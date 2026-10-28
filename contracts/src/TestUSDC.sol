// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title Test USDC — play money with no value (M5-02, ADR-0013/0014)
/// @notice Non-transferable except faucet → user and user ↔ Vault, so it can never acquire a
/// market. Users claim it (capped per 24 h and per lifetime), directly or gasless via a
/// relayer (`claimFor`). Permit verifies EOAs and deployed smart wallets (ERC-1271).
contract TestUSDC is ERC20, EIP712, Nonces, AccessControl, IERC20Permit {
    /// @notice PROPOSED caps (founder review): 10 000 per rolling 24 h, 100 000 per wallet.
    uint256 public constant CLAIM_WINDOW = 24 hours;
    uint256 public constant CLAIM_CAP_PER_WINDOW = 10_000e6;
    uint256 public constant CLAIM_CAP_LIFETIME = 100_000e6;

    bytes32 private constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(address user,uint256 amount,uint256 nonce,uint256 deadline)");

    struct ClaimState {
        uint64 windowStart;
        uint192 inWindow;
        uint256 total;
    }

    address public vault;
    bool public genesisMinted;
    mapping(address user => ClaimState) public claims;

    event VaultSet(address indexed vault);
    event Claimed(address indexed user, uint256 amount);
    event GenesisMinted(address indexed vault, uint256 amount);

    error TransferRestricted(address from, address to);
    error ClaimCapExceeded(uint256 requested, uint256 available);
    error ExpiredSignature(uint256 deadline);
    error InvalidSignature();
    error VaultAlreadySet();
    error VaultNotSet();
    error GenesisAlreadyMinted();
    error ZeroAmount();

    constructor(address admin) ERC20("Test USDC (no value)", "tUSDC") EIP712("Test USDC", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ── Admin ──────────────────────────────────────────────────────────────────────────────

    /// @notice One-time wiring to the Vault (deployed after the token).
    function setVault(address vault_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vault != address(0)) revert VaultAlreadySet();
        if (vault_ == address(0)) revert VaultNotSet();
        vault = vault_;
        emit VaultSet(vault_);
    }

    /// @notice One-time genesis mint of house + insurance capital straight into the Vault (ADR-0013).
    function mintGenesis(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (genesisMinted) revert GenesisAlreadyMinted();
        if (vault == address(0)) revert VaultNotSet();
        genesisMinted = true;
        _mint(vault, amount);
        emit GenesisMinted(vault, amount);
    }

    // ── Faucet ─────────────────────────────────────────────────────────────────────────────

    function claim(uint256 amount) external {
        _claim(msg.sender, amount);
    }

    /// @notice Gasless claim: anyone (the relayer) submits the user's EIP-712 signature.
    function claimFor(address user, uint256 amount, uint256 deadline, bytes calldata signature)
        external
    {
        if (block.timestamp > deadline) revert ExpiredSignature(deadline);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_TYPEHASH, user, amount, _useNonce(user), deadline))
        );
        if (!SignatureChecker.isValidSignatureNow(user, digest, signature)) {
            revert InvalidSignature();
        }
        _claim(user, amount);
    }

    /// @notice What `user` may claim right now under both caps.
    function claimable(address user) public view returns (uint256) {
        ClaimState memory c = claims[user];
        uint256 used = block.timestamp >= c.windowStart + CLAIM_WINDOW ? 0 : c.inWindow;
        uint256 window = CLAIM_CAP_PER_WINDOW - used;
        uint256 lifetime = CLAIM_CAP_LIFETIME - c.total;
        return window < lifetime ? window : lifetime;
    }

    function _claim(address user, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        uint256 available = claimable(user);
        if (amount > available) revert ClaimCapExceeded(amount, available);
        ClaimState storage c = claims[user];
        if (block.timestamp >= c.windowStart + CLAIM_WINDOW) {
            // forge-lint: disable-next-line(unsafe-typecast)
            c.windowStart = uint64(block.timestamp); // seconds fit in 64 bits for ~5e11 years
            c.inWindow = 0;
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        c.inWindow += uint192(amount); // amount ≤ CLAIM_CAP_PER_WINDOW, far below 2^192
        c.total += amount;
        _mint(user, amount);
        // The only external call before this is the ERC-1271 check, a staticcall: no reentrancy.
        // forge-lint: disable-next-line(reentrancy-events)
        emit Claimed(user, amount);
    }

    // ── Permit (EIP-2612; bytes overload verifies ERC-1271 too, ADR-0014) ─────────────────

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        bytes32 digest = _permitDigest(owner, spender, value, deadline);
        if (ECDSA.recover(digest, v, r, s) != owner) revert InvalidSignature();
        _approve(owner, spender, value);
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        bytes calldata signature
    ) external {
        bytes32 digest = _permitDigest(owner, spender, value, deadline);
        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) {
            revert InvalidSignature();
        }
        _approve(owner, spender, value);
    }

    function _permitDigest(address owner, address spender, uint256 value, uint256 deadline)
        private
        returns (bytes32)
    {
        if (block.timestamp > deadline) revert ExpiredSignature(deadline);
        return _hashTypedDataV4(
            keccak256(
                abi.encode(PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline)
            )
        );
    }

    function nonces(address owner) public view override(IERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ── Transfer restriction ───────────────────────────────────────────────────────────────

    /// @dev Mints (claim, genesis) and moves to or from the Vault only. Burns are not allowed.
    function _update(address from, address to, uint256 value) internal override {
        bool allowed = from == address(0) || (vault != address(0) && (to == vault || from == vault));
        if (!allowed || to == address(0)) revert TransferRestricted(from, to);
        super._update(from, to, value);
    }
}
