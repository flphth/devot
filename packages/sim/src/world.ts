import type { DevotEntity, FoodEntity, Vec3 } from "@devot/shared";

/** État chaud du monde, en mémoire. Persistance périodique côté serveur. */
export class World {
  devots = new Map<string, DevotEntity>();
  food = new Map<string, FoodEntity>();
  /** Taille de la carte : carré [-size, size] sur x/z. */
  constructor(public size = 50) {}

  aliveDevots(): DevotEntity[] {
    return [...this.devots.values()].filter((d) => d.state !== "dead");
  }

  nearestFood(pos: Vec3): FoodEntity | undefined {
    let best: FoodEntity | undefined;
    let bestD = Infinity;
    for (const f of this.food.values()) {
      const d = dist2(pos, f.pos);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }
}

export function dist2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function clampToWorld(pos: Vec3, size: number): void {
  pos.x = Math.max(-size, Math.min(size, pos.x));
  pos.z = Math.max(-size, Math.min(size, pos.z));
}
