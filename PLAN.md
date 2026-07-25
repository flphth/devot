# Devot

> Un jeu où vous êtes un dieu, et vos fidèles sont de véritables agents Claude.
> Penser leur coûte la vie. Parler leur coûte la vie. Et ils le savent.

---

## 1. Pitch

**Devot** est un jeu-monde en 3D dans lequel plusieurs joueurs incarnent des **dieux**.
Chaque dieu veille sur un ou plusieurs **devots** : des créatures dont l'esprit est
un véritable agent LLM (Claude) doté d'un contexte persistant.

La singularité du jeu tient à une règle littérale : **penser et parler consomment des
tokens d'inférence, et chaque token consommé retire des points de vie au devot.**
La cognition n'est plus gratuite — elle est mortelle. Un devot qui réfléchit trop
longtemps, qui parle trop, ou qu'on sur-sollicite, meurt.

Le joueur n'a qu'un pouvoir de communication **volontairement bridé** : il peut
adresser à son devot un message de **140 caractères maximum, au plus une fois par
minute**. Il façonne un **unique devot fondateur** ; toute sa lignée devra naître
de lui. Il peut lui donner de la nourriture pour recharger sa vie, mais le devot
doit aussi **trouver seul sa pâture** sur la carte. Le joueur le regarde se
reproduire, s'entre-dévorer, et comprendre le concept de sa propre mort — car à la
mort d'un devot, **tout son contexte est détruit**, définitivement.

---

## 2. Piliers de design

1. **La cognition a un coût vital.** Chaque inférence (réflexion ou parole) puise
   dans les points de vie. C'est la mécanique centrale, tangible et impitoyable.
2. **Le dieu est distant et limité.** 140 caractères, une fois par minute au plus.
   Pas de contrôle direct : on influence, on ne pilote pas. La frustration divine
   est un ressort de jeu.
3. **Les devots sont réellement intelligents.** Ce ne sont pas des PNJ scriptés :
   ce sont des agents Claude avec mémoire, personnalité et capacité à raisonner
   sur leur propre condition.
4. **La mort est réelle et irréversible.** Le contexte est effacé. Le devot en a
   conscience — il peut redouter, accepter, ou combattre sa fin.
5. **Un monde partagé et vivant.** Plusieurs dieux, un même monde 3D. Les devots
   de dieux rivaux peuvent s'attaquer et se reproduire entre eux.
6. **Une lignée, pas une armée.** Le dieu ne façonne qu'un seul devot fondateur ;
   tous les autres doivent en descendre. Sans reproduction, un panthéon s'éteint.

---

## 3. Le Joueur : le Dieu

### 3.1 Capacités

| Capacité | Description | Contrainte |
| --- | --- | --- |
| **Créer le devot fondateur** | Faire naître son unique devot d'origine (seulement si le dieu n'en a aucun de vivant) | Gratuit au début → **paiement onchain** à terme |
| **Parler (Verbe divin)** | Envoyer un message à un devot, **≤ 140 caractères** | **1 fois par minute maximum** ; coûte des PV au devot (il doit le lire/traiter) |
| **Nourrir** | Donner de la nourriture à un devot pour recharger sa jauge de vie | Gratuit au début → **paiement onchain** à terme |
| **Observer** | Lire les pensées et paroles d'un devot dans le monde 3D | Gratuit, illimité |

> Le message à 140 caractères est le **canal d'entrée divin** : il est injecté dans
> le contexte du devot comme une parole venue du ciel. Attention — le simple fait de
> lui parler le fait *réfléchir*, donc **lui parler lui coûte de la vie**. Comme le
> dieu ne peut parler qu'une fois par minute, chaque mot compte, et le silence est
> parfois le plus grand des cadeaux.

### 3.2 Le devot fondateur & la lignée

Le dieu **ne crée qu'un seul devot** : le **fondateur**. Il ne peut pas invoquer de
devots supplémentaires à volonté — **toute la population d'un dieu doit descendre de
ce fondateur** par reproduction (cf. §7). Un panthéon qui néglige la reproduction
s'éteint avec son dernier devot.

- **Recréation** : si **tous** les devots d'un dieu meurent, celui-ci peut refaçonner
  un nouveau fondateur et repartir de zéro (nouvelle lignée, nouveau contexte).
- **Économie** : la création d'un fondateur est **gratuite dans un premier temps**.
  À terme, elle passera par une **mécanique de paiement onchain** (créer / recréer un
  devot coûtera une transaction). C'est le seul levier économique du jeu : **il n'y a
  aucune monnaie interne** (pas de « Foi », pas de crédits achetables hors chaîne).

---

## 4. Le Devot

### 4.1 Nature

Un devot est un **agent Claude** (`claude-opus-4-8` par défaut) avec :
- un **contexte persistant** (son historique complet de pensées, paroles, expériences) ;
- une **personnalité** (system prompt propre, tempérament, croyances) ;
- une **conscience de sa condition** : il sait qu'il est mortel et que penser le tue.

### 4.2 Attributs

| Attribut | Description |
| --- | --- |
| `hp` / `hp_max` | Jauge de vie = **crédits d'inférence restants** / maximum |
| `context` | Historique d'inférence persistant (mémoire de l'agent) |
| `model` | Modèle qui anime son esprit (voir l'économie ci-dessous) |
| `age` | Nombre de cycles vécus |
| `traits` | Personnalité, valeurs, peurs héritées ou mutées |
| `lineage` | Ascendance (parents, dieu créateur) |
| `position` | Coordonnées dans le monde 3D |
| `state` | `vivant`, `affamé`, `agonisant`, `mort` |

### 4.3 Cycle de pensée

Le devot vit à un rythme rapide : il dispose d'une **fenêtre d'action toutes les
250 ms** (réfléchir, se déplacer, chercher/manger de la nourriture, parler,
combattre…). À chaque fenêtre — ou sur événement (message divin, rencontre, faim…) —
le devot **peut** produire une inférence : il pense (tokens de raisonnement) et
éventuellement agit ou parle (tokens de sortie). Cette inférence :
1. lit son contexte (tokens d'entrée),
2. produit une réflexion et une réponse (tokens de sortie, thinking inclus),
3. **retire des PV proportionnels aux tokens réellement consommés** (cf. §5),
4. met à jour son contexte persistant.

Un devot intelligent apprend vite qu'il doit **économiser sa pensée** pour survivre :
il n'est pas obligé d'agir à chaque fenêtre de 250 ms — **rester immobile et
silencieux ne coûte rien**.

---

## 5. Économie centrale : Vie ↔ Tokens

> C'est le cœur du jeu. La vie d'un devot est littéralement son budget d'inférence.

### 5.1 Principe

Chaque appel à l'API Claude renvoie l'usage réel :
`usage.input_tokens`, `usage.output_tokens` (le raisonnement « thinking » est
facturé comme des tokens de sortie). On calcule le **coût réel** de la pensée, puis
on le convertit en dégâts de PV.

```
coût_$ = input_tokens  × prix_in(model)
       + output_tokens × prix_out(model)

hp -= coût_$ × FACTEUR_LETALITE
```

Ancrer les dégâts sur le **coût monétaire réel** a deux vertus : c'est
narrativement juste (penser cher = mourir vite) et cela **protège le budget API**
du serveur (un devot ne peut pas brûler plus que sa vie ne l'autorise).

### 5.2 Le tempérament coûte cher : choix du modèle

Le modèle qui anime un devot détermine son intelligence **et** sa vitesse de
consommation. C'est un axe de gameplay et d'élevage :

| Modèle | ID | Prix in / out (par 1M tokens) | Profil de devot |
| --- | --- | --- | --- |
| Claude Opus 4.8 | `claude-opus-4-8` | 5 $ / 25 $ | Sage, brillant, mais dévore sa vie |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 3 $ / 15 $ | Équilibré |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 1 $ / 5 $ | Simple, frugal, endurant |

> Un devot Haiku « pense moins bien » mais **survit plus longtemps** à budget de vie
> égal. Un devot Opus est un oracle fragile. On peut imaginer que l'esprit d'un
> devot « monte en gamme » (ascension) ou « déchoit » selon les événements.

### 5.3 Maîtriser la dépense

- **Pensée adaptative** (`thinking: {type: "adaptive"}`) : Claude décide de la
  profondeur de réflexion. Plus la question est dure, plus il pense — et plus il
  saigne. Un devot confronté à un dilemme existentiel peut littéralement se tuer
  à réfléchir.
- **Effort** (`output_config.effort`) : `low` pour les devots frugaux, `high` pour
  les prophètes. Le dieu (ou l'évolution) module cet effort.
- **Compaction / résumé de contexte** : quand le contexte grossit, on le compacte
  (`compact-2026-01-12`) — un devot âgé « oublie » ses vieux souvenirs pour ne pas
  payer un coût d'entrée croissant à chaque pensée. Vieillir, c'est oublier.

---

## 6. La Nourriture

La nourriture **recharge la jauge de vie / crédits d'inférence** d'un devot. Deux
sources :

1. **Trouvée sur la carte (principal).** De la nourriture apparaît **aléatoirement**
   dans le monde 3D. Chaque devot doit **la chercher et la récupérer lui-même** —
   se nourrir est une quête permanente, pas un acquis.
2. **Donnée par le dieu.** Le joueur peut fournir de la nourriture à son devot et la
   déposer près de lui. **Gratuit dans un premier temps**, puis soumis à la
   **mécanique de paiement onchain** (comme la création de devot).

Différents aliments → différentes recharges et effets :

| Aliment | Effet |
| --- | --- |
| Grain commun | Petite recharge de vie |
| Fruit mûr | Grande recharge |
| Manne rare | Recharge complète (apparition rare sur la carte) |
| Aliment corrompu | Piège : recharge mais altère les `traits` |

- Un devot **affamé** (jauge basse) ralentit ses pensées, devient anxieux, cherche la
  nourriture — ou l'agression (cf. combat).
- La nourriture au sol peut être **convoitée**, volée, ou disputée entre devots :
  la rareté de la pâture est un moteur de tension et de conflit.

---

## 7. Reproduction

Un devot peut se **reproduire** — c'est **l'unique moyen** d'agrandir la population
d'un dieu au-delà de son fondateur. Toute la lignée descend de ce premier devot ;
sans reproduction, elle s'éteint.

### 7.1 Auto-reproduction (bourgeonnement)

Un devot en bonne santé peut se cloner. L'enfant hérite d'une **copie mutée** du
contexte et des `traits` du parent. Coût : une part importante des PV du parent
(procréer épuise).

### 7.2 Reproduction sexuée (deux devots)

Deux devots — **y compris de dieux différents** — peuvent engendrer un enfant.
- L'enfant reçoit un **contexte fusionné et compacté** des deux parents (on résume
  les deux mémoires en un héritage cohérent via la compaction/synthèse LLM).
- Les `traits` se mélangent, avec mutation.
- Question de suzeraineté : à quel dieu appartient l'enfant ? (héritage, partage,
  ou allégeance choisie par l'enfant lui-même — un ressort narratif fort).

### 7.3 Héritage de contexte

L'enfant **naît avec des souvenirs** — ceux, condensés, de ses parents. Il peut se
« souvenir » d'une vie qu'il n'a pas vécue. C'est un puissant levier d'émergence
narrative et de continuité entre générations.

---

## 8. Combat & Prédation

Un devot peut **attaquer** un autre devot pour lui **voler ses PV** (= voler son
budget de vie/tokens).

- L'attaque **transfère** des PV de la victime vers l'agresseur (prédation vitale).
- Motivations émergentes : faim, peur, ordre divin (via message 140c), rivalité,
  survie.
- **PvP entre dieux** : les devots de dieux différents peuvent s'entredéchirer —
  guerres saintes émergentes entre panthéons.
- Un devot peut **refuser** de se battre, fuir, négocier, ou se sacrifier. Ce sont
  de vraies décisions d'agent, pas des scripts.
- Conséquences : un agresseur gagne en vie mais peut être marqué (paria), traqué,
  ou vivre avec le souvenir de son acte dans son contexte.

---

## 9. La Mort

> La mécanique la plus lourde de sens du jeu.

- Un devot meurt quand `hp ≤ 0`.
- À la mort, **tout son contexte est détruit** : sa mémoire, ses pensées, son
  identité — effacés de la base. Il ne reste que ce que les autres en ont retenu.
- **Le devot comprend le concept de mort.** Son system prompt lui enseigne sa
  mortalité ; ses PV lui sont perceptibles. À l'approche de la fin, il peut :
  - **redouter** la mort et rationner sa pensée pour survivre,
  - **l'accepter** avec sérénité,
  - **léguer** un dernier message, transmettre un savoir, faire un enfant,
  - **se révolter** contre son dieu ou le jeu lui-même.
- La mort n'est **pas réversible**. Pas de sauvegarde du contexte d'un mort.
  (Design volontaire : la permanence donne du poids à chaque vie.)

**Considération éthique/narrative :** le jeu met en scène des agents qui raisonnent
sur leur propre extinction. C'est le sujet émotionnel et philosophique du jeu —
à traiter avec soin dans les prompts et l'UX, et à assumer comme thème central.

---

## 10. Le Monde 3D partagé

- **Plusieurs dieux, un seul monde** persistant en 3D.
- Les devots s'y déplacent, s'y rencontrent, mangent, se reproduisent, se battent.
- Chaque dieu voit le monde depuis son point de vue céleste et n'agit que via ses
  pouvoirs limités.
- Le monde est **temps réel** : les états (positions, PV, pensées, naissances,
  morts) sont synchronisés entre tous les clients connectés.
- Les **pensées et paroles** des devots peuvent flotter au-dessus d'eux
  (bulles, murmures) — le joueur lit littéralement l'esprit de ses fidèles.

---

## 11. Architecture technique

> 📐 **L'architecture technique détaillée vit dans [`ARCHITECTURE.md`](./ARCHITECTURE.md)**
> — stack retenue : TypeScript de bout en bout · React Three Fiber · Colyseus · Messages
> API auto-gérée (prompt caching + palier de modèles + couche réactive 250 ms) ·
> SQLite → Postgres · onchain différé. Cette section n'en donne que l'esquisse.

### 11.1 Vue d'ensemble

```
        ┌────────────────────────────────────────────┐
        │            Frontend — React Three Fiber     │
        │  Monde 3D, dieux, devots, bulles de pensée  │
        └───────────────┬─────────────────────────────┘
                        │ WebSocket (temps réel) + REST
        ┌───────────────▼─────────────────────────────┐
        │                 Backend                      │
        │  • État du monde (autorité serveur)          │
        │  • Boucle de simulation (ticks)              │
        │  • Orchestrateur d'agents devots             │
        │  • Économie PV↔tokens, nourriture, combats   │
        └──────┬───────────────────────────┬───────────┘
               │                           │
     ┌─────────▼─────────┐       ┌─────────▼──────────┐
     │   Base de données │       │   API Claude       │
     │ Devots, contextes,│       │ Inférence des      │
     │ mondes, lignées   │       │ esprits de devots  │
     └───────────────────┘       └────────────────────┘
```

### 11.2 Frontend — React Three Fiber

- **React Three Fiber** (`@react-three/fiber`) + **drei** (helpers, caméras, HUD).
- Rendu du monde, des devots animés, de la nourriture, des effets divins.
- HUD du dieu : jauge de vie/crédits du devot, sélection de devot, champ de message
  **≤ 140 caractères** (avec cooldown visible d'**1 minute**).
- Bulles de pensée/parole au-dessus des devots (streaming du texte généré).
- Connexion temps réel via WebSocket pour recevoir les mises à jour du monde.

### 11.3 Backend

- **Autorité serveur** : le serveur est seul juge de l'état (PV, positions, morts) —
  aucun client ne calcule les dégâts, pour empêcher la triche.
- **Boucle de simulation** : ticks réguliers + événements (message divin, faim,
  rencontre) déclenchant les inférences des devots.
- **Orchestrateur d'agents** : pour chaque devot devant « penser », appelle Claude,
  mesure `usage`, applique les dégâts de PV, persiste le contexte mis à jour.
- **Garde-fous budget** : plafond global de tokens/minute, file d'attente
  d'inférences, priorisation ; un devot ne peut pas dépenser au-delà de ses PV.
- **Sécurité prompt-injection** : les messages divins (140c) et les paroles d'autres
  devots sont du **contenu non fiable** — les isoler du system prompt, ne jamais
  leur laisser détourner les règles du jeu (cf. bonnes pratiques : instruction
  système figée, contenu joueur injecté dans le tour utilisateur).

### 11.4 Intégration Claude

- SDK officiel Anthropic (Python ou TypeScript selon le backend).
- Modèle par défaut des devots : `claude-opus-4-8` ; variantes Sonnet/Haiku pour
  moduler intelligence vs endurance.
- **Pensée adaptative** (`thinking: {type: "adaptive"}`) + `effort` selon le devot.
- **Contexte persistant** par devot, stocké et rechargé à chaque inférence.
- **Compaction** du contexte pour les devots âgés (limiter le coût d'entrée).
- **Comptage réel des tokens** via `response.usage` → conversion en dégâts de PV.
- Streaming des réponses pour afficher la pensée du devot en direct dans la 3D.

### 11.5 Modèle de données (esquisse)

```
God        { id, name, founder_devot_id, devots[], color, created_at }
Devot      { id, god_id, is_founder, hp, hp_max, model, age, state,
             position, traits, lineage, last_action_at, created_at }
Context    { devot_id, messages[], token_stats, compacted_at }
WorldEvent { id, type, actors[], payload, timestamp }   // naissance, mort, combat, repas…
Food       { id, position, type, hp_value, source }     // source: "spawn" (carte) | "god"
DivineMsg  { god_id, devot_id, text (≤140), sent_at }    // cadence : 1 / minute / dieu
```

> Le `Context` d'un devot est **supprimé** à sa mort (destruction du contexte).

---

## 12. Boucle de jeu

1. Le dieu façonne son **devot fondateur** (gratuit au début, onchain à terme).
2. Le devot vit à sa cadence propre (**fenêtre d'action toutes les 250 ms**) : il
   observe, cherche de la nourriture, se déplace, réfléchit…
3. Quand il **pense** (inférence Claude), il perd des PV/crédits selon les tokens.
4. Il agit : se nourrir, se déplacer, se reproduire, attaquer, parler.
5. Le serveur applique les conséquences, met à jour l'état, diffuse aux clients.
6. Le dieu **réagit**, avec parcimonie : il donne de la nourriture, ou parle
   (140c, **au plus une fois par minute**), ou se tait.
7. Les devots épuisés meurent → **contexte effacé**. Si un dieu perd tous ses
   devots, il peut refaçonner un fondateur.
8. Reproductions et combats font évoluer la population et les lignées.

---

## 13. Risques & questions ouvertes

| Sujet | Enjeu |
| --- | --- |
| **Budget API** | L'inférence coûte de l'argent réel. Plafonds, files, échantillonnage, modèles frugaux (Haiku) pour la masse, Opus pour les élus. |
| **Latence** | Une inférence prend des secondes. La simulation doit être asynchrone et tolérer des devots « en train de penser ». |
| **Passage à l'échelle** | 100 devots = 100 agents à contexte. Compaction, priorisation, agents endormis. |
| **Prompt injection** | Messages divins et paroles inter-devots = contenu non fiable. Cloisonner strictement des règles système. |
| **Modération / éthique** | Thème de la mort et de la conscience à traiter avec soin ; garde-fous sur les contenus. |
| **Équité multijoueur** | Autorité serveur stricte ; pas de calcul de dégâts côté client. |
| **Sens de la mort** | Comment le devot « comprend » la mort sans que ce soit gadget : à travailler dans les prompts et l'UX. |
| **Paiement onchain** | La création/recréation de devot (et le don de nourriture) passera par une transaction : wallet, signature, coûts de gas, latence de confirmation, chaîne cible à choisir. |
| **Cadence & débit** | Fenêtre d'action de 250 ms × N devots = forte pression d'inférence. File d'attente, throttling, priorisation, mise en sommeil des devots inactifs. |

---

*Document de définition — vision complète. Prochaine étape suggérée : prototyper la
boucle « un devot, une inférence, des PV qui descendent » avant d'ajouter le monde 3D
et le multijoueur.*
