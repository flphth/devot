import { describe, expect, it } from "vitest";
import { InferenceGate } from "../src/budget.ts";
import { hpCost } from "../src/hpCost.ts";
import { ZgMind } from "../src/zgMind.ts";
import type { ThinkRequest } from "../src/types.ts";

/**
 * Drives the FULL ZgMind data path against a SIMULATED 0G provider (injected
 * broker + fetch). This is NOT the goal's "real 0G provider" proof — it verifies
 * the request/response/verification plumbing so the live run (which needs a
 * funded testnet key) is de-risked: OpenAI-compat body, usage normalisation,
 * chatId extraction, processResponse → TEE, price from listService, repair path.
 */

const req: ThinkRequest = {
  system: "rules",
  history: [{ role: "assistant", content: "j'existe" }],
  event: "un monstre surgit",
  model: "will-be-overridden-by-metadata",
};

interface Call {
  url: string;
  body: any;
  headers: Record<string, string>;
}

function makeBroker(over: Partial<{ processResponse: (...a: any[]) => Promise<boolean>; services: any[] }> = {}) {
  const processed: Array<{ provider: string; chatId: string; content?: string }> = [];
  const services = over.services ?? [
    {
      provider: "0xProviderTEE",
      model: "llama-3.3-70b",
      inputPrice: 100_000_000_000n, // neurons/token
      outputPrice: 300_000_000_000n,
      verifiability: "TEE",
    },
  ];
  const broker = {
    inference: {
      listService: async () => services,
      getServiceMetadata: async (_p: string) => ({ endpoint: "https://prov.example/v1", model: "llama-3.3-70b" }),
      getRequestHeaders: async (_p: string, _content: string) => ({ "X-Zg-Auth": "sig-123" }),
      processResponse: over.processResponse ?? (async (p: string, chatId: string, content?: string) => {
        processed.push({ provider: p, chatId, content });
        return true;
      }),
    },
  };
  return { broker, processed };
}

/** A fetch stub that returns queued OpenAI-compatible responses and logs calls. */
function makeFetch(responses: Array<{ body: any; chatIdHeader?: string; status?: number }>) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: any, init: any) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k] = String(v);
    calls.push({ url: String(url), body: JSON.parse(init.body), headers });
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (r.chatIdHeader) h["ZG-Res-Key"] = r.chatIdHeader;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: h });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const okBody = (content: string, promptT = 120, completionT = 18, id = "chatcmpl-abc") => ({
  id,
  choices: [{ message: { role: "assistant", content } }],
  usage: { prompt_tokens: promptT, completion_tokens: completionT },
});

describe("ZgMind (simulated 0G provider)", () => {
  it("POSTs to /chat/completions, normalises usage, verifies TEE, prices from the listing", async () => {
    const { broker, processed } = makeBroker();
    const { fetchImpl, calls } = makeFetch([{ body: okBody('{"action":"flee","emotion":"peur"}'), chatIdHeader: "zg-999" }]);
    const mind = new ZgMind({ broker, fetchImpl, gate: new InferenceGate({ requestsPerMinute: 100000, burst: 100 }) });

    const r = await mind.think(req);

    // request shape
    expect(calls[0]!.url).toBe("https://prov.example/v1/chat/completions");
    expect(calls[0]!.headers["X-Zg-Auth"]).toBe("sig-123");
    expect(calls[0]!.body.model).toBe("llama-3.3-70b");
    expect(calls[0]!.body.messages[0]).toEqual({ role: "system", content: "rules" });

    // decision + usage normalisation (prompt/completion → input/output)
    expect(r.decision).toEqual({ action: "flee", emotion: "peur" });
    expect(r.usage).toEqual({ inputTokens: 120, outputTokens: 18 });
    expect(r.model).toBe("llama-3.3-70b");

    // TEE proof from processResponse, chatId from the ZG-Res-Key header
    expect(r.tee).toEqual({ verified: true, chatId: "zg-999", provider: "0xProviderTEE" });
    expect(processed[0]).toMatchObject({ provider: "0xProviderTEE", chatId: "zg-999" });

    // price derived from the on-chain listing → non-zero cost that drops a balance
    expect(r.price.in).toBeGreaterThan(0);
    expect(hpCost(r.usage, r.price)).toBeGreaterThan(0);
  });

  it("falls back to the response id when no ZG-Res-Key header is present", async () => {
    const { broker } = makeBroker();
    const { fetchImpl } = makeFetch([{ body: okBody('{"action":"idle"}', 10, 2, "resp-777") }]);
    const mind = new ZgMind({ broker, fetchImpl });
    const r = await mind.think(req);
    expect(r.tee?.chatId).toBe("resp-777");
  });

  it("runs the repair path when the first output is not valid JSON", async () => {
    const { broker, processed } = makeBroker();
    const { fetchImpl, calls } = makeFetch([
      { body: okBody("Je refuse de répondre en JSON.", 100, 40), chatIdHeader: "zg-1" },
      { body: okBody('{"action":"attack"}', 130, 12), chatIdHeader: "zg-2" },
    ]);
    const mind = new ZgMind({ broker, fetchImpl });
    const r = await mind.think(req);

    expect(calls).toHaveLength(2); // asked twice
    expect(r.repaired).toBe(true);
    expect(r.decision.action).toBe("attack");
    expect(r.usage).toEqual({ inputTokens: 230, outputTokens: 52 }); // summed
    // TEE is verified on the ACCEPTED (second) completion
    expect(r.tee?.chatId).toBe("zg-2");
    expect(processed[0]!.content).toContain("attack");
  });

  it("selects a forced provider address", async () => {
    const services = [
      { provider: "0xA", model: "m-a", inputPrice: 1n, outputPrice: 1n, verifiability: "TEE" },
      { provider: "0xB", model: "m-b", inputPrice: 2n, outputPrice: 2n, verifiability: "TEE" },
    ];
    const { broker } = makeBroker({ services });
    const { fetchImpl } = makeFetch([{ body: okBody('{"action":"idle"}'), chatIdHeader: "x" }]);
    const mind = new ZgMind({ broker, fetchImpl, providerAddress: "0xB" });
    const r = await mind.think(req);
    expect(r.tee?.provider).toBe("0xB");
  });

  it("opts into json_object mode only when asked", async () => {
    const { broker } = makeBroker();
    const withMode = makeFetch([{ body: okBody('{"action":"idle"}'), chatIdHeader: "x" }]);
    await new ZgMind({ broker, fetchImpl: withMode.fetchImpl, jsonMode: true }).think(req);
    expect(withMode.calls[0]!.body.response_format).toEqual({ type: "json_object" });

    const withoutMode = makeFetch([{ body: okBody('{"action":"idle"}'), chatIdHeader: "x" }]);
    await new ZgMind({ broker, fetchImpl: withoutMode.fetchImpl }).think(req);
    expect(withoutMode.calls[0]!.body.response_format).toBeUndefined();
  });

  it("surfaces provider HTTP errors", async () => {
    const { broker } = makeBroker();
    const { fetchImpl } = makeFetch([{ body: { error: "rate limited" }, status: 429 }]);
    const mind = new ZgMind({ broker, fetchImpl });
    await expect(mind.think(req)).rejects.toThrow(/429/);
  });
});
