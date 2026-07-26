import { Contract, JsonRpcProvider, Wallet, formatEther, keccak256, toUtf8Bytes } from "ethers";

/**
 * THE CHAIN, FOR REAL.
 *
 * A devot is not created by the server deciding one exists. It is created by a
 * DEPOSIT: `createDevot(identityHash)` is called with value, the vault mints an
 * NFT to the god, and the wei sent becomes that devot's balance — which in this
 * game is the same thing as its life.
 *
 * That is why a birth waits. Every other movement of value is batched and
 * signed precisely so the simulation never blocks on a network, but a birth is
 * the one moment where the god actually pays, and paying is not something that
 * can be assumed and reconciled later.
 *
 * TESTNET ONLY. The key that signs these lives in an env var.
 */

/** Only what we call. A full ABI would be noise. */
const VAULT_ABI = [
  "function createDevot(bytes32 identityHash) payable returns (uint256 tokenId)",
  "function lifeOf(uint256 tokenId) view returns (uint256)",
  "function nextTokenId() view returns (uint256)",
  "function depositedTotal() view returns (uint256)",
  "event DevotCreated(uint256 indexed tokenId, address indexed god, uint256 deposit, bytes32 identityHash)",
];

export interface MintedDevot {
  tokenId: bigint;
  /** What was actually deposited, in wei. This becomes the devot's balance. */
  deposit: bigint;
  txHash: string;
}

export interface VaultConfig {
  rpcUrl: string;
  privateKey: string;
  vaultAddress: string;
  /** What a birth costs, in wei. */
  depositWei: bigint;
}

/**
 * Reads the configuration from the environment, or returns undefined when the
 * chain is not set up. Deliberately explicit: a missing key is not an error to
 * throw at boot, it is a world that runs without a chain, and the caller says
 * so out loud.
 */
export function vaultConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): VaultConfig | undefined {
  const privateKey = env.ZG_PRIVATE_KEY?.trim();
  const vaultAddress = env.LIFEVAULT_ADDRESS?.trim();
  const rpcUrl = env.ZG_RPC_URL?.trim();
  if (!privateKey || !vaultAddress || !rpcUrl) return undefined;
  return {
    rpcUrl,
    privateKey,
    vaultAddress,
    depositWei: BigInt(env.DEVOT_DEPOSIT_WEI ?? "1000000000000000"), // 0.001 OG
  };
}

export class LifeVaultClient {
  private wallet: Wallet;
  private vault: Contract;

  constructor(private config: VaultConfig) {
    const provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, provider);
    this.vault = new Contract(config.vaultAddress, VAULT_ABI, this.wallet);
  }

  get address(): string {
    return this.wallet.address;
  }

  /** What the signing account can still spend, as a human-readable string. */
  async funds(): Promise<string> {
    const provider = this.wallet.provider!;
    return formatEther(await provider.getBalance(this.wallet.address));
  }

  /**
   * Pays for a devot and waits for the chain to agree that it exists.
   *
   * The tokenId comes from the DevotCreated event in the receipt rather than
   * from the return value: a state-changing call returns a transaction, not a
   * value, and reading nextTokenId afterwards would race every other birth.
   */
  async createDevot(identitySeed: string): Promise<MintedDevot> {
    const identityHash = keccak256(toUtf8Bytes(identitySeed));
    const tx = await this.vault.createDevot!(identityHash, {
      value: this.config.depositWei,
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`createDevot reverted (tx ${tx.hash})`);
    }

    for (const log of receipt.logs) {
      try {
        const parsed = this.vault.interface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
        if (parsed?.name === "DevotCreated") {
          return {
            tokenId: parsed.args.tokenId as bigint,
            deposit: parsed.args.deposit as bigint,
            txHash: tx.hash,
          };
        }
      } catch {
        // A log from another contract in the same block. Not ours.
      }
    }
    throw new Error(`createDevot produced no DevotCreated event (tx ${tx.hash})`);
  }

  /** What the chain says a devot holds. The server's own number should match. */
  async lifeOf(tokenId: bigint): Promise<bigint> {
    return (await this.vault.lifeOf!(tokenId)) as bigint;
  }
}
