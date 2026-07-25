import { describe, expect, it } from "vitest";
import { hash32 } from "../src/index.js";

/**
 * VECTEURS DE RÉFÉRENCE du hachage.
 *
 * `hash32` est le point de rupture le plus probable du port WGSL : c'est la
 * seule fonction où l'arithmétique 32 bits de JavaScript (`Math.imul`, `>>>`)
 * doit coïncider bit à bit avec celle du GPU (`u32`, `>>`). Si un jour la passe
 * GPU produit un état différent du CPU, la première chose à faire est de
 * comparer ces valeurs côté GPU : elles localisent la divergence en une minute
 * au lieu d'une journée.
 *
 * Reproduire côté WGSL :
 *   hash32(0u, 0u, 0u), hash32(1u, 0u, 0u), … et comparer aux nombres ci-dessous.
 */
const GOLDEN: Array<[number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [524287, 0, 20260725],
  [12345, 678, 90123],
  [-1, -1, -1],
  [2147483647, 2147483647, 2147483647],
];

describe("hash32 — vecteurs de référence pour le port WGSL", () => {
  it("produit exactement les mêmes valeurs qu'à la rédaction du noyau", () => {
    const actual = GOLDEN.map(([a, b, c]) => hash32(a, b, c));
    // Toute modification de `hash32` casse la conformité CPU ↔ GPU sans
    // prévenir : ce test est là pour rendre ce changement impossible en silence.
    expect(actual).toEqual([
      0, 1753845952, 1834104592, 520022130, 107883781, 844223953, 1164421724, 1314933940,
    ]);
  });

  it("n'a qu'un seul point fixe connu, et le monde ne l'atteint jamais", () => {
    // hash32(0,0,0) === 0 : la fonction est une avalanche de XOR et de
    // multiplications, elle n'a aucun terme constant, donc l'entrée nulle sort
    // nulle. Ce n'est pas un défaut à corriger (le corriger casserait la
    // conformité déjà portée en WGSL) mais un piège à connaître : un monde de
    // graine 0 verrait le voxel 0 tirer 0 au tick 0. Le constructeur de
    // `VoxelWorld` ramène donc toute graine nulle à 1.
    expect(hash32(0, 0, 0)).toBe(0);
    expect(hash32(0, 0, 1)).not.toBe(0);
  });

  it("reste dans les entiers 32 bits non signés sur des entrées extrêmes", () => {
    for (const [a, b, c] of GOLDEN) {
      const h = hash32(a, b, c);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("les bits de poids faible sont bien répartis", () => {
    // Les passes ne lisent jamais le hachage en entier : elles en prennent des
    // tranches basses (`& 0xffff` pour la pousse, `% 1000` pour le croisement).
    // Un biais dans ces bits-là créerait un motif fantôme dans le monde, invisible
    // à la lecture du code. C'est donc eux qu'on surveille, pas la valeur entière.
    //
    // Ce test naquit pour le choix de direction de l'eau, qui lisait `& 3` ;
    // l'eau a été retirée du monde, la propriété reste nécessaire.
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 40_000; i++) counts[hash32(i, 7, 99) & 3]!++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(40_000 / 4 - 900);
      expect(c).toBeLessThan(40_000 / 4 + 900);
    }
  });
});
