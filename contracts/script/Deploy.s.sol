// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BalanceRoot} from "../src/BalanceRoot.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {Vault} from "../src/Vault.sol";

/// @notice Deploys TestUSDC, Vault and BalanceRoot, runs genesis (ADR-0013) and, if
/// ADMIN_SAFE is set, hands every admin and pauser role to the Safe and renounces the
/// deployer's. Writes deployments/<chainId>.json.
///   forge script script/Deploy.s.sol --rpc-url $RPC --broadcast [--verify]
contract Deploy is Script {
    uint256 internal constant HOUSE = 50_000_000e6;
    uint256 internal constant INSURANCE = 5_000_000e6;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address signer = vm.envAddress("ENGINE_SIGNER_ADDRESS");
        address poster = vm.envOr("ROOT_POSTER_ADDRESS", signer);
        address safe = vm.envOr("ADMIN_SAFE", address(0));
        uint256 dailyLimit = vm.envOr("VAULT_DAILY_LIMIT", uint256(1_000_000e6));

        vm.startBroadcast(pk);
        TestUSDC token = new TestUSDC(deployer);
        Vault vault = new Vault(IERC20(address(token)), deployer, signer, dailyLimit);
        BalanceRoot root = new BalanceRoot(deployer, poster);
        token.setVault(address(vault));
        token.mintGenesis(HOUSE + INSURANCE);
        vault.recordGenesis(HOUSE, INSURANCE);
        if (safe != address(0)) {
            bytes32 admin = 0x00; // DEFAULT_ADMIN_ROLE
            token.grantRole(admin, safe);
            vault.grantRole(admin, safe);
            vault.grantRole(vault.PAUSER_ROLE(), safe);
            root.grantRole(admin, safe);
            vault.renounceRole(vault.PAUSER_ROLE(), deployer);
            token.renounceRole(admin, deployer);
            vault.renounceRole(admin, deployer);
            root.renounceRole(admin, deployer);
        }
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "block", block.number);
        vm.serializeAddress(key, "testUsdc", address(token));
        vm.serializeAddress(key, "vault", address(vault));
        vm.serializeAddress(key, "balanceRoot", address(root));
        vm.serializeAddress(key, "engineSigner", signer);
        vm.serializeAddress(key, "rootPoster", poster);
        string memory json = vm.serializeAddress(key, "admin", safe == address(0) ? deployer : safe);
        vm.writeJson(
            json,
            string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json")
        );
    }
}
