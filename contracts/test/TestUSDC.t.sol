// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @dev Minimal ERC-1271 smart wallet: valid if its owner signed the hash.
contract MockSmartWallet is IERC1271 {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        (uint8 v, bytes32 r, bytes32 s) = (uint8(sig[64]), bytes32(sig[0:32]), bytes32(sig[32:64]));
        return ecrecover(hash, v, r, s) == owner ? IERC1271.isValidSignature.selector : bytes4(0);
    }
}

contract TestUSDCTest is Test {
    TestUSDC internal token;
    address internal admin = makeAddr("admin");
    address internal vault = makeAddr("vault");
    uint256 internal alicePk = 0xA11CE;
    address internal alice = vm.addr(alicePk);

    bytes32 internal constant CLAIM_TYPEHASH =
        keccak256("Claim(address user,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 internal constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        token = new TestUSDC(admin);
        vm.prank(admin);
        token.setVault(vault);
        vm.warp(1_800_000_000);
    }

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_claimCapsPerWindowAndLifetime() public {
        vm.startPrank(alice);
        token.claim(6_000e6);
        token.claim(4_000e6);
        vm.expectRevert(abi.encodeWithSelector(TestUSDC.ClaimCapExceeded.selector, 1, 0));
        token.claim(1);
        vm.stopPrank();
        // A new 24 h window opens; the lifetime cap still binds after 100 000.
        for (uint256 i = 0; i < 9; i++) {
            vm.warp(vm.getBlockTimestamp() + 24 hours);
            vm.prank(alice);
            token.claim(10_000e6);
        }
        assertEq(token.balanceOf(alice), 100_000e6);
        vm.warp(vm.getBlockTimestamp() + 24 hours);
        assertEq(token.claimable(alice), 0);
    }

    function test_transfersAreRestricted() public {
        vm.prank(alice);
        token.claim(100e6);
        address bob = makeAddr("bob");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestUSDC.TransferRestricted.selector, alice, bob));
        token.transfer(bob, 1);
        // To and from the Vault is allowed.
        vm.prank(alice);
        token.transfer(vault, 40e6);
        vm.prank(vault);
        token.transfer(alice, 10e6);
        assertEq(token.balanceOf(alice), 70e6);
    }

    function test_claimForWithEoaSignature() public {
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory sig = _sign(
            alicePk, _digest(keccak256(abi.encode(CLAIM_TYPEHASH, alice, 500e6, 0, deadline)))
        );
        token.claimFor(alice, 500e6, deadline, sig);
        assertEq(token.balanceOf(alice), 500e6);
        // The nonce is used: a replay fails.
        vm.expectRevert(TestUSDC.InvalidSignature.selector);
        token.claimFor(alice, 500e6, deadline, sig);
    }

    function test_claimForRejectsWrongSignerAndExpiry() public {
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory sig =
            _sign(0xB0B, _digest(keccak256(abi.encode(CLAIM_TYPEHASH, alice, 500e6, 0, deadline))));
        vm.expectRevert(TestUSDC.InvalidSignature.selector);
        token.claimFor(alice, 500e6, deadline, sig);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(TestUSDC.ExpiredSignature.selector, deadline));
        token.claimFor(alice, 500e6, deadline, sig);
    }

    function test_permitWithEoaBothOverloads() public {
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes32 d = _digest(keccak256(abi.encode(PERMIT_TYPEHASH, alice, vault, 7e6, 0, deadline)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, d);
        token.permit(alice, vault, 7e6, deadline, v, r, s);
        assertEq(token.allowance(alice, vault), 7e6);
        bytes32 d2 = _digest(keccak256(abi.encode(PERMIT_TYPEHASH, alice, vault, 9e6, 1, deadline)));
        token.permit(alice, vault, 9e6, deadline, _sign(alicePk, d2));
        assertEq(token.allowance(alice, vault), 9e6);
        assertEq(token.nonces(alice), 2);
    }

    function test_permitAndClaimForWithSmartWallet() public {
        MockSmartWallet wallet = new MockSmartWallet(alice);
        address w = address(wallet);
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        token.claimFor(
            w,
            50e6,
            deadline,
            _sign(alicePk, _digest(keccak256(abi.encode(CLAIM_TYPEHASH, w, 50e6, 0, deadline))))
        );
        bytes32 d = _digest(keccak256(abi.encode(PERMIT_TYPEHASH, w, vault, 50e6, 1, deadline)));
        token.permit(w, vault, 50e6, deadline, _sign(alicePk, d));
        assertEq(token.allowance(w, vault), 50e6);
    }

    function test_genesisMintOnceIntoVault() public {
        vm.prank(admin);
        token.mintGenesis(55_000_000e6);
        assertEq(token.balanceOf(vault), 55_000_000e6);
        vm.prank(admin);
        vm.expectRevert(TestUSDC.GenesisAlreadyMinted.selector);
        token.mintGenesis(1);
        vm.prank(alice);
        vm.expectRevert();
        token.mintGenesis(1);
    }

    function testFuzz_claimNeverExceedsCaps(uint256 a, uint256 b, uint32 gap) public {
        a = bound(a, 1, 10_000e6);
        b = bound(b, 1, 10_000e6);
        vm.prank(alice);
        token.claim(a);
        vm.warp(vm.getBlockTimestamp() + gap);
        uint256 room = token.claimable(alice);
        vm.prank(alice);
        if (b > room) vm.expectRevert();
        token.claim(b);
        (,, uint256 total) = token.claims(alice);
        assertLe(total, token.CLAIM_CAP_LIFETIME());
    }
}
