// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title Hourly balance roots (M5-06)
/// @notice The engine's root poster publishes a Merkle root of every account's withdrawable
/// balance each hour, so anyone can prove their balance against the chain. Leaves follow the
/// OpenZeppelin standard tree: keccak256(bytes.concat(keccak256(abi.encode(account, balance)))).
contract BalanceRoot is AccessControl {
    bytes32 public constant POSTER_ROLE = keccak256("POSTER_ROLE");

    /// @notice Engine event seq the root was taken at, so it ties back to the log.
    struct Root {
        bytes32 root;
        uint64 seq;
    }

    mapping(uint64 hour => Root) public roots;
    uint64 public latestHour;

    event RootPosted(uint64 indexed hour, bytes32 root, uint64 seq);

    error HourNotIncreasing(uint64 hour, uint64 latest);
    error EmptyRoot();

    constructor(address admin, address poster) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POSTER_ROLE, poster);
    }

    /// @param hour Unix hours (timestamp / 3600) the snapshot belongs to; strictly increasing.
    function post(uint64 hour, bytes32 root, uint64 seq) external onlyRole(POSTER_ROLE) {
        if (root == bytes32(0)) revert EmptyRoot();
        if (latestHour != 0 && hour <= latestHour) revert HourNotIncreasing(hour, latestHour);
        roots[hour] = Root(root, seq);
        latestHour = hour;
        emit RootPosted(hour, root, seq);
    }

    function verify(uint64 hour, address account, uint256 balance, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        bytes32 root = roots[hour].root;
        if (root == bytes32(0)) return false;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, balance))));
        return MerkleProof.verifyCalldata(proof, root, leaf);
    }
}
