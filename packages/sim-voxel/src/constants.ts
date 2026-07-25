/**
 * Constantes du noyau. Aucune dépendance : ce package doit tourner à
 * l'identique dans un worker navigateur et dans le serveur.
 */

// ── Types de voxels ─────────────────────────────────────────────────────────
// L'ordre compte : tout ce qui est >= TISSUE_MIN est du tissu vivant, ce qui
// permet de tester l'appartenance à un organisme sans table de correspondance.
export const VOID = 0;
export const ROCK = 1;
export const BIOMASS = 2;
export const BONE = 3;
export const MUSCLE = 4;
export const STORAGE = 5;
export const MOUTH = 6;
export const EYE = 7;
export const NEURON = 8;

export const TISSUE_MIN = BONE;
export const MATERIAL_COUNT = 9;

export const MATERIAL_NAMES = [
  "vide",
  "roche",
  "biomasse",
  "os",
  "muscle",
  "réserve",
  "bouche",
  "œil",
  "neurone",
] as const;

// ── Dimensions du monde ─────────────────────────────────────────────────────
export const SX = 128;
export const SY = 32;
export const SZ = 128;
export const VOXEL_COUNT = SX * SY * SZ;

export const CHUNK = 16;
export const CX = SX / CHUNK;
export const CY = SY / CHUNK;
export const CZ = SZ / CHUNK;
export const CHUNK_COUNT = CX * CY * CZ;

// ── Économie : l'énergie est la vie ─────────────────────────────────────────
// Tout est en entiers (virgule fixe) : exact, et identique CPU ↔ GPU.
// 1 unité d'énergie = 1 µ-unité. Un voxel de biomasse « riche » vaut
// NUTRIENT_MAX, soit de quoi entretenir un petit corps quelques dizaines de ticks.
export const NUTRIENT_MAX = 60_000;
/**
 * Richesse d'une plante qui vient de pousser — et, depuis la correction
 * thermodynamique, la SEULE entrée d'énergie du monde. Portée de 20 000 à
 * 60 000 : tant que les cadavres rendaient huit fois leur coût, la production
 * primaire était décorative (un monde où rien ne poussait gardait 120 vivants) ;
 * une fois la charogne rendue déficitaire, il fallait que les plantes portent
 * réellement l'écosystème.
 */
export const NUTRIENT_FRESH = 60_000;
export const NUTRIENT_DECAY = 40; // perte par tick d'une biomasse au sol

/** Coût d'entretien par tick, par type de tissu (µ-unités). */
export const UPKEEP = new Int32Array(MATERIAL_COUNT);
UPKEEP[BONE] = 2;
UPKEEP[MUSCLE] = 6;
UPKEEP[STORAGE] = 3;
UPKEEP[MOUTH] = 4;
UPKEEP[EYE] = 4;
UPKEEP[NEURON] = 8;

/**
 * PRÉDATION. Mordre coûte, et NOURRIT : la chair arrachée passe directement
 * dans le prédateur, à la même perte de rendement qu'une bouche sur de la
 * biomasse. Manger son voisin est donc un vrai métier, pas un geste gratuit.
 *
 * L'énergie reste conservée : la chair vaut ce que sa construction a coûté
 * (CORPSE_RETURN_PER_VOXEL), pas davantage, et 20 % se perdent à la conversion.
 * Mordre reste donc moins rentable que de construire — on ne peut pas vivre
 * éternellement de son voisin.
 *
 * Une version antérieure laissait tomber la chair au sol : cela distinguait
 * joliment la prédation du vol, mais rendait la morsure si peu payante qu'aucune
 * lignée ne s'y spécialisait.
 */
export const ATTACK_COST = 120;
/** Portée de la morsure : on mord ce qu'on TOUCHE, à une case. */
export const ATTACK_REACH = 1;

/**
 * REPRODUCTION CROISÉE. Quand un organisme se reproduit au contact d'une lignée
 * étrangère, l'enfant hérite du plan de corps de l'initiateur et d'un mélange
 * des poids de cerveau des deux — un croisement, pas une copie.
 *
 * SUZERAINETÉ : l'enfant appartient à la lignée de L'INITIATEUR, celui qui a
 * payé le coût et cédé son énergie. L'autre parent ne paie rien et ne perd
 * rien ; il ne peut donc pas revendiquer l'enfant. C'est la seule règle qui ne
 * crée pas d'incitation à squatter les lignées fécondes d'autrui.
 */
export const CROSSOVER_WEIGHT_SHARE = 500; // ‰ des poids venant du partenaire

/**
 * Surcoût d'une contraction musculaire (piloté par le cerveau).
 *
 * Ramené de 30 à 8 : à 30, chercher sa nourriture coûtait plus que la trouver,
 * et l'évolution préférait l'immobilité. Mesuré : la part d'individus porteurs
 * de muscles passe de 0,11 à 0,55 par organisme.
 */
export const MUSCLE_CONTRACTION_COST = 8;
/**
 * Surcoût d'une pensée par voxel neurone, en plus de l'entretien du tissu.
 *
 * Ramené de 12 à 3. À 12, aucun cerveau ne survivait à trois mille ticks, sur
 * aucune graine : penser coûtait 20 par neurone et par tick pour un bénéfice
 * que le monde ne payait pas. À 3, les cerveaux persistent dans les six mondes
 * mesurés (10 à 120 porteurs sur 6 000 ticks, génération 10 à 26).
 *
 * C'est le paramètre le plus délicat du projet : c'est lui qui incarne « penser
 * coûte la vie ». Trop haut, la pensée s'éteint ; trop bas, elle est gratuite et
 * ne veut plus rien dire. Toute modification exige de remesurer.
 */
export const NEURON_THINKING_COST = 3;

/** Capacité énergétique : base + apport de chaque voxel réserve. */
export const CAPACITY_BASE = 40_000;
export const CAPACITY_PER_STORAGE = 25_000;

/** Une bouche convertit au plus ceci par tick, avec une perte à la conversion. */
export const MOUTH_INTAKE_PER_TICK = 4_000;
export const MOUTH_EFFICIENCY_NUM = 4;
export const MOUTH_EFFICIENCY_DEN = 5; // 80 % — le reste est dissipé

/**
 * Coût énergétique de faire pousser un voxel de tissu.
 *
 * Abaissé de 1 200 à 500 en même temps que la thermodynamique était corrigée :
 * quand les cadavres ne subventionnaient plus la croissance, un corps de dix
 * voxels coûtait 12 000 — plus que la dotation d'un nouveau-né — et les lignées
 * mouraient avant d'avoir un corps.
 */
export const GROWTH_COST = 500;
/**
 * Un organisme ne pousse que s'il garde cette réserve après le coût.
 * Doit rester BIEN en dessous de l'énergie héritée par un nouveau-né : le germe
 * est un voxel d'os sans bouche, donc incapable de manger avant d'avoir poussé.
 * Un plancher trop haut créait un blocage mortel — le nouveau-né ne pouvait ni
 * grandir ni s'alimenter, et toute la descendance mourait.
 */
export const GROWTH_ENERGY_FLOOR = 2_500;

/**
 * Ce qu'une dépouille rend du COÛT DE CONSTRUCTION de chacun de ses voxels —
 * en plus de l'énergie que l'organisme avait encore en réserve, elle aussi
 * versée au cadavre.
 *
 * Doit rester strictement sous `GROWTH_COST`, sinon mourir devient rentable et
 * le monde fabrique de l'énergie : c'était le cas avec 12 000 face à un coût de
 * construction de 1 200, soit un amplificateur ×8. La conséquence était
 * invisible mais totale — l'écosystème vivait de ses propres cadavres, la
 * production primaire ne servait plus à rien (un monde où RIEN ne poussait
 * gardait 120 vivants), et donc plus rien ne récompensait le fait de chercher
 * sa nourriture : la sélection éliminait systématiquement les neurones.
 *
 * À 250 pour 500 investis, la décomposition perd la moitié, et la bouche qui
 * mange le cadavre n'en récupère que 80 % : la boucle est descendante.
 */
export const CORPSE_RETURN_PER_VOXEL = 250;

/** Reproduction : coût fixe de l'acte, puis part transmise à l'enfant (‰). */
export const REPRO_COST = 2_500;
export const REPRO_CHILD_SHARE = 400; // 40 % de ce qui reste après le coût
/**
 * Dotation minimale d'un nouveau-né. En dessous, l'enfant ne peut pas pousser
 * assez de tissu pour se nourrir et meurt sans descendance : se reproduire
 * dans la misère condamnait toute la lignée. Un parent trop pauvre attend
 * donc — c'est une pression sélective en faveur des bien nourris.
 *
 * Suit `GROWTH_COST` : de quoi pousser une dizaine de voxels.
 */
export const MIN_CHILD_ENERGY = 5_000;

/**
 * SÉNESCENCE : l'entretien d'un corps augmente de 1 tous les tant de ticks
 * vécus. Rien ne vit éternellement, mais rien ne meurt non plus à heure fixe.
 *
 * Sans elle, un corps SANS NEURONE devient un blob stérile immortel : incapable
 * de bouger comme de se reproduire (le système nerveux commande l'action), mais
 * sa bouche mange ce qui la touche — posé sur une rive fertile, il reste à son
 * énergie maximale et occupe la place pour toujours. Mesuré : environ 70 % des
 * vivants, et la génération maximale d'un monde stagnait à 1 après 5 850 ticks.
 *
 * Un couperet d'âge fixe a d'abord été essayé : il éteignait les mondes
 * marginaux d'un coup, toute une cohorte disparaissant au même tick. La
 * sénescence progressive s'ajuste d'elle-même — un individu bien nourri vit
 * plus vieux qu'un individu à la peine.
 */
export const SENESCENCE_PERIOD = 300;

// ── Terrain ─────────────────────────────────────────────────────────────────
/** Hauteur du socle rocheux (y < GROUND_Y est de la roche). */
export const GROUND_Y = 4;

/**
 * Part des colonnes du monde qui sont fertiles, en pour mille.
 *
 * C'est le frein qui remplace l'eau. L'eau, en n'accélérant la pousse qu'à son
 * contact, bornait la production primaire par la LONGUEUR DES RIVES et non par
 * la surface du monde. Une fois retirée, la production devenait proportionnelle
 * à toute la surface : mesuré, le monde se remplissait jusqu'au plafond mémoire
 * de 2 047 organismes et l'évolution s'y arrêtait (génération 94 au tick 12 000,
 * puis 97 au tick 20 000 — elle rampe).
 *
 * Le relief existe déjà : les creux qui accueillaient l'eau deviennent les terres
 * basses, seules fertiles ; les hauteurs sont stériles. La nourriture est donc
 * quelque part plutôt que partout, ce qui donne un sens au fait de se déplacer.
 *
 * La limite est RELATIVE au relief de chaque monde, pas une altitude absolue :
 * avec un seuil fixe, un monde tiré haut n'avait aucune terre fertile et
 * mourait, un monde tiré bas était fertile partout. Chaque monde calcule donc sa
 * propre altitude limite pour que cette fraction-là soit fertile, quelle que
 * soit la forme de ses collines.
 */
export const FERTILE_FRACTION = 450;
/**
 * Probabilité (sur 2^16) qu'une surface fasse pousser de la biomasse AU CONTACT
 * D'UNE AUTRE PLANTE. La végétation colonise : elle avance depuis ses colonies.
 *
 * C'est cette dépendance au voisinage qui crée la pression sélective : brouter
 * détruit le stock de graines local, donc le garde-manger s'épuise et il faut
 * suivre le front. Quand la pousse était spontanée, une bouche immobile était
 * nourrie à vie et l'évolution éliminait muscles, yeux et neurones — mesuré :
 * zéro cerveau survivant sur trois graines.
 *
 * Il y avait auparavant DEUX valeurs, selon la proximité de l'eau. L'eau a été
 * retirée du monde, et cette valeur unique a dû être recalibrée par la mesure —
 * en même temps que le frein spatial était rendu au relief (FERTILE_FRACTION).
 *
 * Mesuré sur cinq mondes de 6 000 ticks, corps bornés à 32 voxels :
 *   55  → deux mondes s'éteignent presque (4 et 10 vivants) ;
 *   70  → 46 à 503 vivants, génération 12 à 46, des cerveaux partout ;
 *   110 → 169 à 934, génération jusqu'à 128, mais on approche du plafond ;
 *   400 → trois mondes sur cinq saturent le plafond de 2 047 organismes.
 *
 * La colonisation est un processus exponentiel : au-dessus du point où la pousse
 * dépasse le broutage et la décomposition, la végétation couvre tout ; en
 * dessous, elle s'éteint. Le réglage est donc un seuil, et toute modification
 * exige de remesurer.
 */
export const BIOMASS_SPAWN_CHANCE = 70;
/**
 * Génération spontanée, loin de toute plante. Doit rester très faible — c'est
 * elle qui empêche la stérilité définitive (sans plante, plus aucune plante ne
 * peut naître) sans pour autant renourrir gratuitement les campeurs.
 */
export const BIOMASS_SPAWN_CHANCE_SEED = 1;

/**
 * ENCOMBREMENT : une plante ne pousse pas si elle a déjà autant de voisines.
 *
 * Sans cette borne, la colonisation finit par faire tapis : toute la terre basse
 * se couvre, la nourriture redevient partout, et chercher ne sert plus à rien —
 * exactement le travers que la colonisation devait corriger. Avec elle, la
 * végétation forme des bosquets bordés de vide : il y a des endroits où manger
 * et des endroits où marcher.
 *
 * Sur six voisins possibles, trois est le point où les taches restent des taches.
 */
export const BIOMASS_CROWDING_MAX = 3;


// ── Organismes ──────────────────────────────────────────────────────────────
// Largement au-delà de la cible (quelques centaines) ; dimensionne aussi
// bodyList (MAX_ORGANISMS × MAX_BODY_VOXELS entiers), d'où la modération.
export const MAX_ORGANISMS = 2048;
/** 0 est réservé à « aucun propriétaire » dans le tableau owner. */
export const NO_OWNER = 0;

export const ALIVE = 1;
export const DEAD = 0;

/**
 * TAILLE MAXIMALE D'UNE CRÉATURE, en voxels. Bornes de validation d'un plan de
 * corps, reprises telles quelles par le monde commun au moment de relâcher.
 *
 * 32 et non 512. Trois raisons, dans cet ordre :
 *
 * 1. une créature doit se LIRE. À 512 voxels on ne distingue plus une bouche
 *    d'un neurone à l'écran, et la sélection à la souris devient un jeu
 *    d'adresse ;
 * 2. le descripteur de corps du protocole dérivé est borné par cette valeur :
 *    32 voxels font 137 octets, 512 en feraient 2 057 — pour un objet envoyé à
 *    chaque entrée dans le champ de vision ;
 * 3. `bodyList` réserve MAX_ORGANISMS × MAX_BODY_VOXELS entiers, soit 4 Mo à
 *    512 contre 256 Ko à 32.
 *
 * La borne n'a jamais mordu dans les faits — les corps mesurés font trois à cinq
 * voxels, parce que grandir coûte et retarde la reproduction. Elle protège
 * contre un génome fabriqué à la main, pas contre l'évolution.
 */
export const MAX_BODY_VOXELS = 32;
/** Un corps de 32 voxels n'a pas besoin de plus : la moitié en neurones est déjà extrême. */
export const MAX_NEURON_VOXELS = 16;
