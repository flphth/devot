import { BrowserProvider, Contract, keccak256, toUtf8Bytes, type Eip1193Provider } from "ethers";
import { useCallback, useEffect, useState } from "react";

/**
 * THE GOD PAYS WITH THEIR OWN HANDS.
 *
 * The deposit that brings a devot into the world used to be signed by the
 * server, out of a key in an env file — which meant the god was not really
 * paying for anything. Here the player connects their own wallet and signs the
 * transaction themselves, and the server only ever learns a hash it then has to
 * go and verify on chain.
 *
 * Injected wallet only (MetaMask, Rabby, and anything else speaking EIP-1193).
 * No project id, no third-party account, nothing to register: if a wallet is in
 * the browser this works, and if it is not, the screen says so.
 */

/** 0G Galileo testnet. Devot is not deployed anywhere that holds real value. */
export const ZG_CHAIN = {
  chainId: "0x40DA", // 16602
  chainName: "0G Galileo Testnet",
  nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
  rpcUrls: ["https://evmrpc-testnet.0g.ai"],
  blockExplorerUrls: ["https://chainscan-galileo.0g.ai"],
} as const;

const VAULT_ABI = [
  "function createDevot(bytes32 identityHash) payable returns (uint256 tokenId)",
];

/** Set at build time; falls back to the deployed vault. */
const VAULT_ADDRESS =
  (import.meta.env.VITE_LIFEVAULT_ADDRESS as string | undefined) ??
  "0x30B5E767917695B9268948DB872aa3c22EBba62D";

/** What a devot costs, in wei. Kept in step with the server's own floor. */
const DEPOSIT_WEI = BigInt(
  (import.meta.env.VITE_DEVOT_DEPOSIT_WEI as string | undefined) ?? "1000000000000000",
);

type InjectedProvider = Eip1193Provider & {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function injected(): InjectedProvider | undefined {
  return (globalThis as { ethereum?: InjectedProvider }).ethereum;
}

export type WalletState =
  | { kind: "unavailable" }
  | { kind: "disconnected" }
  | { kind: "connected"; address: string; onRightChain: boolean };

export interface Wallet {
  state: WalletState;
  connect: () => Promise<void>;
  /** Signs the deposit and returns the transaction hash. Throws if refused. */
  payForDevot: (seed: string) => Promise<string>;
  depositWei: bigint;
}

export function useWallet(): Wallet {
  const [state, setState] = useState<WalletState>(
    injected() ? { kind: "disconnected" } : { kind: "unavailable" },
  );

  const refresh = useCallback(async () => {
    const eth = injected();
    if (!eth) return setState({ kind: "unavailable" });
    const provider = new BrowserProvider(eth);
    const accounts = await provider.listAccounts();
    if (accounts.length === 0) return setState({ kind: "disconnected" });
    const network = await provider.getNetwork();
    setState({
      kind: "connected",
      address: accounts[0]!.address,
      onRightChain: network.chainId === BigInt(ZG_CHAIN.chainId),
    });
  }, []);

  useEffect(() => {
    void refresh();
    const eth = injected();
    if (!eth?.on) return;
    const onChange = () => void refresh();
    eth.on("accountsChanged", onChange);
    eth.on("chainChanged", onChange);
    return () => {
      eth.removeListener?.("accountsChanged", onChange);
      eth.removeListener?.("chainChanged", onChange);
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    const eth = injected();
    if (!eth) throw new Error("no wallet in this browser");
    await eth.request({ method: "eth_requestAccounts" });

    // Ask for the right chain, and offer to add it if the wallet has never
    // seen it. 4902 is "unrecognised chain" — the only case worth handling,
    // since every other failure is the user saying no.
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ZG_CHAIN.chainId }],
      });
    } catch (err) {
      if ((err as { code?: number }).code === 4902) {
        await eth.request({ method: "wallet_addEthereumChain", params: [ZG_CHAIN] });
      }
    }
    await refresh();
  }, [refresh]);

  const payForDevot = useCallback(async (seed: string) => {
    const eth = injected();
    if (!eth) throw new Error("no wallet in this browser");
    const provider = new BrowserProvider(eth);
    const signer = await provider.getSigner();
    const vault = new Contract(VAULT_ADDRESS, VAULT_ABI, signer);
    const tx = await vault.createDevot!(keccak256(toUtf8Bytes(seed)), {
      value: DEPOSIT_WEI,
    });
    // The hash is enough: the server verifies the receipt itself, and waiting
    // here would only mean the browser and the server both wait for the same
    // block.
    return tx.hash as string;
  }, []);

  return { state, connect, payForDevot, depositWei: DEPOSIT_WEI };
}
