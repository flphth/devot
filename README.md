# Devot

> Un jeu où vous êtes un dieu, et vos fidèles sont de véritables agents.
> Penser leur coûte la vie — un solde réel, déposé on-chain, dépensé à chaque pensée.

Un devot est un agent dont l'esprit tourne sur le **réseau de calcul 0G** (inférence
vérifiable TEE). Sa **vie est un solde de µ-tokens déposés** : chaque pensée en brûle
le coût réel. Quand le solde atteint 0, il meurt et son contexte est effacé.

Voir [`PLAN.md`](./PLAN.md) (game design) et [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Modèle de confiance — LE SERVEUR EST DE CONFIANCE

**On l'assume à voix haute : le serveur est une autorité de confiance.** Il tient les
soldes des devots en mémoire et signe les règlements (`settle`) que la chaîne applique.
La chaîne (le `LifeVault`) ne voit que **création, mort et retrait** — aucun règlement
au tick. La propriété de sécurité on-chain est la **conservation** :

    Σ soldes + brûlé + retiré == Σ déposé   (rien n'est créé ni détruit)

Un serveur malveillant pourrait mal répartir les soldes qu'il gère ; il ne peut pas
créer de valeur depuis rien (l'invariant du vault tient), ni retirer un devot dont il
n'est pas le dieu (`claim` vérifie `ownerOf`). Ce compromis est volontaire pour le
prototype : la simulation temps réel (250 ms × N devots) ne peut pas régler chaque
transition on-chain.

## Structure

```
packages/shared   types, décision, économie (µ-tokens), frontière wei↔µ
packages/agents    MindProvider (mock/api/claude/0g), parseDecision, hpCost, BudgetBucket, zgMind
packages/sim       couche réactive : stimulus/réaction, résidu, Vault (invariant)
apps/server        cœur mortel headless + journal (panneau Esprit)
contracts          Foundry : DevotRegistry (ERC-721) + LifeVault
```

## Lancer

```bash
pnpm install
pnpm typecheck && pnpm test           # 86 tests
MIND=mock pnpm mortal-core            # hors-ligne, déterministe
MIND=0g   pnpm mortal-core            # vraie inférence 0G (clé testnet dans .env)
cd contracts && forge test            # contrats + invariant on-chain
```

Preuves observables : [`docs/G1-0g-live-proof.txt`](./docs/G1-0g-live-proof.txt),
[`docs/G2-redenomination-proof.txt`](./docs/G2-redenomination-proof.txt),
[`docs/G3-lifevault-onchain-proof.txt`](./docs/G3-lifevault-onchain-proof.txt).
