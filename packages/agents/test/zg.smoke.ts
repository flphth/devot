/**
 * MIND=0g smoke test: proves this provider can do what the game needs.
 *
 * Run with: ZG_PRIVATE_KEY=... npx tsx test/zg.smoke.ts
 *
 * The game cannot run on a provider that will not return a valid Decision, so
 * this asks the question directly rather than trusting the documentation. It
 * also settles the second doubt — whether a 7B grasps a world where thinking
 * costs you your life — by printing what it actually replied.
 */
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { Wallet, JsonRpcProvider } from "ethers";
import { DECISION_SCHEMA, parseDecision } from "@devot/shared";

const PROVIDER = process.env.ZG_PROVIDER ?? "0xa48f01287233509FD694a22Bf840225062E67836";
const RPC = process.env.ZG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`${ok ? "  ok" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

const wallet = new Wallet(process.env.ZG_PRIVATE_KEY!, new JsonRpcProvider(RPC));
const broker = await createZGComputeNetworkBroker(wallet);
const { endpoint, model } = await broker.inference.getServiceMetadata(PROVIDER);
console.log(`provider ${PROVIDER}\nmodel    ${model}\nendpoint ${endpoint}\n`);

async function ask(body: Record<string, unknown>) {
  const headers = await broker.inference.getRequestHeaders(PROVIDER);
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model, ...body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as any;
  return { data, chatID: res.headers.get("ZG-Res-Key") ?? data.id };
}

const event = 'You see food (grain, id "food-7") nearby at x=3.0, z=1.5. You have 40% HP left. Decide.';

// The question that decides whether MIND=0g is possible at all.
const strict = await ask({
  messages: [{ role: "user", content: event }],
  max_tokens: 300,
  response_format: {
    type: "json_schema",
    json_schema: { name: "decision", schema: DECISION_SCHEMA, strict: true },
  },
});
const raw = strict.data.choices[0].message.content;
check("json_schema is honoured and parseDecision accepts the result", (() => {
  try {
    const d = parseDecision(JSON.parse(raw));
    console.log(`      → ${d.action}${d.targetId ? ` (${d.targetId})` : ""} — "${d.thought ?? ""}"`);
    return true;
  } catch {
    console.log(`      raw: ${String(raw).slice(0, 200)}`);
    return false;
  }
})());

// The fallback, in case a future provider drops json_schema.
const loose = await ask({
  messages: [
    { role: "system", content: `Reply ONLY with JSON matching: ${JSON.stringify(DECISION_SCHEMA)}` },
    { role: "user", content: event },
  ],
  max_tokens: 300,
  response_format: { type: "json_object" },
});
check("json_object fallback also yields a usable decision", (() => {
  try { parseDecision(JSON.parse(loose.data.choices[0].message.content)); return true; } catch { return false; }
})());

// The prize asks for proof the inference really ran on 0G Compute.
check("the response carries a verifiable TEE attestation", await broker.inference.processResponse(PROVIDER, strict.chatID));

// What a thought costs, in the units the economy will be denominated in.
const u = strict.data.usage;
console.log(`\nusage: ${u.prompt_tokens} in / ${u.completion_tokens} out`);
console.log("(prices are read from the chain per provider — see listService)");

console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
