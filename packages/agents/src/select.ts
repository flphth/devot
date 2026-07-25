import { AnthropicApiMind } from "./providers/anthropicApi.ts";
import { ClaudeAgentMind } from "./providers/claudeAgent.ts";
import { MockMind } from "./providers/mock.ts";
import type { MindProvider } from "./types.ts";
import { ZgMind } from "./zgMind.ts";

/** The four minds a devot can be animated by, selected via `MIND=`. */
export function selectMind(name: string = process.env.MIND ?? "mock"): MindProvider {
  switch (name) {
    case "mock":
      return new MockMind();
    case "api":
      return new AnthropicApiMind();
    case "claude":
      return new ClaudeAgentMind();
    case "0g":
      return new ZgMind();
    default:
      throw new Error(`unknown MIND=${name} (expected one of: claude | api | mock | 0g)`);
  }
}
