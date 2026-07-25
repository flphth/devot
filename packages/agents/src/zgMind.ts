import type { Price, TokenUsage } from "@devot/shared";
import { InferenceGate } from "./budget.ts";
import { completeWithRepair, type CompleteFn } from "./structured.ts";
import type { MindMessage, MindProvider, TeeProof, ThinkRequest, ThinkResult } from "./types.ts";

/**
 * ZgMind — a devot's mind running on the 0G Compute Network (the prize path).
 *
 * The G1 "porte" is resolved here: 0G providers expose an OpenAI-compatible
 * `/chat/completions` but do NOT reliably support native `json_schema`
 * structured output, so we take the portable path — schema-in-prompt +
 * json_object (opt-in) + a repair retry (see `completeWithRepair`). Every HTTP
 * call is gated to respect 0G's 30 req/min + 5 concurrent limits. After a valid
 * decision, `processResponse` verifies the TEE attestation; the boolean + chat
 * id are returned in `ThinkResult.tee` to be persisted and shown in the Esprit
 * panel.
 */

async function dynamicImport(spec: string): Promise<any> {
  return import(spec);
}

/** Minimal shape of the on-chain service listing we depend on. */
interface ZgService {
  provider: string;
  model?: string;
  url?: string;
  inputPrice?: bigint;
  outputPrice?: bigint;
  verifiability?: string;
}

interface ZgInference {
  listService(): Promise<ZgService[]>;
  getServiceMetadata(provider: string): Promise<{ endpoint: string; model: string }>;
  getRequestHeaders(provider: string, content: string): Promise<Record<string, string>>;
  processResponse(provider: string, chatId: string, content?: string): Promise<boolean>;
  acknowledgeProviderSigner?(provider: string): Promise<unknown>;
}

interface ZgLedger {
  getLedger(): Promise<unknown>;
  addLedger(amountOG: number): Promise<unknown>;
}

interface ZgBroker {
  inference: ZgInference;
  ledger?: ZgLedger;
}

export interface ZgMindOptions {
  privateKey?: string;
  rpcUrl?: string;
  /** Force a specific provider address; otherwise the first TEE service is used. */
  providerAddress?: string;
  /** Send `response_format: {type:"json_object"}` (opt-in; some providers 400). */
  jsonMode?: boolean;
  /** Provisional A0GI→USD rate for pricing. G2 recalibrates against a real run. */
  a0giUsd?: number;
  /** OG to deposit into the ledger on first run (0G needs a prepaid balance). */
  ledgerOG?: number;
  gate?: InferenceGate;
  /** Inject a broker (tests / a pre-built broker); skips SDK+key bootstrap. */
  broker?: ZgBroker;
  /** Inject a fetch implementation (tests); defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** 1 A0GI = 1e18 neurons (on-chain price unit), like wei. */
const NEURONS_PER_A0GI = 1e18;

/**
 * Provisional USD price from the on-chain per-token neuron prices. This is
 * deliberately a placeholder pending G2 ("Recalibrer … ne pas deviner —
 * remesurer sur une vraie inférence"): it makes the balance drop by a real,
 * service-derived amount without pretending to be the final calibration.
 */
function zgPrice(svc: ZgService, a0giUsd: number): Price {
  const neuronToUsd = a0giUsd / NEURONS_PER_A0GI;
  return {
    in: Number(svc.inputPrice ?? 0n) * neuronToUsd * 1_000_000,
    out: Number(svc.outputPrice ?? 0n) * neuronToUsd * 1_000_000,
  };
}

const estTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

export class ZgMind implements MindProvider {
  readonly name = "0g" as const;

  private broker?: ZgBroker;
  private service?: ZgService;
  private endpoint?: string;
  private model?: string;
  private ready = false;
  private readonly gate: InferenceGate;

  constructor(private readonly opts: ZgMindOptions = {}) {
    this.gate = opts.gate ?? new InferenceGate();
  }

  private async getBroker(): Promise<ZgBroker> {
    if (this.broker) return this.broker;
    if (this.opts.broker) {
      this.broker = this.opts.broker;
      return this.broker;
    }
    const privateKey = this.opts.privateKey ?? process.env.ZG_PRIVATE_KEY ?? "";
    const rpcUrl = this.opts.rpcUrl ?? process.env.ZG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
    if (!privateKey) throw new Error("ZG_PRIVATE_KEY is required for MIND=0g (use a throwaway testnet key)");

    let ethers: any;
    let sdk: any;
    try {
      ethers = await dynamicImport("ethers");
    } catch {
      throw new Error("`ethers` not installed — run `pnpm install` to use MIND=0g");
    }
    try {
      sdk = await dynamicImport("@0gfoundation/0g-compute-ts-sdk");
    } catch {
      throw new Error("`@0gfoundation/0g-compute-ts-sdk` not installed — run `pnpm install` to use MIND=0g");
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    this.broker = (await sdk.createZGComputeNetworkBroker(wallet)) as ZgBroker;
    return this.broker;
  }

  /** Resolve provider address, service (for price), endpoint and model once. */
  private async resolveService(): Promise<{ provider: string; endpoint: string; model: string; svc: ZgService }> {
    if (this.service && this.endpoint && this.model) {
      return { provider: this.service.provider, endpoint: this.endpoint, model: this.model, svc: this.service };
    }
    const broker = await this.getBroker();
    const services = await broker.inference.listService();
    if (!services.length) throw new Error("0G: no inference services available");

    const wanted = this.opts.providerAddress ?? process.env.ZG_PROVIDER;
    const svc =
      (wanted ? services.find((s) => s.provider.toLowerCase() === wanted.toLowerCase()) : undefined) ??
      services.find((s) => (s.verifiability ?? "").toUpperCase().includes("TEE")) ??
      services[0]!;

    const meta = await broker.inference.getServiceMetadata(svc.provider);
    this.service = svc;
    this.endpoint = meta.endpoint;
    this.model = meta.model;
    return { provider: svc.provider, endpoint: meta.endpoint, model: meta.model, svc };
  }

  /**
   * One-time on-chain bootstrap so a funded run is a single command: create the
   * ledger account + deposit the prepaid balance 0G inference requires, and
   * acknowledge the provider's TEE signer. Skipped for injected brokers (tests).
   * Fails loudly with the exact shortfall when the wallet is unfunded.
   */
  private async ensureAccount(broker: ZgBroker, provider: string): Promise<void> {
    if (this.ready) return;
    if (this.opts.broker || !broker.ledger) {
      this.ready = true;
      return;
    }
    const ledgerOG = this.opts.ledgerOG ?? Number(process.env.ZG_LEDGER_OG ?? "2");
    try {
      await broker.ledger.getLedger();
    } catch {
      // No account yet → create it and deposit the prepaid inference balance.
      await broker.ledger.addLedger(ledgerOG);
    }
    try {
      await broker.inference.acknowledgeProviderSigner?.(provider);
    } catch {
      // Already acknowledged, or not required by this provider.
    }
    this.ready = true;
  }

  async think(req: ThinkRequest): Promise<ThinkResult> {
    const broker = await this.getBroker();
    const { provider, endpoint, model, svc } = await this.resolveService();
    await this.ensureAccount(broker, provider);
    const a0giUsd = this.opts.a0giUsd ?? Number(process.env.ZG_A0GI_USD ?? "2");
    const jsonMode = this.opts.jsonMode ?? process.env.ZG_RESPONSE_FORMAT === "json_object";

    const complete: CompleteFn = async (messages, system) => {
      const openaiMessages = [
        { role: "system", content: system },
        ...messages.map((m: MindMessage) => ({ role: m.role, content: m.content })),
      ];
      const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

      return this.gate.run(async () => {
        const headers = await broker.inference.getRequestHeaders(provider, lastUser);
        const body: Record<string, unknown> = {
          model,
          messages: openaiMessages,
          max_tokens: req.maxTokens ?? 512,
        };
        if (jsonMode) body.response_format = { type: "json_object" };

        const doFetch = this.opts.fetchImpl ?? fetch;
        const res = await doFetch(`${endpoint}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`0G provider ${res.status} ${res.statusText}: ${detail.slice(0, 300)}`);
        }
        const data: any = await res.json();
        const text: string = data?.choices?.[0]?.message?.content ?? "";
        const usage: TokenUsage = {
          inputTokens: data?.usage?.prompt_tokens ?? estTokens(openaiMessages.map((m) => m.content).join(" ")),
          outputTokens: data?.usage?.completion_tokens ?? estTokens(text),
        };
        const chatId: string = res.headers.get("ZG-Res-Key") ?? data?.id ?? "";
        return { text, usage, chatId };
      });
    };

    const t = await completeWithRepair(req, complete);

    let tee: TeeProof | undefined;
    if (t.chatId) {
      const verified = await broker.inference
        .processResponse(provider, t.chatId, t.raw)
        .catch(() => false);
      tee = { verified, chatId: t.chatId, provider };
    }

    return {
      decision: t.decision,
      usage: t.usage,
      price: zgPrice(svc, a0giUsd),
      raw: t.raw,
      repaired: t.repaired,
      tee,
      model,
    };
  }
}
