# Devot — Architecture technique

> Document compagnon de [`PLAN.md`](./PLAN.md) (game design).
> Cible : un monde voxel évolutif, 100 % TypeScript, où **le même noyau de
> simulation** tourne dans le laboratoire (navigateur, WebGPU) et dans le monde
> commun (serveur, CPU, autoritaire).

> ⚠️ Décrit le modèle voxel (P5+). L'architecture de la version LLM précédente
> reste disponible au tag `v0.4-devot-llm`.

---

## 1. Le découpage fondateur

```
   CHEZ LE JOUEUR (navigateur)              SUR LE SERVEUR
   Laboratoire privé — WebGPU, x1→x1000     Monde commun — autoritaire, x1
   • évolution sur des milliers de gén.     • organismes de TOUS les joueurs
   • sélection artificielle                 • prédation, reproduction croisée
   • coût : le GPU du joueur                • tourne 24/7 sans spectateur
             │                                        ▲
             └────── génome (quelques Ko) ────────────┘
                     « relâcher dans le monde »
```

Quatre raisons, dans l'ordre d'importance :

**Le coût de simulation est par monde, pas par joueur.** Un monde de quelques
centaines d'organismes coûte la même chose que 1 ou 50 spectateurs s'y
connectent. Si chaque client simulait le monde commun, on ferait 50 fois le même
travail pour un seul résultat. Centraliser est *moins* cher que distribuer.

**Le monde doit vivre sans spectateur.** C'est ce qui sépare un monde d'un
économiseur d'écran. Un navigateur fermé ne simule rien.

**Deux clients qui simulent divergent.** Des GPU différents ne produisent pas
exactement les mêmes flottants ; au bout de quelques milliers de ticks il n'y a
plus un monde commun mais des hallucinations parallèles.

**WebGPU est mature dans le navigateur et fragile dans Node.** Node n'a pas de
WebGPU natif ; il faut passer par des liaisons Dawn tierces. L'évolution lourde
va donc là où le GPU est fiable : chez le joueur.

**Conséquence** : le serveur n'a pas besoin de GPU. Il n'en aura besoin que si le
monde commun sature en CPU — et ce sera alors un port mécanique, parce que le
noyau est écrit en forme de kernel dès le départ.

---

## 2. Stack

| Couche | Choix | Rôle |
| --- | --- | --- |
| **Noyau de simulation** | TypeScript, tableaux typés | `packages/sim-voxel` — partagé labo + monde |
| **Accélération labo** | WebGPU / WGSL | passes portées, état résident sur GPU |
| **Temps réel** | Colyseus | autorité du monde commun, rooms, entités |
| **Frontend 3D** | React + React Three Fiber + drei | rendu voxel par chunks, HUD |
| **Cognition (éveillés)** | Claude Agent SDK (`MIND=claude`) | abonnement, zéro facturation au token |
| **Persistance** | SQLite (`better-sqlite3` + Drizzle) | génomes, lignées, événements, snapshots |
| **Monorepo** | pnpm workspaces | `apps/*` + `packages/*` |

---

## 3. Structure

```
devot/
├─ apps/
│  ├─ client/          # Vite + React + R3F : laboratoire ET vue du monde
│  └─ server/          # Colyseus : monde commun autoritaire
├─ packages/
│  ├─ sim-voxel/       # LE NOYAU — grille, métabolisme, morphogenèse, passes,
│  │                   #   ET le génome + le cerveau (voir §4.5)
│  ├─ shared/          # types réseau, DTO, protocole dérivé
│  ├─ agents/          # esprits Claude des éveillés (P5.5)
│  ├─ db/              # Drizzle + SQLite
│  └─ onchain/         # PaymentProvider (stub gratuit)
```

**`packages/sim-voxel` n'importe rien d'autre.** Ni Colyseus, ni React, ni la
base : c'est la condition pour qu'il tourne à l'identique dans un worker
navigateur et dans le serveur.

---

## 4. Le noyau de simulation

### 4.1 Disposition mémoire (SoA)

Aucun objet par voxel. Des tableaux typés parallèles, indexés à plat :

```ts
// Dimensions : SX=128, SY=32, SZ=128 → 524 288 voxels
// Index : idx = (y * SZ + z) * SX + x   → x contigu (localité de cache)

material : Uint8Array   // type de voxel (voir §4.2)
nutrient : Uint16Array  // richesse nutritive de la biomasse (virgule fixe)
owner    : Uint16Array  // id d'organisme propriétaire du tissu, 0 = aucun
```

Les organismes sont eux aussi en SoA, indexés par id :

```ts
energy    : Int32Array   // énergie courante (virgule fixe, µ-unités)
capacity  : Int32Array   // maximum, croît avec les voxels réserve
voxelCount: Uint16Array
generation: Uint16Array
seedIdx   : Int32Array   // voxel germe : racine de la connexité
state     : Uint8Array   // vivant | mort
```

**Écart assumé par rapport au brief** : l'énergie est stockée en **entiers en
virgule fixe** (`Int32Array`, µ-unités) plutôt qu'en `Float32Array`. Raison : en
JavaScript, un calcul intermédiaire sur un `Float32Array` se fait en float64 puis
est arrondi au stockage, alors qu'en WGSL il se fait en float32 — les deux
divergent, ce qui rendrait le test de conformité CPU↔GPU impossible à tenir.
L'arithmétique entière est exacte et identique des deux côtés, et se prête à
`atomicAdd` sur GPU (donc à des réductions indépendantes de l'ordre). Le brief
demandait la conformité comme condition ; c'est elle qui tranche.

### 4.2 Types de voxels

```
0 VIDE     3 BIOMASSE   6 RÉSERVE   9 NEURONE
1 EAU      4 OS         7 BOUCHE
2 ROCHE    5 MUSCLE     8 ŒIL
```

`material >= 4` ⇔ tissu vivant. Le seuil est un test unique, sans table.

### 4.3 Passes de forme kernel

Une passe = une fonction pure de l'état précédent vers l'état suivant. Pas
d'allocation, pas de fermeture, pas d'objet intermédiaire, indexation à plat.
Les passes cellulaires lisent le tampon A et écrivent le tampon B
(**ping-pong**), parce qu'une lecture de voisinage en place n'est ni
déterministe ni portable sur GPU.

| Passe | Nature | Effet |
| --- | --- | --- |
| `passTerrain` | cellulaire (fusionnée) | eau, pousse et décomposition de la biomasse, alimentation des bouches — **une seule traversée** de la grille |
| `passMetabolism` | réduction par organisme | somme l'entretien voxel par voxel |
| `passBrain` | par organisme | perception, décision, et prélèvement du coût de la pensée |
| `passMetabolism` (suite) | par organisme | l'entretien inclut une **surcharge d'âge** : vieillir coûte |
| `passDeath` | par organisme | énergie ≤ 0 → le corps devient biomasse : la réserve du mort **plus** une part du coût de construction, jamais plus (§4.7) |
| `passConnectivity` | parcours depuis le germe | ampute ce qui est déconnecté → biomasse morte |
| `passGrowth` | par organisme | croissance ou cicatrisation d'un voxel, si l'énergie suit |
| `passMove` | par organisme | translation du corps entier, payée par les muscles |
| `passReproduce` | par organisme | enfant au génome muté, doté d'une part de l'énergie |

L'ordre compte et fait partie du contrat : `passConnectivity` **avant**
`passGrowth`, sinon la cicatrisation réparerait la blessure dans le même tick et
aucun membre ne serait jamais perdu. La passe terrain est fusionnée pour ne
traverser la grille qu'une fois — c'est ce qui tient le tick à 4 ms.

### 4.4 Déterminisme

Non négociable, parce que c'est la condition de l'équivalence labo ↔ monde.

- **Aucun `Math.random()`** dans le noyau. À la place, un **hachage sans état** :
  `hash32(idx, tick, seed)`. Chaque voxel tire son aléa de sa position et du
  tick — pas d'état de générateur partagé, donc parallélisable tel quel sur GPU
  et indépendant de l'ordre de parcours.
- **Arithmétique entière** partout où c'est possible (§4.1).
- **Pas d'itération sur des `Map`/`Set`** dans les passes : l'ordre y est un
  détail d'implémentation.
- Un **hachage d'état** (`worldHash`) permet de comparer deux runs en un nombre.

### 4.5 Génome et cerveau — dans le noyau, pas à côté

Le génome (plan de corps, poids du cerveau, paramètres) et l'évaluation du
cerveau vivent **dans `sim-voxel`**, et non dans un package séparé comme prévu
initialement. Raison : ce sont des **règles de simulation**. Si le laboratoire
et le monde décodaient un génome ou évaluaient un cerveau différemment, la
championne du laboratoire se comporterait autrement dans le monde — exactement
le risque contre lequel tout ce découpage est construit. La validation d'un
génome reçu d'un client est dans le même module, pour que serveur et client
appliquent littéralement le même prédicat.

Le **cerveau** est un petit réseau dont la couche cachée est dimensionnée par
le nombre de voxels neurone. Entrées : énergie relative, gradients de
nourriture et d'organismes dans les quatre directions latérales (nuls si le
corps n'a pas d'œil), contact bouche ↔ biomasse. Sorties : quatre directions de
déplacement, reproduction, attaque. Tout est en **virgule fixe entière** — même
raison que l'énergie (§4.1). Perdre ses neurones rend bête, les faire repousser
rend à nouveau intelligent : la capacité est relue à chaque tick depuis le corps.

**Sans neurone, aucune action.** Un corps sans système nerveux vit encore : il
pousse selon son plan et sa bouche mange ce qui la touche, deux mécaniques du
terrain. Mais il ne se déplace pas, n'attaque pas et ne se reproduit pas. Il y
avait auparavant un « réflexe direct » gratuit qui reliait les entrées aux
sorties sans neurone, et c'était la cause mesurée de l'extinction systématique
des cerveaux : un réflexe linéaire résout parfaitement « aller vers le signal de
nourriture le plus fort », donc la couche cachée n'achetait rien et coûtait son
entretien. Sur trois graines et 3 000 ticks, il ne restait aucun cerveau.

### 4.7 Thermodynamique : l'énergie ne se crée pas

Une seule entrée d'énergie dans le monde : la **photosynthèse**. Les cadavres,
la prédation, l'héritage d'un enfant sont des transferts internes. Le monde tient
un registre, `energyInjected`, qui totalise ce qui est entré depuis l'extérieur
du bilan, et un test exige en permanence :

    Σ énergie des vivants + Σ nutriments du monde  ≤  energyInjected

Cet invariant a une histoire. La formulation précédente — « l'énergie d'un
organisme ne dépasse pas sa dotation plus ce qu'il a mangé » — était vraie et
sans valeur : elle comptait le mangé comme un revenu légitime sans jamais
demander d'où il venait. Or une dépouille rendait **12 000 par voxel** pour un
coût de construction de **1 200** : un amplificateur ×8. Conséquence, invisible
mais totale : l'écosystème vivait de ses propres cadavres. Un monde où **rien ne
poussait** gardait 120 vivants au tick 800. La nourriture était décorative, donc
la chercher ne rapportait rien, donc muscles, yeux et neurones étaient du pur
surcoût — et la sélection les éliminait tous.

Deux règles en découlent, et elles sont liées :

- une dépouille vaut la réserve du mort plus une part du coût de construction de
  son corps, avec `CORPSE_RETURN_PER_VOXEL < GROWTH_COST` ;
- la végétation **colonise** : une plante ne pousse qu'au contact d'une autre
  plante (vite au bord de l'eau, lentement au sec), la génération spontanée
  restant très rare. Brouter détruit donc le stock de graines local : le
  garde-manger s'épuise et il faut suivre le front de végétation.

C'est cette seconde règle qui crée la pression sélective. L'ancien gradient
rive/intérieur n'y suffisait pas : une bouche immobile posée sur une rive était
nourrie à vie.

Une troisième règle en découle, moins évidente : la **sénescence**. Puisqu'un
corps sans neurone est stérile mais vivant, il devenait, bien nourri, un blob
immortel occupant sa place pour toujours — environ 70 % des vivants, et la
génération maximale d'un monde stagnait à 1 après 5 850 ticks. L'entretien
augmente donc de 1 tous les `SENESCENCE_PERIOD` ticks vécus. Un couperet d'âge
fixe a d'abord été essayé : il éteignait les mondes marginaux d'un coup, toute
une cohorte disparaissant au même tick.

Après correction, mesuré sur six mondes de 6 000 ticks : population soutenue de
38 à 309, génération 10 à 26, et **des cerveaux dans chacun** (10 à 120
porteurs). Le banc agrégé donne 5 mondes sur 6 en amélioration de fitness,
médiane +47 %.

Le registre est un **diagnostic** : aucune règle de simulation ne le lit, ce qui
permet au chemin GPU de ne pas le tenir sans changer l'état du monde.

### 4.8 Chunks

Le noyau travaille sur la grille à plat ; le découpage en **chunks 16³**
(8×2×8 = 128 chunks) sert deux usages en aval : la version par chunk pour
n'envoyer que ce qui change, et le remaillage partiel côté client.
Chaque passe qui modifie un voxel incrémente la version de son chunk.

---

## 5. Le laboratoire (P5.2)

Le même `sim-voxel` tourne dans un worker du navigateur. **Le chemin CPU est
obligatoire** : le laboratoire doit rester utilisable si WebGPU est absent ou
échoue. WebGPU est un accélérateur, pas une dépendance.

En mode accéléré, l'état reste résident sur GPU et on ne relit que des
**agrégats** (population, générations, énergie totale, taille moyenne) — jamais
les voxels. C'est ce qui rend le x1000 possible.

**Test de conformité obligatoire** : même graine, même nombre de ticks, l'état
final CPU et GPU doivent coïncider (comparaison par `worldHash`) ou différer d'un
écart explicitement borné et documenté. Sans ce test, le port GPU n'est pas
considéré comme terminé.

---

## 6. Le monde commun (P5.3)

### 6.1 Autorité et continuité

Une `WorldRoom` héberge le monde unique, simulé en CPU via `sim-voxel`. Elle
tourne en continu, avec snapshot périodique en SQLite et reprise au démarrage.
Le client ne calcule jamais l'état : il rend et il envoie des intentions.

### 6.2 Protocole dérivé — le client ne reçoit jamais « le monde »

C'est le point qui décide de la viabilité du réseau. Envoyer les voxels bruts à
20 Hz représenterait des dizaines de mégaoctets par seconde. On envoie donc une
**description dérivée** :

| Donnée | Quand | Comment |
| --- | --- | --- |
| **Terrain** | chunk modifié **et** visible | palette + RLE, message binaire brut, versionné |
| **Corps d'un organisme** | **une seule fois** : entrée dans le champ de vision, ou morphologie changée | masque 3D compact dans sa boîte englobante + palette de types (quelques centaines d'octets) — le client **remaille** localement |
| **Dynamique** | chaque tick réseau | ~10 octets par organisme : position, énergie, phase musculaire |
| **Agrégats** | périodiquement | population, générations, énergie totale (courbes) |

Les entités passent par `@colyseus/schema` ; les chunks par des messages
binaires (`ArrayBuffer`), parce que le schéma synchronisé est inadapté aux
tableaux volumineux. Budget cible : **dizaines de Ko/s**, pas des Mo/s.

Le corps d'un organisme n'a pas besoin d'être transmis en entier : il est
**dérivable de son génome et de son stade de croissance**. C'est de là que vient
le gain.

### 6.3 Relâcher un génome

Le client envoie un génome ; le serveur **valide** : taille de corps maximale,
nombre de neurones maximal, connexité du plan, types légaux, format. Puis il
débite le `PaymentProvider` (stub gratuit aujourd'hui).

**Il n'est pas nécessaire de prouver qu'un génome a réellement été évolué.** Un
joueur peut le fabriquer à la main — dans le monde, sa créature paiera le coût
métabolique de son corps comme les autres. La puissance est bornée par le coût,
pas par l'honnêteté du joueur. C'est ce qui rend le système robuste sans
cryptographie.

### 6.4 Brouillard de guerre côté serveur

Le filtrage de visibilité est appliqué **avant l'envoi** : les entités et les
chunks hors de portée des organismes du joueur ne sont pas transmis. Le
brouillard devient un mécanisme anti-triche réel, et accessoirement le principal
optimiseur de bande passante.

---

## 7. L'éveil (P5.5)

Un organisme éveillé reçoit un esprit Claude via **`MIND=claude`** (Agent SDK sur
l'abonnement Claude Code — **jamais de clé API facturée au token**). Seul le
serveur détient les identifiants : un client ne peut pas piloter un esprit.

L'usage réel de tokens est converti en dépense d'énergie, exactement comme le
métabolisme d'un muscle. Un éveillé pense mieux et vit moins longtemps. Le verbe
divin (140 caractères, une fois par minute) et la foudre s'appliquent à lui.
Peu d'éveillés simultanés : c'est un coût de quota et une latence de plusieurs
secondes. `MIND=mock` reste le mode de développement.

---

## 8. Persistance

```
worlds        (id, seed, tick, created_at)                     -- monde commun
world_chunks  (world_id, chunk_idx, version, blob)             -- snapshot
genomes       (id, god_id, hash, blob, generation, created_at) -- registre
organisms     (id, world_id, genome_id, god_id, born_at, died_at, cause)
lineages      (child_id, parent_a, parent_b)                   -- ascendances
world_events  (id, type, actor_ids_json, payload_json, created_at)
```

L'état chaud (grille, énergies) vit en mémoire ; les snapshots sont périodiques,
pas à chaque tick. SQLite en proto, driver Drizzle échangeable vers Postgres.

---

## 9. Montée en charge

| Aujourd'hui | Demain |
| --- | --- |
| Monde commun en CPU | passes portées en WGSL/Metal côté serveur (mécanique) |
| SQLite mono-nœud | Postgres (swap driver) |
| Un monde unique | sharding spatial, plusieurs régions |
| Client servi par Vite | build statique sur CDN |

---

## 10. Jalons

| Phase | Objectif | Livrable |
| --- | --- | --- |
| **P5.0** | Noyau `sim-voxel` : grille, métabolisme, morphogenèse, mort, déterminisme | run headless déterministe + **benchmark ms/tick** (point de décision) |
| **P5.1** | Génome, cerveau borné par les voxels neurone, sélection naturelle | run de N générations, amélioration mesurable, 2 graines rejouables |
| **P5.2** | Laboratoire navigateur, CPU puis WebGPU | test de conformité CPU↔GPU, UI x1→x1000 |
| **P5.3** | Monde commun autoritaire, protocole dérivé, relâcher | app lancée, deux joueurs, budget réseau mesuré |
| **P5.4** | Vie sociale entre lignées, pouvoirs divins | prédation et reproduction croisée observables |
| **P5.5** | Éveil (Claude) | un éveillé pense, ses tokens coûtent de l'énergie |

---

## 11. Récap des choix

TypeScript de bout en bout · **un seul noyau de simulation** partagé labo/monde ·
déterminisme strict par hachage sans état et virgule fixe · disposition SoA en
forme de kernel · autorité serveur pour le monde commun · protocole dérivé
(jamais de voxels bruts sur le réseau) · évolution chez le joueur, monde chez le
serveur · `MIND=claude` sans facturation au token · SQLite en proto.
