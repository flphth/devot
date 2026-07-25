// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * DevotRegistry — a devot is an NFT (ERC-721), owned by the god who created it.
 *
 * Minimal, self-contained ERC-721 (ownerOf / balanceOf / transfer / approvals /
 * ERC-165) so a devot is a real, explorer-recognisable NFT on 0G testnet. Only
 * the LifeVault (the `minter`) can mint; each token anchors its identity hash
 * (the DVT-XXX-XXXX identity, hashed) rather than reinventing an identity scheme.
 */
contract DevotRegistry {
    string public constant name = "Devot";
    string public constant symbol = "DVT";
    address public immutable minter;

    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => bytes32) public identityHash;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed spender, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    constructor(address minter_) {
        minter = minter_;
    }

    function ownerOf(uint256 id) public view returns (address owner) {
        owner = _ownerOf[id];
        require(owner != address(0), "NOT_MINTED");
    }

    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0), "ZERO_ADDRESS");
        return _balanceOf[owner];
    }

    function mint(address to, uint256 id, bytes32 identity) external {
        require(msg.sender == minter, "ONLY_MINTER");
        require(to != address(0), "ZERO_ADDRESS");
        require(_ownerOf[id] == address(0), "ALREADY_MINTED");
        unchecked {
            _balanceOf[to]++;
        }
        _ownerOf[id] = to;
        identityHash[id] = identity;
        emit Transfer(address(0), to, id);
    }

    function approve(address spender, uint256 id) external {
        address owner = _ownerOf[id];
        require(msg.sender == owner || isApprovedForAll[owner][msg.sender], "NOT_AUTHORIZED");
        getApproved[id] = spender;
        emit Approval(owner, spender, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 id) public {
        require(from == _ownerOf[id], "WRONG_FROM");
        require(to != address(0), "ZERO_ADDRESS");
        require(
            msg.sender == from || isApprovedForAll[from][msg.sender] || msg.sender == getApproved[id],
            "NOT_AUTHORIZED"
        );
        unchecked {
            _balanceOf[from]--;
            _balanceOf[to]++;
        }
        _ownerOf[id] = to;
        delete getApproved[id];
        emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        transferFrom(from, to, id);
    }

    function tokenURI(uint256 id) external view returns (string memory) {
        ownerOf(id); // reverts if the token does not exist
        return string(abi.encodePacked("devot:0x", _toHex(identityHash[id])));
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0x80ac58cd || // ERC-721
            interfaceId == 0x5b5e139f; // ERC-721 Metadata
    }

    function _toHex(bytes32 data) private pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory out = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            out[i * 2] = alphabet[uint8(data[i] >> 4)];
            out[i * 2 + 1] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(out);
    }
}
