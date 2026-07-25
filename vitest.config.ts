import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    /**
     * La suite de `sim-voxel` n'est pas une suite unitaire : chaque test avance
     * réellement un monde de 128×32×128 voxels sur des centaines de ticks, et
     * plusieurs fichiers tournent en parallèle sur les mêmes cœurs. À 3,5 ms le
     * tick, 600 ticks coûtent deux secondes à eux seuls ; les 5 s par défaut de
     * Vitest, calibrées pour des tests de fonction pure, rendaient ces tests
     * intermittents selon la charge de la machine.
     *
     * Ce n'est pas un permis d'écrire des tests lents : les runs longs (mesure
     * de l'amélioration sur plusieurs mondes) vivent dans `bench/`.
     *
     * Le délai vit ici et non dans le script npm, pour qu'un `npx vitest run`
     * lancé à la main se comporte exactement comme `pnpm test`.
     */
    testTimeout: 60_000,
  },
});
