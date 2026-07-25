import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_STATS,
  SHIRT_COLORS,
  STAT_BUDGET,
  STAT_KEYS,
  STAT_MAX,
  decodeIdentity,
  defaultIdentity,
  encodeIdentity,
  signatureOf,
  statMultiplier,
  validateAppearance,
  validateStats,
  type Stats,
} from "../src/appearance.js";

/**
 * L'apparence arrive d'un client, donc rien n'est cru sur parole. Ces tests
 * couvrent exactement ce qu'un client modifié tenterait : une pièce inventée,
 * une couleur hors palette, et surtout des stats au maximum partout.
 */

describe("apparence — ce que le serveur accepte", () => {
  it("laisse passer une apparence légale", () => {
    expect(validateAppearance(DEFAULT_APPEARANCE)).toBeNull();
  });

  it("refuse une pièce qui n'existe pas", () => {
    expect(validateAppearance({ ...DEFAULT_APPEARANCE, hat: "haut-de-forme" })).toMatchObject({
      reason: expect.stringContaining("Chapeau"),
    });
    expect(validateAppearance({ ...DEFAULT_APPEARANCE, cape: "immense" })).not.toBeNull();
    expect(validateAppearance({ ...DEFAULT_APPEARANCE, build: "colossal" })).not.toBeNull();
  });

  it("refuse une couleur hors palette", () => {
    // Une couleur libre serait un vecteur d'injection dans le rendu et dans les
    // descriptions envoyées au modèle.
    expect(validateAppearance({ ...DEFAULT_APPEARANCE, shirt: "#ff00ff" })).not.toBeNull();
    expect(
      validateAppearance({ ...DEFAULT_APPEARANCE, skin: "<script>alert(1)</script>" }),
    ).not.toBeNull();
  });

  it("refuse une apparence absente ou mal formée", () => {
    expect(validateAppearance(null)).not.toBeNull();
    expect(validateAppearance("rouge")).not.toBeNull();
    expect(validateAppearance({})).not.toBeNull();
  });
});

describe("stats — le budget est l'anti-triche de la création", () => {
  it("laisse passer une répartition qui tient dans le budget", () => {
    expect(validateStats(DEFAULT_STATS)).toBeNull();
    expect(validateStats({ vitality: 5, power: 1, speed: 5, sight: 1 })).toBeNull();
  });

  it("REFUSE le maximum partout", () => {
    // Le cas qui compte : un client modifié qui s'octroie 5 sur les quatre stats.
    const cheat: Stats = { vitality: 5, power: 5, speed: 5, sight: 5 };
    const rejection = validateStats(cheat);
    expect(rejection).not.toBeNull();
    expect(rejection!.reason).toContain(String(STAT_BUDGET));
  });

  it("refuse une somme trop faible autant qu'une somme trop forte", () => {
    expect(validateStats({ vitality: 1, power: 1, speed: 1, sight: 1 })).not.toBeNull();
    expect(validateStats({ vitality: 4, power: 4, speed: 4, sight: 4 })).not.toBeNull();
  });

  it("refuse une stat hors bornes, même si le total tombe juste", () => {
    // 9 + 1 + 1 + 1 = 12 : le total est bon, mais 9 dépasse le maximum.
    expect(validateStats({ vitality: 9, power: 1, speed: 1, sight: 1 })).not.toBeNull();
    expect(validateStats({ vitality: 0, power: 5, speed: 5, sight: 2 })).not.toBeNull();
  });

  it("refuse ce qui n'est pas un entier", () => {
    expect(validateStats({ vitality: 3.5, power: 3, speed: 3, sight: 2.5 })).not.toBeNull();
    expect(validateStats({ vitality: "5", power: 3, speed: 2, sight: 2 })).not.toBeNull();
    expect(validateStats(null)).not.toBeNull();
  });

  it("le budget par défaut est effectivement dépensé en entier", () => {
    const total = STAT_KEYS.reduce((sum, k) => sum + DEFAULT_STATS[k], 0);
    expect(total).toBe(STAT_BUDGET);
  });
});

describe("effet d'une stat", () => {
  it("3 est le point neutre", () => {
    expect(statMultiplier(3)).toBeCloseTo(1, 6);
  });

  it("l'écart entre le minimum et le maximum est net mais borné", () => {
    expect(statMultiplier(1)).toBeCloseTo(0.6, 6);
    expect(statMultiplier(STAT_MAX)).toBeCloseTo(1.4, 6);
    // Un peu plus du double entre les extrêmes : visible, jamais écrasant.
    expect(statMultiplier(STAT_MAX) / statMultiplier(1)).toBeLessThan(2.5);
  });

  it("borne les valeurs aberrantes au lieu de les propager", () => {
    expect(statMultiplier(99)).toBe(statMultiplier(STAT_MAX));
    expect(statMultiplier(-4)).toBe(statMultiplier(1));
    expect(statMultiplier(Number.NaN)).toBe(statMultiplier(1));
  });
});

describe("signature", () => {
  it("le même devot donne toujours la même signature", () => {
    const a = signatureOf(DEFAULT_APPEARANCE, DEFAULT_STATS, ["curieux", "prudent"], "je doute");
    const b = signatureOf(DEFAULT_APPEARANCE, DEFAULT_STATS, ["prudent", "curieux"], "je doute");
    // L'ordre des traits ne compte pas : c'est le même être.
    expect(a).toBe(b);
    expect(a).toMatch(/^DVT-[0-9A-Z]{3}-[0-9A-Z]{4}$/);
  });

  it("un seul choix différent donne une signature franchement différente", () => {
    const base = signatureOf(DEFAULT_APPEARANCE, DEFAULT_STATS, ["curieux"], "");
    const hat = signatureOf(
      { ...DEFAULT_APPEARANCE, hat: "couronne" },
      DEFAULT_STATS,
      ["curieux"],
      "",
    );
    const shirt = signatureOf(
      { ...DEFAULT_APPEARANCE, shirt: SHIRT_COLORS[5]! },
      DEFAULT_STATS,
      ["curieux"],
      "",
    );
    const stats = signatureOf(
      DEFAULT_APPEARANCE,
      { vitality: 5, power: 1, speed: 3, sight: 3 },
      ["curieux"],
      "",
    );
    expect(new Set([base, hat, shirt, stats]).size).toBe(4);
  });

  it("des combinaisons variées ne se télescopent pas", () => {
    const seen = new Set<string>();
    for (const hat of ["aucun", "bonnet", "large", "casque", "couronne"] as const) {
      for (const shirt of SHIRT_COLORS) {
        seen.add(signatureOf({ ...DEFAULT_APPEARANCE, hat, shirt }, DEFAULT_STATS, [], ""));
      }
    }
    expect(seen.size).toBe(5 * SHIRT_COLORS.length);
  });
});

describe("persistance de l'identité", () => {
  it("un aller-retour rend exactement la même identité", () => {
    const identity = defaultIdentity(["curieux", "vorace"]);
    const back = decodeIdentity(encodeIdentity(identity));
    expect(back).toEqual(identity);
  });

  it("une identité illisible ou illégale est refusée, pas devinée", () => {
    expect(decodeIdentity(null)).toBeNull();
    expect(decodeIdentity("")).toBeNull();
    expect(decodeIdentity("{pas du json")).toBeNull();
    // Une identité dont les stats ont été trafiquées en base ne doit pas passer.
    const tampered = JSON.stringify({
      ...defaultIdentity(),
      stats: { vitality: 5, power: 5, speed: 5, sight: 5 },
    });
    expect(decodeIdentity(tampered)).toBeNull();
  });
});
