import { Arena } from "@devot/sim";

/**
 * G4 — une partie autonome (aucune intervention). Des monstres SANS esprit LLM
 * (gratuits à faire vivre) chassent les devots, grossissent de leur solde, et
 * meurent de faim s'ils cessent de chasser. Un devot assez riche abat un
 * monstre gras et réclame son trésor. La nourriture, c'est ce qui est mort. À la
 * fin, l'invariant de G3 tient toujours.
 *
 *   pnpm arena
 */
function main(): void {
  const a = new Arena({ monsterMetabolism: 250, devotThinkCost: 100, bountyThreshold: 1000 });
  a.addDevot("prey-1", 700);
  a.addDevot("prey-2", 1000);
  a.addDevot("hero", 8000, { hunter: true });
  a.addMonster("mon-1");

  console.log("🏟️  Arène — partie autonome : prédateurs & primes ambulantes\n");
  console.log(`   dépôts : prey-1=700 µ · prey-2=1000 µ · hero=8000 µ (chasseur) · mon-1=0 µ\n`);

  for (let i = 0; i < 3; i++) a.tick();
  a.addMonster("mon-2");
  a.addDevot("prey-3", 600);
  for (let i = 0; i < 3; i++) a.tick();

  for (const e of a.events) console.log(`  [t${e.step}] ${e.text}`);

  const ok = a.vault.checkInvariant();
  console.log(`\n═══ Économie fermée ═══`);
  console.log(`  déposé ${a.vault.deposited} µ  =  soldes ${a.vault.held()} µ  +  brûlé ${a.vault.burned} µ  +  retiré ${a.vault.withdrawn} µ`);
  console.log(`  invariant Σ soldes + brûlé + retiré == Σ déposé : ${ok ? "✓ TENU" : "✗ ROMPU"}`);
  if (!ok) process.exitCode = 1;
}

main();
