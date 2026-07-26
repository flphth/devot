// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DevotRegistry} from "./DevotRegistry.sol";

/**
 * LifeVault — the chain side of the economy. The server stays the authority and
 * holds live balances in memory; the chain only ever sees creation, death and
 * withdrawal. There is NO per-tick settlement — the server batches transitions
 * (burned inference, combat spoils, monster loot, death→residue) and settles
 * them with one server-signed call.
 *
 * Two contracts only (no third): this LifeVault, which deploys and solely mints
 * the DevotRegistry (ERC-721). Monsters live in the same vault as ownerless
 * balance entries.
 *
 * INVARIANT (the security property): every wei deposited is, at all times, still
 * held in the vault, burned, or withdrawn:
 *
 *     depositedTotal == address(this).balance + burnedTotal + withdrawnTotal
 *     address(this).balance == Σ lifeOf (live) + Σ residueOf (dead)
 *
 * `claim` follows checks-effects-interactions. README states the server is
 * trusted (its signature authorises settlements).
 */
contract LifeVault {
    DevotRegistry public immutable registry;
    address public immutable server; // trusted authority; signs settlements
    address public immutable treasury; // burned wei is swept here (inference paid for)

    uint256 public nextTokenId = 1;
    uint256 public depositedTotal;
    uint256 public burnedTotal;
    uint256 public withdrawnTotal;

    mapping(uint256 => uint256) public lifeOf; // wei balance of a live devot/monster
    mapping(uint256 => uint256) public residueOf; // wei balance of a dead devot's residue
    mapping(uint256 => bool) public isMonster; // ownerless entries

    enum Kind {
        Burn, // a = tokenId, amount = burned
        Transfer, // a = from, b = to, amount = moved
        Death // a = tokenId, b = residueId (its balance drops to the ground)
    }

    struct Delta {
        uint8 kind;
        uint256 a;
        uint256 b;
        uint256 amount;
    }

    event DevotCreated(uint256 indexed tokenId, address indexed god, uint256 deposit, bytes32 identityHash);
    event MonsterSpawned(uint256 indexed tokenId);
    event Settled(uint256 count, uint256 swept);
    event Claimed(uint256 indexed tokenId, address indexed to, uint256 amount, bool residue);

    modifier onlyServer() {
        require(msg.sender == server, "ONLY_SERVER");
        _;
    }

    constructor(address server_, address treasury_) {
        require(server_ != address(0) && treasury_ != address(0), "ZERO");
        server = server_;
        treasury = treasury_;
        registry = new DevotRegistry(address(this));
    }

    /// createDevot(identityHash) payable → mint NFT to the god + balance = msg.value.
    function createDevot(bytes32 identityHash) external payable returns (uint256 tokenId) {
        require(msg.value > 0, "NO_DEPOSIT");
        tokenId = nextTokenId++;
        registry.mint(msg.sender, tokenId, identityHash);
        lifeOf[tokenId] = msg.value;
        depositedTotal += msg.value;
        emit DevotCreated(tokenId, msg.sender, msg.value, identityHash);
    }

    /// An ownerless monster: zero balance, grows only by looting (via settle Transfer).
    function spawnMonster(uint256 tokenId) external onlyServer {
        require(tokenId >= nextTokenId, "ID_RESERVED");
        require(!isMonster[tokenId] && lifeOf[tokenId] == 0, "EXISTS");
        isMonster[tokenId] = true;
        emit MonsterSpawned(tokenId);
    }

    /// Batch of server-signed transitions. Burned wei is swept to the treasury.
    function settle(Delta[] calldata deltas, bytes calldata serverSig) external {
        bytes32 digest = keccak256(abi.encode(block.chainid, address(this), deltas));
        require(_recover(_eth(digest), serverSig) == server, "BAD_SIG");

        uint256 sweep = 0;
        for (uint256 i = 0; i < deltas.length; i++) {
            Delta calldata d = deltas[i];
            if (d.kind == uint8(Kind.Burn)) {
                lifeOf[d.a] -= d.amount; // reverts on overflow → can't burn more than held
                burnedTotal += d.amount;
                sweep += d.amount;
            } else if (d.kind == uint8(Kind.Transfer)) {
                lifeOf[d.a] -= d.amount;
                lifeOf[d.b] += d.amount;
            } else {
                // Death: the whole live balance becomes a ground residue.
                require(residueOf[d.b] == 0, "RESIDUE_EXISTS");
                residueOf[d.b] = lifeOf[d.a];
                lifeOf[d.a] = 0;
            }
        }
        if (sweep > 0) {
            (bool ok,) = treasury.call{value: sweep}("");
            require(ok, "SWEEP_FAIL");
        }
        emit Settled(deltas.length, sweep);
    }

    /// The god withdraws a living devot's balance. Checks-effects-interactions.
    function claim(uint256 tokenId) external {
        require(msg.sender == registry.ownerOf(tokenId), "NOT_OWNER");
        uint256 amount = lifeOf[tokenId];
        lifeOf[tokenId] = 0; // effects before interaction
        withdrawnTotal += amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "PAY_FAIL");
        emit Claimed(tokenId, msg.sender, amount, false);
    }

    /// The god of a dead devot withdraws its residue (server directs who owns it).
    function claimResidue(uint256 residueId, address to) external onlyServer {
        uint256 amount = residueOf[residueId];
        require(amount > 0, "NO_RESIDUE");
        residueOf[residueId] = 0; // effects before interaction
        withdrawnTotal += amount;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "PAY_FAIL");
        emit Claimed(residueId, to, amount, true);
    }

    function _eth(bytes32 hash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        require(sig.length == 65, "SIG_LEN");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(digest, v, r, s);
    }
}
