import { describe, expect, it } from "vitest";
import { buildSchemaInstruction, extractJsonObject, parseDecision } from "../src/parseDecision.ts";

describe("extractJsonObject", () => {
  it("returns a clean object unchanged", () => {
    expect(extractJsonObject('{"action":"idle"}')).toBe('{"action":"idle"}');
  });

  it("pulls JSON out of a ```json fence", () => {
    const text = "Here you go:\n```json\n{\"action\":\"move\"}\n```\ndone";
    expect(extractJsonObject(text)).toBe('{"action":"move"}');
  });

  it("pulls JSON out of surrounding prose", () => {
    const text = 'I think I should idle. {"action":"idle","emotion":"calme"} — that is my choice.';
    expect(extractJsonObject(text)).toBe('{"action":"idle","emotion":"calme"}');
  });

  it("handles nested braces and braces inside strings", () => {
    const text = '{"action":"speak","utterance":"a } b { c","direction":{"x":1,"z":2}}';
    expect(extractJsonObject(text)).toBe(text);
  });

  it("returns null when there is no object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject("")).toBeNull();
  });
});

describe("parseDecision", () => {
  it("accepts a minimal valid decision", () => {
    const r = parseDecision('{"action":"idle"}');
    expect(r).toEqual({ ok: true, decision: { action: "idle" } });
  });

  it("accepts all optional fields with correct types", () => {
    const r = parseDecision(
      '{"action":"move","targetId":"food-1","direction":{"x":1,"z":-1},"utterance":"hi","emotion":"curieux"}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.decision.direction).toEqual({ x: 1, z: -1 });
      expect(r.decision.targetId).toBe("food-1");
    }
  });

  it("parses JSON wrapped in prose (json_object / reasoning models)", () => {
    const r = parseDecision('Sure! {"action":"eat","targetId":"f2"} ok');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.decision.action).toBe("eat");
  });

  it("rejects an unknown action", () => {
    const r = parseDecision('{"action":"teleport"}');
    expect(r.ok).toBe(false);
  });

  it("rejects a missing action", () => {
    expect(parseDecision('{"emotion":"calme"}').ok).toBe(false);
  });

  it("rejects a malformed direction", () => {
    expect(parseDecision('{"action":"move","direction":{"x":"a","z":1}}').ok).toBe(false);
  });

  it("rejects a wrong-typed utterance", () => {
    expect(parseDecision('{"action":"speak","utterance":42}').ok).toBe(false);
  });

  it("rejects non-object JSON and non-JSON", () => {
    expect(parseDecision("[1,2,3]").ok).toBe(false);
    expect(parseDecision("totally not json").ok).toBe(false);
    expect(parseDecision('{"action":').ok).toBe(false);
  });

  it("ignores unknown extra fields (lenient)", () => {
    const r = parseDecision('{"action":"idle","mood":"???","extra":1}');
    expect(r.ok).toBe(true);
  });
});

describe("buildSchemaInstruction", () => {
  it("lists every action and demands a single JSON object", () => {
    const s = buildSchemaInstruction();
    expect(s).toContain("SINGLE JSON object");
    for (const a of ["idle", "move", "eat", "attack", "reproduce", "speak", "flee"]) {
      expect(s).toContain(`"${a}"`);
    }
  });
});
