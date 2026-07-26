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

/** A birth the player paid for, as the chain describes it — not as they do. */
export interface VerifiedMint {
  tokenId: bigint;
  deposit: bigint;
  /** Who actually paid, taken from the event. Lower-cased. */
  god: string;
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

  /**
   * VERIFIES A BIRTH THE PLAYER PAID FOR THEMSELVES.
   *
   * When the god signs in their own wallet, the server never sees the money
   * move — it is handed a transaction hash and has to decide whether to believe
   * it. So it believes nothing the client says: it reads the receipt from the
   * chain, checks the log came from OUR vault, and takes the payer and the
   * amount from the event rather than from the request.
   *
   * A transaction hash is a bearer token until it is spent, which is why the
   * caller must also refuse one it has already honoured.
   */
  async verifyMint(txHash: string, minimumWei: bigint): Promise<VerifiedMint> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new Error("that is not a transaction hash");
    }
    const provider = this.wallet.provider!;
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) throw new Error("no such transaction on this chain");
    if (receipt.status !== 1) throw new Error("that transaction failed");

    const vaultAddress = this.config.vaultAddress.toLowerCase();
    for (const log of receipt.logs) {
      // The log must come from OUR vault. Without this check a lookalike
      // contract could emit a DevotCreated of its own and mint devots for free.
      if (log.address.toLowerCase() !== vaultAddress) continue;
      try {
        const parsed = this.vault.interface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
        if (parsed?.name !== "DevotCreated") continue;
        const deposit = parsed.args.deposit as bigint;
        if (deposit < minimumWei) {
          throw new Error(
            `the deposit was ${deposit} wei; a devot costs ${minimumWei}`,
          );
        }
        return {
          tokenId: parsed.args.tokenId as bigint,
          deposit,
          god: (parsed.args.god as string).toLowerCase(),
          txHash,
        };
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("the deposit")) throw err;
        // A log we cannot parse. Not ours.
      }
    }
    throw new Error("that transaction did not create a devot");
  }

  /** What the chain says a devot holds. The server's own number should match. */
  async lifeOf(tokenId: bigint): Promise<bigint> {
    return (await this.vault.lifeOf!(tokenId)) as bigint;
  }
}
