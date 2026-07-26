import type { DevotEntity, FoodEntity, MonsterEntity, Vec3 } from "@devot/shared";

/** The world's hot state, in memory. Persisted periodically by the server. */
export class World {
  devots = new Map<string, DevotEntity>();
  monsters = new Map<string, MonsterEntity>();
  food = new Map<string, FoodEntity>();
  /** Map size: the square [-size, size] on x/z. */
  constructor(public size = 50) {}

  aliveDevots(): DevotEntity[] {
    return [...this.devots.values()].filter((d) => d.state !== "dead");
  }

  aliveMonsters(): MonsterEntity[] {
    return [...this.monsters.values()].filter((m) => m.state !== "dead");
  }

  /**
   * A devot or a monster by id. Combat needs this: an attack targets "whatever
   * is called this", and a devot is free to turn on a predator.
   */
  creature(id: string): DevotEntity | MonsterEntity | undefined {
    return this.devots.get(id) ?? this.monsters.get(id);
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
