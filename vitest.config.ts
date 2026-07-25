import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@devot/shared": r("./packages/shared/src/index.ts"),
      "@devot/agents": r("./packages/agents/src/index.ts"),
      "@devot/sim": r("./packages/sim/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
  },
});
