// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestUSDC} from "../../src/TestUSDC.sol";
import {Vault} from "../../src/Vault.sol";

/// @dev Drives the Vault like the engine would: a withdrawal is only ever signed for what the
/// model ledger says is withdrawable, with a fresh nonce. Replays and expired authorisations
/// are attempted too; a success would be recorded in a ghost flag.
contract VaultHandler is Test {
    TestUSDC internal immutable token;
    Vault internal immutable vault;
    uint256 internal immutable signerPk;
    bytes32 internal constant WITHDRAWAL_TYPEHASH =
        keccak256("Withdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline)");

    address[3] public users;
    mapping(address => uint256) public withdrawable;
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public nextNonce;
    uint256[] internal usedNonces;
    bool public replaySucceeded;
    bool public expiredSucceeded;

    constructor(TestUSDC token_, Vault vault_, uint256 signerPk_) {
        token = token_;
        vault = vault_;
        signerPk = signerPk_;
        users = [makeAddr("u0"), makeAddr("u1"), makeAddr("u2")];
    }

    function sumWithdrawable() external view returns (uint256 s) {
        for (uint256 i = 0; i < 3; i++) {
            s += withdrawable[users[i]];
        }
    }

    function _auth(address user, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                vault.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(WITHDRAWAL_TYPEHASH, user, amount, nonce, deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function deposit(uint256 who, uint256 amount) external {
        address u = users[who % 3];
        amount = bound(amount, 1, token.claimable(u));
        if (token.claimable(u) == 0) return;
        vm.startPrank(u);
        token.claim(amount);
        token.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
        withdrawable[u] += amount;
        totalDeposited += amount;
    }

    function withdraw(uint256 who, uint256 amount) external {
        address u = users[who % 3];
        if (withdrawable[u] == 0) return;
        amount = bound(amount, 1, withdrawable[u]);
        uint256 room = vault.dailyLimit()
            - (vault.currentDay() == vm.getBlockTimestamp() / 1 days ? vault.withdrawnToday() : 0);
        if (amount > room) return;
        uint256 nonce = nextNonce++;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        vault.withdraw(u, amount, nonce, deadline, _auth(u, amount, nonce, deadline));
        withdrawable[u] -= amount;
        totalWithdrawn += amount;
        usedNonces.push(nonce);
    }

    function replay(uint256 i) external {
        if (usedNonces.length == 0) return;
        uint256 nonce = usedNonces[i % usedNonces.length];
        address u = users[0];
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        try vault.withdraw(u, 1, nonce, deadline, _auth(u, 1, nonce, deadline)) {
            replaySucceeded = true;
        } catch {}
    }

    function expired(uint256 who) external {
        address u = users[who % 3];
        uint256 nonce = nextNonce++;
        uint256 deadline = vm.getBlockTimestamp();
        bytes memory auth = _auth(u, 1, nonce, deadline);
        vm.warp(vm.getBlockTimestamp() + 1);
        try vault.withdraw(u, 1, nonce, deadline, auth) {
            expiredSucceeded = true;
        } catch {}
    }

    function nextDay() external {
        vm.warp(vm.getBlockTimestamp() + 1 days);
    }
}

contract VaultInvariantTest is Test {
    TestUSDC internal token;
    Vault internal vault;
    VaultHandler internal handler;
    uint256 internal constant GENESIS = 55_000_000e6;

    function setUp() public {
        vm.warp(1_800_000_000);
        address admin = makeAddr("admin");
        uint256 signerPk = 0x5167E2;
        token = new TestUSDC(admin);
        vault = new Vault(IERC20(address(token)), admin, vm.addr(signerPk), 50_000e6);
        vm.startPrank(admin);
        token.setVault(address(vault));
        token.mintGenesis(GENESIS);
        vault.recordGenesis(50_000_000e6, 5_000_000e6);
        vm.stopPrank();
        handler = new VaultHandler(token, vault, signerPk);
        targetContract(address(handler));
    }

    /// Vault holdings = genesis + deposits − withdrawals, so ≥ genesis + Σ withdrawable.
    function invariant_vaultCoversWithdrawable() public view {
        uint256 held = token.balanceOf(address(vault));
        assertEq(held, GENESIS + handler.totalDeposited() - handler.totalWithdrawn());
        assertGe(held, GENESIS + handler.sumWithdrawable());
    }

    function invariant_noNonceWorksTwice() public view {
        assertFalse(handler.replaySucceeded());
        assertFalse(handler.expiredSucceeded());
    }

    /// The run must actually move money, or the invariants above prove nothing.
    function afterInvariant() public view {
        assertGt(handler.totalDeposited(), 0);
        assertGt(handler.totalWithdrawn(), 0);
    }

    function invariant_dailyLimitHolds() public view {
        assertLe(vault.withdrawnToday(), vault.dailyLimit());
    }
}
