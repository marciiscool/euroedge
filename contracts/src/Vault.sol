// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev The bytes-signature permit of TestUSDC (EOA + ERC-1271, ADR-0014).
interface IBytesPermit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        bytes calldata signature
    ) external;
}

/// @title EuroEdge Vault (M5-03/04, ADR-0013/0014). Review gate: math.
/// @notice Holds all collateral. Deposits credit the depositor (the indexer turns `Deposited`
/// into an engine input). Withdrawals need an EIP-712 authorisation from the engine signer,
/// which reserved the amount first (M4-18): each nonce works once, before its deadline, within
/// a global daily limit. A multisig can pause.
contract Vault is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 private constant WITHDRAWAL_TYPEHASH =
        keccak256("Withdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline)");

    IERC20 public immutable token;
    address public engineSigner;
    /// @notice Max total withdrawn per UTC day (PROPOSED 1 000 000 tUSDC): caps a key compromise.
    uint256 public dailyLimit;
    uint256 public currentDay;
    uint256 public withdrawnToday;
    bool public genesisRecorded;
    /// @dev Unordered nonces: bit (nonce & 255) of word (nonce >> 8).
    mapping(uint256 word => uint256 bits) private nonceBitmap;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 indexed nonce);
    event GenesisFunded(uint256 houseAmount, uint256 insuranceAmount);
    event EngineSignerChanged(address indexed signer);
    event DailyLimitChanged(uint256 limit);

    error ExpiredAuthorisation(uint256 deadline);
    error NonceUsed(uint256 nonce);
    error InvalidAuthorisation();
    error DailyLimitExceeded(uint256 requested, uint256 remaining);
    error InsufficientAllowance();
    error GenesisAlreadyRecorded();
    error GenesisNotFunded();
    error ZeroAddress();
    error ZeroAmount();

    constructor(IERC20 token_, address admin, address signer, uint256 dailyLimit_)
        EIP712("EuroEdge Vault", "1")
    {
        if (address(token_) == address(0) || admin == address(0) || signer == address(0)) {
            revert ZeroAddress();
        }
        token = token_;
        engineSigner = signer;
        dailyLimit = dailyLimit_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        emit EngineSignerChanged(signer);
        emit DailyLimitChanged(dailyLimit_);
    }

    // ── Admin ──────────────────────────────────────────────────────────────────────────────

    /// @notice Records the genesis split once the token minted it here (ADR-0013).
    function recordGenesis(uint256 houseAmount, uint256 insuranceAmount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (genesisRecorded) revert GenesisAlreadyRecorded();
        if (token.balanceOf(address(this)) < houseAmount + insuranceAmount) {
            revert GenesisNotFunded();
        }
        genesisRecorded = true;
        emit GenesisFunded(houseAmount, insuranceAmount);
    }

    /// @notice Key rotation (KMS-ready signer, M5-08). Outstanding authorisations of the old key die.
    function setEngineSigner(address signer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (signer == address(0)) revert ZeroAddress();
        engineSigner = signer;
        emit EngineSignerChanged(signer);
    }

    function setDailyLimit(uint256 limit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dailyLimit = limit;
        emit DailyLimitChanged(limit);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ── Deposits ───────────────────────────────────────────────────────────────────────────

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        _deposit(msg.sender, amount);
    }

    /// @notice Gasless deposit: the relayer submits the user's permit (EOA or ERC-1271).
    /// @dev If the permit was already used (front-run), an existing allowance still works.
    function depositWithPermit(
        address user,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        try IBytesPermit(address(token)).permit(user, address(this), amount, deadline, signature) {}
        catch {
            if (token.allowance(user, address(this)) < amount) revert InsufficientAllowance();
        }
        _deposit(user, amount);
    }

    function _deposit(address user, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        // `user` authorised this pull (permit or allowance) and is the one credited, so a third
        // party submitting it can at most deposit the user's own allowance for them.
        // forge-lint: disable-next-line(arbitrary-send-erc20)
        token.safeTransferFrom(user, address(this), amount);
        // forge-lint: disable-next-line(reentrancy-events)
        emit Deposited(user, amount);
    }

    // ── Withdrawals ────────────────────────────────────────────────────────────────────────

    /// @notice Pays `amount` to `user` against the engine signer's EIP-712 authorisation.
    /// Anyone may submit it (user or relayer); the funds always go to `user`.
    function withdraw(
        address user,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert ExpiredAuthorisation(deadline);
        if (nonceUsed(nonce)) revert NonceUsed(nonce);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(WITHDRAWAL_TYPEHASH, user, amount, nonce, deadline))
        );
        if (!SignatureChecker.isValidSignatureNow(engineSigner, digest, signature)) {
            revert InvalidAuthorisation();
        }
        uint256 day = block.timestamp / 1 days;
        if (day != currentDay) {
            currentDay = day;
            withdrawnToday = 0;
        }
        uint256 remaining = dailyLimit > withdrawnToday ? dailyLimit - withdrawnToday : 0;
        if (amount > remaining) revert DailyLimitExceeded(amount, remaining);
        withdrawnToday += amount;
        nonceBitmap[nonce >> 8] |= 1 << (nonce & 255);
        token.safeTransfer(user, amount);
        // forge-lint: disable-next-line(reentrancy-events)
        emit Withdrawn(user, amount, nonce);
    }

    /// @notice Whether a withdrawal nonce was executed (the indexer's expiry check, M5-10).
    function nonceUsed(uint256 nonce) public view returns (bool) {
        return nonceBitmap[nonce >> 8] & (1 << (nonce & 255)) != 0;
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
