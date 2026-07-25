import type { TokenUsage } from "@devot/shared";
import { describe, expect, it } from "vitest";
import { MindParseError, completeWithRepair, type CompleteFn } from "../src/structured.ts";

const u = (i: number, o: number): TokenUsage => ({ inputTokens: i, outputTokens: o });
const req = { system: "rules", history: [], event: "you are hungry" };

describe("completeWithRepair", () => {
  it("returns on a first-try valid decision (no repair)", async () => {
    const complete: CompleteFn = async () => ({ text: '{"action":"eat","targetId":"f1"}', usage: u(100, 20) });
    const t = await completeWithRepair(req, complete);
    expect(t.repaired).toBe(false);
    expect(t.decision).toEqual({ action: "eat", targetId: "f1" });
    expect(t.usage).toEqual(u(100, 20));
  });

  it("injects the schema instruction into the last user turn", async () => {
    let seenSystem = "";
    let seenLastUser = "";
    const complete: CompleteFn = async (messages, system) => {
      seenSystem = system;
      seenLastUser = messages[messages.length - 1]!.content;
      return { text: '{"action":"idle"}', usage: u(10, 2) };
    };
    await completeWithRepair(req, complete);
    expect(seenSystem).toBe("rules");
    expect(seenLastUser).toContain("you are hungry");
    expect(seenLastUser).toContain("SINGLE JSON object");
  });

  it("repairs once and sums usage from both calls", async () => {
    let call = 0;
    const complete: CompleteFn = async (messages) => {
      call++;
      if (call === 1) return { text: "I refuse to output JSON.", usage: u(100, 50) };
      // On repair, the model has been shown its error.
      expect(messages.some((m) => m.role === "assistant")).toBe(true);
      return { text: '{"action":"flee"}', usage: u(120, 10) };
    };
    const t = await completeWithRepair(req, complete);
    expect(t.repaired).toBe(true);
    expect(t.decision.action).toBe("flee");
    expect(t.usage).toEqual(u(220, 60)); // 100+120, 50+10
  });

  it("throws MindParseError when repair also fails (usage still summed)", async () => {
    const complete: CompleteFn = async () => ({ text: "still no json", usage: u(30, 5) });
    await expect(completeWithRepair(req, complete)).rejects.toBeInstanceOf(MindParseError);
    try {
      await completeWithRepair(req, complete);
    } catch (e) {
      expect((e as MindParseError).usage).toEqual(u(60, 10));
    }
  });

  it("carries the chatId of the accepted completion", async () => {
    const complete: CompleteFn = async () => ({ text: '{"action":"idle"}', usage: u(1, 1), chatId: "chat-xyz" });
    const t = await completeWithRepair(req, complete);
    expect(t.chatId).toBe("chat-xyz");
  });
});
