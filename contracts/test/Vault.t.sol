// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {Vault} from "../src/Vault.sol";

contract VaultTest is Test {
    TestUSDC internal token;
    Vault internal vault;
    address internal admin = makeAddr("admin");
    uint256 internal signerPk = 0x5167E2;
    address internal signer = vm.addr(signerPk);
    uint256 internal alicePk = 0xA11CE;
    address internal alice = vm.addr(alicePk);

    bytes32 internal constant WITHDRAWAL_TYPEHASH =
        keccak256("Withdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 internal constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new TestUSDC(admin);
        vault = new Vault(IERC20(address(token)), admin, signer, 1_000_000e6);
        vm.startPrank(admin);
        token.setVault(address(vault));
        token.mintGenesis(55_000_000e6);
        vault.recordGenesis(50_000_000e6, 5_000_000e6);
        vm.stopPrank();
        vm.prank(alice);
        token.claim(10_000e6);
    }

    function _sign(uint256 pk, bytes32 domain, bytes32 structHash)
        internal
        pure
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _authorise(address user, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sign(
            signerPk,
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(WITHDRAWAL_TYPEHASH, user, amount, nonce, deadline))
        );
    }

    function test_genesisRecordedOnce() public {
        assertTrue(vault.genesisRecorded());
        vm.prank(admin);
        vm.expectRevert(Vault.GenesisAlreadyRecorded.selector);
        vault.recordGenesis(1, 1);
    }

    function test_depositWithApprove() public {
        vm.startPrank(alice);
        token.approve(address(vault), 4_000e6);
        vm.expectEmit(address(vault));
        emit Vault.Deposited(alice, 4_000e6);
        vault.deposit(4_000e6);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 6_000e6);
        assertEq(token.balanceOf(address(vault)), 55_004_000e6);
    }

    function test_depositWithPermitByRelayer_andFrontRunPermit() public {
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory sig = _sign(
            alicePk,
            token.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(PERMIT_TYPEHASH, alice, address(vault), 3_000e6, 0, deadline))
        );
        // Someone front-runs the permit itself: the deposit still goes through on the allowance.
        token.permit(alice, address(vault), 3_000e6, deadline, sig);
        vm.prank(makeAddr("relayer"));
        vault.depositWithPermit(alice, 3_000e6, deadline, sig);
        assertEq(token.balanceOf(alice), 7_000e6);
        // Without a valid permit or allowance it fails.
        vm.expectRevert(Vault.InsufficientAllowance.selector);
        vault.depositWithPermit(alice, 1e6, deadline, sig);
    }

    function test_withdrawWithEngineAuthorisation() public {
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory auth = _authorise(alice, 2_500e6, 7, deadline);
        vm.prank(makeAddr("relayer")); // anyone may submit; funds go to alice
        vault.withdraw(alice, 2_500e6, 7, deadline, auth);
        assertEq(token.balanceOf(alice), 12_500e6);
        assertTrue(vault.nonceUsed(7));
        assertFalse(vault.nonceUsed(6));
        vm.expectRevert(abi.encodeWithSelector(Vault.NonceUsed.selector, 7));
        vault.withdraw(alice, 2_500e6, 7, deadline, auth);
    }

    function test_withdrawRejectsTamperingExpiryAndOtherSigners() public {
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory auth = _authorise(alice, 100e6, 1, deadline);
        vm.expectRevert(Vault.InvalidAuthorisation.selector);
        vault.withdraw(alice, 101e6, 1, deadline, auth); // amount changed
        vm.expectRevert(Vault.InvalidAuthorisation.selector);
        vault.withdraw(makeAddr("mallory"), 100e6, 1, deadline, auth); // recipient changed
        bytes memory forged = _sign(
            0xBAD,
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(WITHDRAWAL_TYPEHASH, alice, 100e6, 1, deadline))
        );
        vm.expectRevert(Vault.InvalidAuthorisation.selector);
        vault.withdraw(alice, 100e6, 1, deadline, forged);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(Vault.ExpiredAuthorisation.selector, deadline));
        vault.withdraw(alice, 100e6, 1, deadline, auth);
        assertFalse(vault.nonceUsed(1)); // the indexer sees it as expired, unused (M5-10)
    }

    function test_dailyLimitResetsEachUtcDay() public {
        vm.prank(admin);
        vault.setDailyLimit(1_000e6);
        uint256 deadline = vm.getBlockTimestamp() + 3 days;
        vault.withdraw(alice, 800e6, 1, deadline, _authorise(alice, 800e6, 1, deadline));
        bytes memory auth = _authorise(alice, 300e6, 2, deadline);
        vm.expectRevert(abi.encodeWithSelector(Vault.DailyLimitExceeded.selector, 300e6, 200e6));
        vault.withdraw(alice, 300e6, 2, deadline, auth);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vault.withdraw(alice, 300e6, 2, deadline, auth);
    }

    function test_pauseStopsDepositsAndWithdrawals() public {
        vm.prank(admin);
        vault.pause();
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory auth = _authorise(alice, 1e6, 1, deadline);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.withdraw(alice, 1e6, 1, deadline, auth);
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.deposit(1e6);
        vm.prank(alice);
        vm.expectRevert(); // not a pauser
        vault.unpause();
        vm.prank(admin);
        vault.unpause();
        vault.withdraw(alice, 1e6, 1, deadline, auth);
    }

    function test_signerRotationVoidsOldAuthorisations() public {
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory auth = _authorise(alice, 1e6, 1, deadline);
        vm.prank(admin);
        vault.setEngineSigner(makeAddr("newSigner"));
        vm.expectRevert(Vault.InvalidAuthorisation.selector);
        vault.withdraw(alice, 1e6, 1, deadline, auth);
    }

    function testFuzz_nonceBitmap(uint256 a, uint256 b) public {
        vm.assume(a != b);
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        vault.withdraw(alice, 1e6, a, deadline, _authorise(alice, 1e6, a, deadline));
        assertTrue(vault.nonceUsed(a));
        assertFalse(vault.nonceUsed(b));
    }
}
