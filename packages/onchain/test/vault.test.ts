import { describe, expect, it } from "vitest";
import { vaultConfigFromEnv } from "../src/vault.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("the chain is configured, or it is absent — never half of either", () => {
  it("is absent when anything is missing", () => {
    // A world with no chain still runs; the caller says so out loud. Throwing
    // at boot for a missing env var would take the game down instead.
    expect(vaultConfigFromEnv({})).toBeUndefined();
    expect(vaultConfigFromEnv({ ZG_PRIVATE_KEY: KEY })).toBeUndefined();
    expect(
      vaultConfigFromEnv({ ZG_PRIVATE_KEY: KEY, LIFEVAULT_ADDRESS: "0xabc" }),
    ).toBeUndefined();
  });

  it("reads a full configuration, with a default deposit", () => {
    const cfg = vaultConfigFromEnv({
      ZG_PRIVATE_KEY: KEY,
      LIFEVAULT_ADDRESS: "0x30B5E767917695B9268948DB872aa3c22EBba62D",
      ZG_RPC_URL: "https://evmrpc-testnet.0g.ai",
    });
    expect(cfg?.depositWei).toBe(1_000_000_000_000_000n);
  });

  it("lets the deposit be set, because a testnet price is not a constant", () => {
    const cfg = vaultConfigFromEnv({
      ZG_PRIVATE_KEY: KEY,
      LIFEVAULT_ADDRESS: "0x30B5E767917695B9268948DB872aa3c22EBba62D",
      ZG_RPC_URL: "https://evmrpc-testnet.0g.ai",
      DEVOT_DEPOSIT_WEI: "5000000000000000",
    });
    expect(cfg?.depositWei).toBe(5_000_000_000_000_000n);
  });

  it("ignores whitespace around values pasted out of a wallet", () => {
    const cfg = vaultConfigFromEnv({
      ZG_PRIVATE_KEY: `  ${KEY}  `,
      LIFEVAULT_ADDRESS: " 0x30B5E767917695B9268948DB872aa3c22EBba62D ",
      ZG_RPC_URL: " https://evmrpc-testnet.0g.ai ",
    });
    expect(cfg?.vaultAddress).toBe("0x30B5E767917695B9268948DB872aa3c22EBba62D");
  });

  it("treats an empty string as absent, not as a value", () => {
    // An env var set to "" is the commonest way a chain gets half-configured.
    expect(
      vaultConfigFromEnv({ ZG_PRIVATE_KEY: "", LIFEVAULT_ADDRESS: "0xabc", ZG_RPC_URL: "x" }),
    ).toBeUndefined();
  });
});
