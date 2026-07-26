import type { Micro } from "@devot/shared";
import { Vault } from "./vault.ts";

/**
 * A minimal autonomous predator/prey engine over the {@link Vault}. Monsters
 * have NO LLM mind (free to run): they metabolise (burn balance to exist), hunt
 * the weakest devot (kill it and pocket its balance → grow), and starve if they
 * stop hunting (releasing their hoard as a ground residue). A "hunter" devot
 * that is richer than a fattened monster slays it and claims its treasure —
 * the visible arbitrage: a fat monster is a walking bounty. Food is what died:
 * residues are grazed by the living. Every move goes through the Vault, so the
 * G3 invariant (Σ soldes + brûlé + retiré == Σ déposé) holds throughout.
 */

export interface ArenaEvent {
  step: number;
  text: string;
}

type Kind = "devot" | "monster";
interface Ent {
  id: string;
  kind: Kind;
  alive: boolean;
  hunter: boolean;
}

export interface ArenaOptions {
  /** Balance a monster burns each step just to exist. */
  monsterMetabolism?: Micro;
  /** Balance a devot burns each step by thinking. */
  devotThinkCost?: Micro;
  /** A monster must be at least this fat before a hunter deems it worth the risk. */
  bountyThreshold?: Micro;
}

export class Arena {
  readonly vault = new Vault();
  readonly events: ArenaEvent[] = [];
  private readonly ents = new Map<string, Ent>();
  private readonly residues: string[] = [];
  private stepNo = 0;
  private residueSeq = 0;

  constructor(private readonly opts: ArenaOptions = {}) {}

  addDevot(id: string, deposit: Micro, opts?: { hunter?: boolean }): void {
    this.vault.createDevot(id, deposit);
    this.ents.set(id, { id, kind: "devot", alive: true, hunter: opts?.hunter ?? false });
  }

  addMonster(id: string): void {
    this.vault.spawnMonster(id);
    this.ents.set(id, { id, kind: "monster", alive: true, hunter: false });
  }

  get step(): number {
    return this.stepNo;
  }
  private alive(kind: Kind): Ent[] {
    return [...this.ents.values()].filter((e) => e.alive && e.kind === kind);
  }
  private bal(id: string): Micro {
    return this.vault.balanceOf(id);
  }
  private log(text: string): void {
    this.events.push({ step: this.stepNo, text });
  }

  /** Kill an entity: its remaining balance drops as a residue (if any). */
  private slay(id: string): Micro {
    const rid = `res-${++this.residueSeq}`;
    this.vault.kill(id, rid);
    this.ents.get(id)!.alive = false;
    const left = this.vault.residueOf(rid);
    if (left > 0) this.residues.push(rid);
    return left;
  }

  tick(): void {
    this.stepNo++;
    const metab = this.opts.monsterMetabolism ?? 200;
    const think = this.opts.devotThinkCost ?? 100;
    const bounty = this.opts.bountyThreshold ?? 1000;

    // 1. Hunters slay a fat-enough monster they can beat, and claim its treasure.
    for (const hero of this.alive("devot").filter((d) => d.hunter)) {
      const monster = this.alive("monster").sort((a, b) => this.bal(b.id) - this.bal(a.id))[0];
      if (monster && this.bal(monster.id) >= bounty && this.bal(hero.id) >= this.bal(monster.id)) {
        const treasure = this.bal(monster.id);
        if (treasure > 0) this.vault.transfer(monster.id, hero.id, treasure);
        this.slay(monster.id);
        this.log(`⚔️  ${hero.id} abat le monstre ${monster.id} et réclame son trésor (${treasure} µ) → solde ${this.bal(hero.id)} µ`);
      }
    }

    // 2. Monsters hunt the weakest prey (non-hunter devots), then metabolise.
    for (const monster of this.alive("monster")) {
      const prey = this.alive("devot")
        .filter((d) => !d.hunter)
        .sort((a, b) => this.bal(a.id) - this.bal(b.id))[0];
      if (prey) {
        const loot = this.bal(prey.id);
        if (loot > 0) this.vault.transfer(prey.id, monster.id, loot);
        this.slay(prey.id);
        this.log(`👹 le monstre ${monster.id} tue ${prey.id} et encaisse ${loot} µ → il grossit à ${this.bal(monster.id)} µ`);
      }
      const bal = this.bal(monster.id);
      if (bal >= metab) {
        this.vault.burn(monster.id, metab);
      } else {
        const released = this.slay(monster.id);
        this.log(`🍂 le monstre ${monster.id}, sans chasse, meurt de faim et relâche son magot (${released} µ)`);
      }
    }

    // 3. Devots graze what died, then think (which costs life).
    for (const devot of this.alive("devot")) {
      if (this.residues.length > 0) {
        const rid = this.residues.shift()!;
        const gained = this.vault.residueOf(rid);
        this.vault.eatResidue(devot.id, rid);
        this.log(`🌾 ${devot.id} ramasse un résidu au sol (${gained} µ) → solde ${this.bal(devot.id)} µ`);
      }
      const bal = this.bal(devot.id);
      if (bal >= think) this.vault.burn(devot.id, think);
      else {
        this.slay(devot.id);
        this.log(`💀 ${devot.id} s'éteint, son solde épuisé`);
      }
    }
  }

  run(steps: number): void {
    for (let i = 0; i < steps && (this.alive("devot").length > 0 || this.alive("monster").length > 0); i++) {
      this.tick();
    }
  }
}
