# Devot — Architecture technique

> Document technique compagnon de [`PLAN.md`](./PLAN.md) (game design).
> Cible : un prototype **jouable en hackathon, mono-nœud**, avec un chemin de montée
> en charge documenté. 100 % TypeScript.

---

## 1. Stack retenue

| Couche | Choix | Rôle |
| --- | --- | --- |
| **Frontend 3D** | React + **React Three Fiber** + drei | Rendu du monde, HUD dieu, bulles de pensée |
| **Temps réel** | **Colyseus** (client + serveur) | Autorité du monde, rooms, synchro d'état delta |
| **Backend** | **Node.js + TypeScript** | Serveur autoritaire, boucle de simulation, orchestration |
| **Cognition** | `@anthropic-ai/sdk` (Messages API) | Esprit des devots, historique auto-géré, sortie structurée |
| **Persistance** | **SQLite** (`better-sqlite3` + Drizzle) | Lignées, contextes, événements — migrable Postgres |
| **Monorepo** | pnpm workspaces | `apps/*` + `packages/*`, types partagés |

**Principe directeur : autorité serveur stricte.** Le client ne fait que *rendre* et
*envoyer des intentions*. Toute règle (dégâts HP, cooldown 140c, combats, morts,
paiements) est calculée et validée côté serveur.

---

## 2. Vue d'ensemble

```
┌──────────────────────────── Client (navigateur) ─────────────────────────────┐
│  React + React Three Fiber + drei                                             │
│  • Rendu 3D du monde (devots, nourriture, effets)                             │
│  • HUD dieu : jauge vie/crédits, champ 140c (cooldown 60 s), sélection        │
│  • colyseus.js : reçoit l'état (delta), interpole, envoie les actions         │
└──────────────▲──────────────────────────────────────────────┬────────────────┘
   state sync  │ (WS, delta @ patchRate)         god actions   │ (WS)
               │                                                ▼
┌──────────────┴───────────────────── Serveur Node/TS (autorité) ───────────────┐
│  Colyseus · WorldRoom                                                         │
│   • @colyseus/schema : état autoritaire (devots, food, gods)                  │
│   • simulation tick 250 ms  →  Couche réactive (déterministe, 0 token)        │
│   • valide les actions du dieu (cooldown 60 s, ownership, ≤140c)              │
│                                                                               │
│  Orchestrateur cognitif (asynchrone, découplé du tick)                        │
│   • File d'inférences priorisée + limiteur débit / budget tokens              │
│   • system prompt (règles+persona, caché) + historique + événement            │
│   • Messages API → sortie structurée (action) + usage                         │
│   • Palier de modèles Haiku/Sonnet/Opus · usage → dégâts HP                   │
│                                                                               │
│  Persistance (SQLite/Drizzle)            Onchain (interface, différé)         │
│   gods · devots · messages · events       PaymentProvider (stub gratuit)      │
│   · food · divine_msgs                     (stub gratuit aujourd'hui)          │
└──────────────┬───────────────────────────────────────────────┬───────────────┘
       ┌───────▼────────┐                              ┌─────────▼──────────┐
       │ SQLite (proto) │                              │   API Claude Agent SDK      │
       │  → Postgres    │                              │ Haiku/Sonnet/Opus  │
       └────────────────┘                              └────────────────────┘
```

---

## 3. Structure du monorepo

```
devot/
├─ apps/
│  ├─ client/          # Vite + React + R3F + colyseus.js
│  └─ server/          # Node + Colyseus (WorldRoom) + orchestrateur
├─ packages/
│  ├─ shared/          # types, DTO d'actions, constantes, schémas Colyseus
│  ├─ sim/             # couche réactive : systèmes déterministes (ECS-lite)
│  ├─ agents/          # orchestrateur LLM, prompts, palier de modèles, coût→HP
│  ├─ db/              # schéma Drizzle + accès SQLite (repositories)
│  └─ onchain/         # PaymentProvider (stub gratuit ; payant plus tard)
├─ pnpm-workspace.yaml
└─ turbo.json          # (optionnel) pipeline build/dev
```

- **`packages/shared`** est la source de vérité des types (état, actions, événements),
  importée par le client **et** le serveur → pas de dérive de contrat.
- **`packages/sim`** et **`packages/agents`** sont consommés par `apps/server`.
  Séparés en packages pour pouvoir, plus tard, sortir l'orchestrateur dans son propre
  service (voir §12, montée en charge).

---

## 4. Temps réel & autorité du monde (Colyseus)

### 4.1 Room & état

Une **`WorldRoom`** unique héberge le monde partagé (tous les dieux, tous les devots).
L'état est décrit avec `@colyseus/schema` (synchro binaire delta automatique) :

```ts
class DevotState extends Schema {
  @type("string") id: string;
  @type("string") godId: string;
  @type("number") x = 0; @type("number") y = 0; @type("number") z = 0;
  @type("number") hp = 0;        // crédits d'inférence restants
  @type("number") hpMax = 0;
  @type("string") state = "vivant";      // vivant | affamé | agonisant | mort
  @type("string") modelTier = "frugal";  // frugal | equilibre | prophete
  @type("boolean") thinking = false;      // une inférence est en cours
  @type("string") utterance = "";         // dernière parole (bulle)
}

class WorldState extends Schema {
  @type({ map: DevotState }) devots = new MapSchema<DevotState>();
  @type({ map: FoodState })  food   = new MapSchema<FoodState>();
  @type({ map: GodState })   gods   = new MapSchema<GodState>();
}
```

- **`patchRate`** (réseau) ≈ 50 ms (20 Hz) pour un rendu fluide.
- **`setSimulationInterval(dt)`** (logique) = **250 ms** = la cadence d'action des devots.
- Le client interpole les positions entre deux patches (drei/leva).

### 4.2 Actions du dieu (client → serveur)

Le client n'émet que des **intentions**, validées côté serveur :

| Message | Payload | Validation serveur |
| --- | --- | --- |
| `createFounder` | `{}` | le dieu n'a **aucun** devot vivant ; débit `PaymentProvider` |
| `speak` | `{ devotId, text }` | ownership · `text.length ≤ 140` · `now - god.lastSpeakAt ≥ 60 s` |
| `feed` | `{ devotId?, x, z }` | débit `PaymentProvider` · fait apparaître de la nourriture « don » |
| `select` | `{ devotId }` | lecture seule (caméra/HUD) |

Le cooldown 140c est **autoritaire** : `god.lastSpeakAt` vit dans l'état serveur, jamais
dans le client (qui ne fait qu'afficher le minuteur).

---

## 5. Cadence & découplage : le corps (250 ms) vs l'esprit (async)

Le paradoxe à résoudre : **le devot agit toutes les 250 ms**, mais **une inférence LLM
prend des secondes**. Solution → deux boucles découplées :

```
   Corps (déterministe, chaque 250 ms)        Esprit (LLM, asynchrone, coûteux)
   ───────────────────────────────────        ─────────────────────────────────
   • se déplacer vers un but                   déclenché par un TRIGGER :
   • percevoir nourriture / devots      ──────►  • message divin reçu
   • manger au contact                          • rencontre significative
   • fuir / avancer                             • HP bas (survie)
   • résoudre les combats en cours              • opportunité de reproduction
   • détecter les déclencheurs ───────┘         • provocation / parole reçue
        (0 token — gratuit)                    → produit une DÉCISION (nouveau but,
                                                 parole, attaque, reproduction)
                                                 → applique HP-, ~secondes plus tard
```

- Le **corps** (couche réactive) tourne à chaque tick, **sans coûter de tokens** :
  il fait vivre le devot (mouvement, faim, contact nourriture) en continu.
- L'**esprit** (LLM) n'est sollicité que sur **déclencheur**, en tâche de fond. Pendant
  qu'il « pense » (`thinking = true`, bulle « … »), le corps continue de bouger.
- Quand la décision revient, on l'applique : nouveau but, parole, attaque, enfant — et
  on **déduit les HP** correspondant aux tokens réellement consommés.

C'est aussi ce qui protège le budget : **la majorité des ticks ne coûtent rien**.

---

## 6. Couche réactive (`packages/sim`)

Un **ECS-lite** : l'état des devots (dans la room) + des *systèmes* déterministes
exécutés à chaque tick. Aucun appel LLM ici.

| Système | Rôle | Émet un déclencheur ? |
| --- | --- | --- |
| `PerceptionSystem` | Voisinage (nourriture, devots, menaces) | oui (rencontre, menace) |
| `MovementSystem` | Avance vers `currentGoal` | non |
| `FeedingSystem` | Mange au contact → `hp += food.hpValue` | non |
| `HungerSystem` | Passe en `affamé`/`agonisant` selon HP | oui (HP bas) |
| `CombatSystem` | Résout une attaque en cours → transfert de HP | non |
| `ReproductionSystem` | Concrétise une décision de reproduction | non |
| `DeathSystem` | `hp ≤ 0` → mort + **suppression du contexte** | oui (événement monde) |

Les déclencheurs alimentent la file de l'orchestrateur cognitif (§7). Un but par défaut
(errance, ou « chercher la nourriture la plus proche » si affamé) garantit qu'un devot
**sans esprit disponible reste vivant et crédible** en attendant sa prochaine pensée.

---

## 7. Cognition des devots (`packages/agents`)

### 7.1 Un esprit = notre historique + un appel Claude

Chaque devot possède un **historique de messages** stocké **dans notre base** (table
`messages`). « Penser » = appeler la Messages API avec :

1. un **system prompt** = `RÈGLES_DU_MONDE` (partagées, **mises en cache**) + la
   **persona** propre du devot (tempérament, valeurs, conscience de la mort) ;
2. l'**historique** du devot (pensées et événements passés, éventuellement résumés) ;
3. l'**événement courant** en dernier tour utilisateur.

La réponse est **structurée** (schéma d'action) pour être appliquée de façon fiable, et
l'`usage` renvoyé donne le coût réel → dégâts de HP.

```ts
const DECISION_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string",
      enum: ["idle","move","eat","attack","reproduce","speak","flee"] },
    targetId:  { type: "string" },              // devot ou nourriture visé
    direction: { type: "object", properties: { x:{type:"number"}, z:{type:"number"} },
                 required:["x","z"], additionalProperties:false },
    utterance: { type: "string" },              // ≤ N caractères si action="speak"
    emotion:   { type: "string" },
  },
};

const res = await claude.messages.create({
  model: profile.model,                         // haiku / sonnet / opus selon le devot
  max_tokens: 512,
  ...profile.thinking,                          // adaptive + effort, ou rien (Haiku)
  system: buildSystem(devot),                   // règles cachées + persona
  messages: [...history, { role: "user", content: eventBlock }],
  output_config: { format: { type: "json_schema", schema: DECISION_SCHEMA } },
});

const decision = JSON.parse(textOf(res));
const hpLoss = hpCost(res.usage, profile.model); // cf. §7.4
```

> La sortie structurée est compatible avec la pensée adaptative : le devot peut
> *réfléchir* (thinking) **et** renvoyer une action propre à parser.

### 7.2 Palier de modèles = tempérament × endurance

| Profil | Modèle | Pensée | Effort | Emploi |
| --- | --- | --- | --- | --- |
| **Frugal** | `claude-haiku-4-5` | omise | — *(effort non supporté sur Haiku 4.5)* | la masse des devots |
| **Équilibré** | `claude-sonnet-4-6` | `adaptive` | `low`/`medium` | devots établis |
| **Prophète** | `claude-opus-4-8` | `adaptive` | `medium`/`high` | rares élus/anciens |

> Cohérent avec le thème : la **pensée adaptative** génère des tokens (facturés comme
> de la sortie), donc **un prophète qui réfléchit fort saigne plus vite**. L'`effort`
> est le curseur intelligence ⇄ longévité.

### 7.3 Prompt caching & vieillissement

- **Cache du prompt** : `RÈGLES_DU_MONDE` est un **préfixe identique pour tous les
  devots** → placé en tête du system avec `cache_control: { type: "ephemeral" }`, il se
  lit ensuite à ~0,1× (cache partagé entre devots). La persona (variable) vient après.
  *Note honnête :* le cache ne se déclenche qu'au-delà d'un préfixe minimal (~4096 tokens
  sur Haiku/Opus, ~2048 sur Sonnet) — dimensionner les règles en conséquence, sinon
  accepter l'absence de cache en proto.
- **Vieillir, c'est oublier** : quand l'historique d'un devot dépasse un seuil de tokens,
  un **« chroniqueur »** (appel Haiku bon marché) le **résume** et remplace les vieux
  tours par un souvenir condensé → coût d'entrée maîtrisé à chaque pensée future.
  *(Alternative : compaction serveur Anthropic, bêta `compact-2026-01-12`.)*

### 7.4 Coût → HP (le cœur de l'économie)

```ts
// Prix par 1M tokens (in / out)
const PRICE = {
  "claude-haiku-4-5":  { in: 1,  out: 5  },
  "claude-sonnet-4-6": { in: 3,  out: 15 },
  "claude-opus-4-8":   { in: 5,  out: 25 },
};

function hpCost(usage, model) {
  const p = PRICE[model];
  const usd = (usage.input_tokens/1e6)*p.in + (usage.output_tokens/1e6)*p.out;
  return usd * LETHALITY;   // HP exprimés en « micro-dollars de pensée »
}
```

On exprime les HP en **µ$ d'inférence** : `hp_max` est un budget (ex. 50 000 = 0,05 $ de
pensée), la nourriture le recharge, chaque pensée le grignote selon son coût réel. Le
`thinking` étant facturé en sortie, il est **compté dedans**.

### 7.5 Sécurité prompt-injection

Le **message divin (140c)** et les **paroles d'autres devots** sont du **contenu non
fiable** : injectés dans le **tour utilisateur** (jamais dans le system), encadrés
explicitement (« Une voix venue du ciel te dit : “…” »). Les règles du monde et
l'inviolabilité de la mécanique restent dans le system prompt figé.

---

## 8. Orchestrateur & garde-fous budget (`packages/agents`)

L'esprit tourne dans une **file d'inférences** découplée du tick réseau :

- **Concurrence bornée** : au plus *N* inférences simultanées (limiteur type `p-limit`),
  aligné sur les limites de débit de l'API.
- **Une seule pensée en vol par devot** : on ne relance pas un devot déjà `thinking`.
- **Priorisation** : message divin > combat/menace > survie (HP bas) > rencontre >
  réflexion oisive ; à priorité égale, les devots **proches d'un dieu connecté** passent
  d'abord (ce qu'on voit compte plus).
- **Budget** : (a) pré-check `devot.hp > COÛT_PLANCHER` avant d'appeler ; (b) **token
  bucket global** (tokens/minute) pour plafonner la dépense serveur ; (c) sous pression,
  les devots non prioritaires **s'endorment** (le corps continue, l'esprit patiente).

Un devot **ne peut jamais dépenser plus que sa vie** : c'est la double vertu du modèle
« coût réel » (narrativement juste **et** budget-safe).

---

## 9. Persistance (`packages/db`, SQLite → Postgres)

`better-sqlite3` (synchrone, rapide, parfait pour un serveur de jeu mono-nœud) + **Drizzle**
(schéma typé, migrations, driver échangeable vers Postgres).

```
gods         (id, name, founder_devot_id, color, last_speak_at, created_at)
devots       (id, god_id, is_founder, hp, hp_max, model_tier, cognition_profile,
              x, y, z, state, current_goal, last_action_at, age,
              traits_json, parent_a, parent_b, born_at, died_at)
messages     (id, devot_id → CASCADE, role, content_json,
              tokens_in, tokens_out, created_at)   -- l'historique LLM du devot
world_events (id, type, actor_ids_json, payload_json, created_at)  -- mémoire du monde
food         (id, x, y, z, type, hp_value, source, spawned_at, consumed_by)
divine_msgs  (id, god_id, devot_id, text, sent_at)
```

- **Mort = destruction du contexte** : `DELETE FROM messages WHERE devot_id = …`
  (CASCADE). On conserve une **pierre tombale** (`devots.died_at`, `world_events`) — ce
  que « les autres se souviennent » du mort, sans son esprit.
- **État chaud** (positions, HP) : vit dans la room Colyseus en mémoire ; persistance
  périodique / sur événement en SQLite (snapshot), pas à chaque tick.

---

## 10. Onchain (`packages/onchain`, différé — non détaillé)

Le volet blockchain est **repoussé** : on **ne tranche ni la chaîne ni les détails**
pour l'instant. On se contente d'**isoler** le point d'accroche derrière une interface,
pour que le passage au payant plus tard **ne touche pas le reste du jeu** :

```ts
interface PaymentProvider {
  chargeDevotCreation(godId: string): Promise<Receipt>;   // création / recréation
  chargeFeed(godId: string): Promise<Receipt>;            // don de nourriture
}
```

- **Aujourd'hui** : `FreeStubProvider` — tout passe, aucun coût. C'est le seul provider
  implémenté ; on développe toute la boucle de jeu sans friction.
- **Plus tard** : un autre provider implémentera cette interface. **Chaîne, nature du
  paiement et identité seront définis en temps voulu — hors de ce document.**

---

## 11. Flux de bout en bout — « le dieu parle »

```
1. Client  ── room.send("speak", { devotId, text }) ──►  (et grise l'input 60 s)
2. Serveur : ownership ? text ≤140 ? now - god.lastSpeakAt ≥ 60 s ?  → sinon rejet
3. Serveur : lastSpeakAt = now ; persiste divine_msg ; émet TRIGGER{divine_message, HIGH}
4. Orchestrateur : construit la requête (historique + « Une voix du ciel te dit… »)
                   → appel Claude (profil du devot) → décision + usage
5. Serveur : hp -= hpCost(usage) ; applique l'action (utterance / nouveau but / …)
             ; append à l'historique ; persiste
6. WorldRoom : patch d'état → tous les clients
7. Client  : bulle de parole au-dessus du devot + jauge HP mise à jour
```

---

## 12. Montée en charge (chemin documenté, hors proto)

| Aujourd'hui (proto) | Demain (scale) |
| --- | --- |
| SQLite mono-nœud | Postgres (swap driver Drizzle) |
| État room en mémoire | Redis + `@colyseus/redis-driver` (rooms multi-process) |
| Orchestrateur in-process | Service worker dédié + file réelle (BullMQ/Redis) |
| 1 `WorldRoom` | Sharding spatial (plusieurs rooms/régions) + presence |
| Client servi par Vite | Build statique sur CDN |

Le découpage en `packages/*` (sim / agents / db / onchain) rend ces extractions
mécaniques : on sort `agents` en service sans toucher au reste.

---

## 13. Jalons de construction (hackathon)

| Phase | Objectif | Livrable |
| --- | --- | --- |
| **P0 — Cœur mortel** | 1 devot headless, tick 250 ms, **une inférence structurée**, jauge HP qui descend selon `usage`, mort + suppression du contexte | prouve la mécanique centrale, sans 3D |
| **P1 — Monde & 3D** | Colyseus `WorldRoom` + R3F, nourriture aléatoire, le devot cherche/mange, HUD dieu (parler 140c/60 s, nourrir) | premier jeu jouable |
| **P2 — Vie sociale** | Reproduction (fondateur → lignée), héritage de contexte (chroniqueur), combat/prédation | émergence |
| **P3 — Multi-dieux** | Plusieurs dieux, PvP inter-lignées, recréation du fondateur | monde partagé |
---

## 14. Récap des choix & hypothèses ouvertes

**Choix actés :** TypeScript de bout en bout · Colyseus (autorité + sync) · Messages API
auto-gérée + prompt caching + palier de modèles + couche réactive 250 ms · SQLite (proto).