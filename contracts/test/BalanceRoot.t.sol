// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BalanceRoot} from "../src/BalanceRoot.sol";

contract BalanceRootTest is Test {
    BalanceRoot internal br;
    address internal poster = makeAddr("poster");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        br = new BalanceRoot(makeAddr("admin"), poster);
    }

    function _leaf(address a, uint256 b) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a, b))));
    }

    /// Two-leaf tree: root = hash of the sorted pair (OZ commutative hashing).
    function _pair(bytes32 x, bytes32 y) internal pure returns (bytes32) {
        return x < y ? keccak256(abi.encode(x, y)) : keccak256(abi.encode(y, x));
    }

    function test_postAndVerify() public {
        bytes32 la = _leaf(alice, 1_000e6);
        bytes32 lb = _leaf(bob, 250e6);
        vm.prank(poster);
        br.post(500_000, _pair(la, lb), 42);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = lb;
        assertTrue(br.verify(500_000, alice, 1_000e6, proof));
        assertFalse(br.verify(500_000, alice, 1_001e6, proof));
        assertFalse(br.verify(499_999, alice, 1_000e6, proof));
        (, uint64 seq) = br.roots(500_000);
        assertEq(seq, 42);
    }

    function test_onlyPosterAndIncreasingHours() public {
        vm.expectRevert();
        br.post(1, bytes32(uint256(1)), 1);
        vm.startPrank(poster);
        br.post(10, bytes32(uint256(1)), 1);
        vm.expectRevert(abi.encodeWithSelector(BalanceRoot.HourNotIncreasing.selector, 10, 10));
        br.post(10, bytes32(uint256(2)), 2);
        vm.expectRevert(BalanceRoot.EmptyRoot.selector);
        br.post(11, bytes32(0), 3);
        vm.stopPrank();
    }
}
