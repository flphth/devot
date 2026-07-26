// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LifeVault} from "../src/LifeVault.sol";
import {DevotRegistry} from "../src/DevotRegistry.sol";

contract LifeVaultTest is Test {
    LifeVault vault;
    uint256 serverPk = 0xA11CE;
    address server;
    address treasury = address(0xBEEF);
    address god = address(0x6D);

    function setUp() public {
        server = vm.addr(serverPk);
        vault = new LifeVault(server, treasury);
    }

    function _sign(LifeVault.Delta[] memory d) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encode(block.chainid, address(vault), d));
        bytes32 eth = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(serverPk, eth);
        return abi.encodePacked(r, s, v);
    }

    function testCreateMintsNftAndBalance() public {
        vm.deal(god, 1 ether);
        vm.prank(god);
        uint256 id = vault.createDevot{value: 0.05 ether}(keccak256("DVT-000-0001"));
        DevotRegistry reg = vault.registry();
        assertEq(reg.ownerOf(id), god);
        assertEq(reg.balanceOf(god), 1);
        assertEq(vault.lifeOf(id), 0.05 ether);
        assertEq(vault.depositedTotal(), 0.05 ether);
        assertTrue(reg.supportsInterface(0x80ac58cd)); // is an ERC-721
    }

    function testClaimFollowsChecksEffectsInteractions() public {
        vm.deal(god, 1 ether);
        vm.prank(god);
        uint256 id = vault.createDevot{value: 0.05 ether}(keccak256("id"));
        uint256 before = god.balance;
        vm.prank(god);
        vault.claim(id);
        assertEq(vault.lifeOf(id), 0);
        assertEq(god.balance, before + 0.05 ether);
        assertEq(vault.withdrawnTotal(), 0.05 ether);
    }

    function testSettleBurnSweepsAndConserves() public {
        vm.deal(god, 1 ether);
        vm.prank(god);
        uint256 id = vault.createDevot{value: 1 ether}(keccak256("id"));

        LifeVault.Delta[] memory d = new LifeVault.Delta[](1);
        d[0] = LifeVault.Delta(uint8(LifeVault.Kind.Burn), id, 0, 0.3 ether);
        vault.settle(d, _sign(d));

        assertEq(vault.lifeOf(id), 0.7 ether);
        assertEq(vault.burnedTotal(), 0.3 ether);
        assertEq(treasury.balance, 0.3 ether);
        // depositedTotal == balance + burned + withdrawn
        assertEq(vault.depositedTotal(), address(vault).balance + vault.burnedTotal() + vault.withdrawnTotal());
    }

    function testSettleRejectsForgedSignature() public {
        vm.deal(god, 1 ether);
        vm.prank(god);
        uint256 id = vault.createDevot{value: 1 ether}(keccak256("id"));
        LifeVault.Delta[] memory d = new LifeVault.Delta[](1);
        d[0] = LifeVault.Delta(uint8(LifeVault.Kind.Burn), id, 0, 0.1 ether);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(uint256(0xBAD), keccak256("whatever"));
        vm.expectRevert(bytes("BAD_SIG"));
        vault.settle(d, abi.encodePacked(r, s, v));
    }
}

/// Bounded random driver for the invariant run.
contract VaultHandler is Test {
    LifeVault public vault;
    uint256 serverPk;
    uint256[] public tokens;
    uint256[] public residues;

    constructor(LifeVault v, uint256 pk) {
        vault = v;
        serverPk = pk;
        vm.deal(address(this), 1_000_000 ether);
    }

    receive() external payable {}

    function _sign(LifeVault.Delta[] memory d) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encode(block.chainid, address(vault), d));
        bytes32 eth = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(serverPk, eth);
        return abi.encodePacked(r, s, v);
    }

    function createDevot(uint256 dep) public {
        dep = bound(dep, 1, 100 ether);
        if (address(this).balance < dep) return;
        uint256 id = vault.createDevot{value: dep}(bytes32(dep));
        tokens.push(id);
    }

    function burn(uint256 seed, uint256 amt) public {
        if (tokens.length == 0) return;
        uint256 id = tokens[seed % tokens.length];
        uint256 bal = vault.lifeOf(id);
        if (bal == 0) return;
        LifeVault.Delta[] memory d = new LifeVault.Delta[](1);
        d[0] = LifeVault.Delta(uint8(LifeVault.Kind.Burn), id, 0, bound(amt, 1, bal));
        vault.settle(d, _sign(d));
    }

    function transfer(uint256 s1, uint256 s2, uint256 amt) public {
        if (tokens.length < 2) return;
        uint256 from = tokens[s1 % tokens.length];
        uint256 to = tokens[s2 % tokens.length];
        uint256 bal = vault.lifeOf(from);
        if (from == to || bal == 0) return;
        LifeVault.Delta[] memory d = new LifeVault.Delta[](1);
        d[0] = LifeVault.Delta(uint8(LifeVault.Kind.Transfer), from, to, bound(amt, 1, bal));
        vault.settle(d, _sign(d));
    }

    function kill(uint256 seed) public {
        if (tokens.length == 0) return;
        uint256 idx = seed % tokens.length;
        uint256 id = tokens[idx];
        uint256 rid = 1_000_000_000 + id;
        if (vault.residueOf(rid) != 0) return;
        LifeVault.Delta[] memory d = new LifeVault.Delta[](1);
        d[0] = LifeVault.Delta(uint8(LifeVault.Kind.Death), id, rid, 0);
        vault.settle(d, _sign(d));
        tokens[idx] = tokens[tokens.length - 1];
        tokens.pop();
        if (vault.residueOf(rid) > 0) residues.push(rid);
    }

    function claim(uint256 seed) public {
        if (tokens.length == 0) return;
        uint256 idx = seed % tokens.length;
        uint256 id = tokens[idx];
        // The handler owns every devot it created, so it may claim.
        vault.claim(id);
        tokens[idx] = tokens[tokens.length - 1];
        tokens.pop();
    }

    function claimResidue(uint256 seed) public {
        if (residues.length == 0) return;
        uint256 idx = seed % residues.length;
        uint256 rid = residues[idx];
        vm.prank(vault.server());
        vault.claimResidue(rid, address(this));
        residues[idx] = residues[residues.length - 1];
        residues.pop();
    }
}

contract LifeVaultInvariant is Test {
    LifeVault vault;
    VaultHandler handler;
    uint256 serverPk = 0xA11CE;

    function setUp() public {
        vault = new LifeVault(vm.addr(serverPk), address(0xBEEF));
        handler = new VaultHandler(vault, serverPk);
        targetContract(address(handler));
    }

    /// Σ soldes + brûlé + retiré == Σ déposé — nothing created or destroyed.
    function invariant_conservation() public view {
        assertEq(
            vault.depositedTotal(),
            address(vault).balance + vault.burnedTotal() + vault.withdrawnTotal()
        );
    }
}
