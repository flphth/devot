// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {LifeVault} from "../src/LifeVault.sol";
import {DevotRegistry} from "../src/DevotRegistry.sol";

/**
 * Deploy LifeVault (which deploys DevotRegistry) to 0G Galileo testnet and mint
 * the founder devot as an NFT — the on-chain half of G3's observable.
 * Server & treasury are the deployer (the god) for the proto.
 */
contract DeployAndMint is Script {
    function run() external {
        uint256 pk = vm.envUint("ZG_PRIVATE_KEY");
        address god = vm.addr(pk);

        vm.startBroadcast(pk);
        LifeVault vault = new LifeVault(god, god);
        uint256 tokenId = vault.createDevot{value: 0.001 ether}(keccak256("DVT-000-0001"));
        vm.stopBroadcast();

        DevotRegistry reg = vault.registry();
        console.log("god          :", god);
        console.log("LifeVault    :", address(vault));
        console.log("DevotRegistry:", address(reg));
        console.log("tokenId      :", tokenId);
        console.log("ownerOf      :", reg.ownerOf(tokenId));
        console.log("name/symbol  :", reg.name(), reg.symbol());
        console.log("lifeOf (wei) :", vault.lifeOf(tokenId));
        console.log("deposited    :", vault.depositedTotal());
    }
}
