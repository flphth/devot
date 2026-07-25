import { desc, eq, sql } from "drizzle-orm";
import type { DevotDb } from "./client.js";
import { voxelLineages, voxelTombstones } from "./schema.js";

export interface LineageRow {
  id: string;
  godId: string;
  name: string;
  born: number;
  died: number;
  maxGeneration: number;
  releasedTick: number;
}

export interface TombstoneRow {
  organismId: number;
  lineageId: string;
  godId: string;
  generation: number;
  bornTick: number;
  diedTick: number;
  bodyVoxels: number;
  eaten: number;
  bites: number;
  bitten: number;
  crossbred: boolean;
  cause: string;
}

/**
 * Le registre des lignées et le cimetière du monde commun.
 *
 * Une lignée survit à ses individus : c'est la seule chose qu'un joueur possède
 * vraiment. Les pierres tombales, elles, gardent trace de ce que chaque
 * individu a fait — mangé, mordu, subi — pour que la mort laisse un récit et
 * pas seulement un trou dans un tableau.
 */
export class VoxelRegistryRepo {
  constructor(private db: DevotDb) {}

  registerLineage(row: {
    id: string;
    godId: string;
    name: string;
    releasedTick: number;
  }): void {
    this.db
      .insert(voxelLineages)
      .values({
        id: row.id,
        godId: row.godId,
        name: row.name,
        releasedAt: Date.now(),
        releasedTick: row.releasedTick,
        born: 1,
        died: 0,
        maxGeneration: 0,
      })
      .onConflictDoNothing()
      .run();
  }

  /** Un individu de plus dans la lignée, et peut-être une génération de plus. */
  noteBirth(lineageId: string, generation: number): void {
    if (!lineageId) return;
    this.db
      .update(voxelLineages)
      .set({
        born: sql`${voxelLineages.born} + 1`,
        maxGeneration: sql`MAX(${voxelLineages.maxGeneration}, ${generation})`,
      })
      .where(eq(voxelLineages.id, lineageId))
      .run();
  }

  bury(t: TombstoneRow): void {
    this.db.insert(voxelTombstones).values(t).run();
    if (t.lineageId) {
      this.db
        .update(voxelLineages)
        .set({ died: sql`${voxelLineages.died} + 1` })
        .where(eq(voxelLineages.id, t.lineageId))
        .run();
    }
  }

  lineages(): LineageRow[] {
    return this.db
      .select({
        id: voxelLineages.id,
        godId: voxelLineages.godId,
        name: voxelLineages.name,
        born: voxelLineages.born,
        died: voxelLineages.died,
        maxGeneration: voxelLineages.maxGeneration,
        releasedTick: voxelLineages.releasedTick,
      })
      .from(voxelLineages)
      .all();
  }

  /** Les dernières morts, les plus récentes d'abord. */
  recentTombstones(limit = 12): TombstoneRow[] {
    return this.db
      .select({
        organismId: voxelTombstones.organismId,
        lineageId: voxelTombstones.lineageId,
        godId: voxelTombstones.godId,
        generation: voxelTombstones.generation,
        bornTick: voxelTombstones.bornTick,
        diedTick: voxelTombstones.diedTick,
        bodyVoxels: voxelTombstones.bodyVoxels,
        eaten: voxelTombstones.eaten,
        bites: voxelTombstones.bites,
        bitten: voxelTombstones.bitten,
        crossbred: voxelTombstones.crossbred,
        cause: voxelTombstones.cause,
      })
      .from(voxelTombstones)
      .orderBy(desc(voxelTombstones.id))
      .limit(limit)
      .all();
  }

  countTombstones(): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(voxelTombstones)
      .get();
    return row?.n ?? 0;
  }
}
