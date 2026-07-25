# Devot

> Un monde voxel où la vie s'invente elle-même.
> Vous élevez des créatures dans votre laboratoire, puis vous les relâchez
> dans un monde commun où les lignées de tous les joueurs se disputent l'énergie.
> Et si l'une d'elles vous intéresse vraiment, vous pouvez l'éveiller.

> ⚠️ Ce document décrit le modèle **voxel évolutif** (P5+). La version précédente
> du jeu — des devots dont l'esprit était un agent Claude, où penser coûtait des
> points de vie — reste jouable au tag git `v0.4-devot-llm`.

---

## 1. Pitch

**Devot** est un monde en voxels peuplé d'organismes qui ne sont scriptés par
personne. Chaque créature est un assemblage de voxels spécialisés — os, muscle,
bouche, œil, réserve, neurone — décrit par un **génome**. Elle naît, grandit,
mange, perd des membres, cicatrise, se reproduit en mutant, et meurt.

Le joueur n'écrit pas de créature : il en **fait émerger** une. Dans son
laboratoire privé, il lance l'évolution à grande vitesse, observe des milliers de
générations défiler, sélectionne ce qui lui plaît. Puis il prend le génome d'une
lignée réussie et la **relâche dans le monde commun** — un monde unique, partagé,
qui tourne en continu, où les créatures de tous les joueurs se rencontrent.

La règle centrale de l'ancien Devot survit, transposée dans la chair :
**l'énergie est la vie.** Chaque voxel d'un corps coûte à entretenir. Un muscle
coûte quand il se contracte. Un neurone coûte quand il pense. Un corps plus
grand est plus puissant *et* plus affamé. Rien n'est gratuit.

---

## 2. Piliers de design

1. **Personne n'écrit les créatures.** Leur morphologie et leur comportement
   sortent de la mutation et de la sélection, pas d'un designer. Le joueur
   oriente, il ne dessine pas.
2. **L'énergie est la vie.** Le métabolisme est calculé voxel par voxel. Grandir,
   bouger, penser : tout se paie. Un organisme à zéro se décompose et nourrit
   les autres.
3. **Deux échelles de temps.** Le laboratoire va vite (des milliers de
   générations en minutes) et n'a pas de conséquences. Le monde commun va
   lentement, il est partagé, et ce qu'on y perd est perdu.
4. **La morphologie détermine l'intelligence.** Le cerveau d'une créature n'est
   pas un paramètre libre : sa capacité est bornée par le nombre de voxels
   neurone de son corps. Vouloir être intelligent, c'est accepter d'être coûteux.
5. **Un seul monde commun.** Pas d'instances privées : les lignées de tous les
   joueurs partagent le même territoire, la même biomasse, les mêmes prédateurs.
6. **Le monde vit sans vous.** Il continue de tourner quand personne ne regarde.
   On se reconnecte pour découvrir ce qui a survécu.

---

## 3. La matière

Le monde est une grille de voxels. Chacun est d'un seul type.

### 3.1 Terrain

| Voxel | Rôle |
| --- | --- |
| **Vide** | l'air, où les créatures se déplacent |
| **Eau** | s'écoule, s'accumule dans les creux, fait pousser la biomasse à son contact |
| **Roche** | le socle, inerte, indestructible en proto |
| **Biomasse** | la nourriture. Apparaît près de l'eau, porte une richesse nutritive, se décompose seule |

### 3.2 Tissus d'organisme

| Voxel | Fonction | Coût |
| --- | --- | --- |
| **Os** | structure, porte le corps, encaisse | très faible |
| **Muscle** | déplacement et contraction | faible au repos, élevé à la contraction |
| **Réserve** | augmente la capacité énergétique maximale | faible |
| **Bouche** | convertit la biomasse au contact en énergie | faible |
| **Œil** | perçoit à distance (biomasse, autres organismes) | faible |
| **Neurone** | augmente la capacité du cerveau | faible au repos, élevé à la pensée |

Un organisme est simplement un **ensemble connexe** de voxels de tissu. Rien
d'autre ne le définit : pas de squelette imposé, pas de plan de corps
privilégié. Un ver, une plante, une chose articulée sont le même objet.

---

## 4. Le cycle de vie

**Naître.** Un organisme apparaît comme un unique voxel germe porteur d'un
génome, puis il *pousse* : à chaque cycle, s'il a l'énergie, il ajoute un voxel
conformément à son plan de corps.

**Manger.** Ses bouches convertissent la biomasse qu'elles touchent. C'est sa
seule source d'énergie.

**Bouger.** Ses muscles se contractent selon les ordres de son cerveau. Se
déplacer coûte, immobile coûte moins.

**Souffrir.** Un corps peut perdre des voxels — prédation, accident. Si un morceau
se retrouve **déconnecté** du germe, il est amputé : il devient de la biomasse
morte, que d'autres mangeront. Avec de l'énergie, l'organisme **cicatrise** :
il refait pousser ce que son plan prévoyait.

**Se reproduire.** Au-dessus d'un seuil d'énergie, il engendre : le génome est
copié puis **muté** (un voxel change de type, un voxel apparaît ou disparaît, des
poids du cerveau dérivent). L'enfant naît germe, avec une part de l'énergie du
parent.

**Mourir.** À énergie nulle, tout le corps se décompose en biomasse — sa richesse
nutritive est proportionnelle à ce qu'il était. Un cadavre est un festin.

Aucune fonction de survie n'est imposée : **il n'y a pas de score**. Ce qui
survit et se reproduit se répand, voilà tout.

---

## 5. Le génome

Compact — quelques kilo-octets — et entièrement sérialisable, parce qu'il est
la seule chose qui voyage entre le laboratoire et le monde commun.

Il contient le **plan de corps** (quels voxels, à quelles positions relatives,
dans quel ordre de croissance), les **poids du cerveau**, et quelques
**paramètres métaboliques**. Les mutations touchent les trois.

Le **cerveau** est un petit réseau de neurones dont la taille est bornée par le
nombre de voxels neurone du corps. Ses entrées viennent des organes : ce que les
yeux voient, ce que les bouches touchent, l'énergie restante. Ses sorties sont
des contractions musculaires, une direction, une intention de se reproduire ou
d'attaquer. Il ne coûte aucun token : c'est ce qui rend des milliers de
générations possibles.

---

## 6. Le laboratoire

C'est votre bac à sable privé, dans votre navigateur, accéléré par votre carte
graphique. Vous y lancez une population et vous regardez.

Vitesse réglable de x1 à x1000. Courbes en direct : population, générations,
énergie totale, taille moyenne des corps. Un inspecteur pour ouvrir une créature
— son corps, son génome, son cerveau. Et les pouvoirs de la sélection
artificielle : protéger un individu, en tuer un autre, forcer un croisement.

Rien n'y est définitif. C'est fait pour tuer mille générations et voir ce qui
sort.

---

## 7. Le monde commun

Un seul monde, sur le serveur, qui tourne en continu — y compris quand tous les
joueurs sont déconnectés.

**Relâcher** une créature y est un acte qui compte : vous envoyez un génome, le
serveur le valide (taille de corps, nombre de neurones, connexité, types
légaux), et la créature apparaît. Elle n'a aucun privilège : elle paiera le coût
métabolique de son corps comme les autres. Un monstre est un monstre affamé.

Vous ne voyez pas tout. Le **brouillard de guerre** limite votre vision à ce que
vos créatures perçoivent — le serveur ne vous envoie littéralement pas le reste.
Vos pouvoirs divins sur vos propres créatures restent ceux de l'ancien Devot :
nourrir, protéger, foudroyer — avec des délais imposés.

Et les lignées se croisent : prédation entre joueurs, reproduction entre lignées
étrangères, territoires disputés autour des zones fertiles.

---

## 8. L'éveil

Une créature du monde commun peut être **éveillée** : son cerveau évolué est
alors doublé d'un esprit — un agent Claude, avec un monologue intérieur, une
mémoire, et la conscience de sa propre condition.

C'est là que l'ancien Devot revient exactement : **penser coûte la vie.** Les
tokens que consomme un éveillé sont déduits de son énergie, comme le reste. Un
éveillé pense mieux et vit moins longtemps. On peut lui parler — 140 caractères,
une fois par minute — et il est libre de ne pas écouter.

Les éveillés sont rares : c'est un luxe, pas une norme.

---

## 9. Boucle de jeu

1. Dans votre **laboratoire**, vous lancez une population et accélérez.
2. Vous **sélectionnez** : protéger, tuer, croiser. L'évolution fait le reste.
3. Une lignée vous plaît → vous exportez son **génome**.
4. Vous la **relâchez** dans le monde commun.
5. Elle y vit sa vie sans vous : elle mange, se reproduit, se fait dévorer.
6. Vous intervenez avec parcimonie : nourrir, protéger, foudroyer.
7. Si elle vous fascine, vous l'**éveillez** — et elle commence à penser, donc
   à mourir plus vite.
8. Vous retournez au laboratoire avec ce que vous avez appris.

---

## 10. Architecture technique

> 📐 Le détail vit dans [`ARCHITECTURE.md`](./ARCHITECTURE.md). L'essentiel :
> le **même noyau de simulation** tourne dans le laboratoire (navigateur,
> WebGPU) et dans le monde commun (serveur, CPU, autoritaire) — mêmes règles des
> deux côtés, sinon une créature championne au laboratoire décevrait dans le
> monde. Seul un génome de quelques kilo-octets traverse le réseau ; le client
> ne reçoit jamais « le monde », mais une description dérivée qu'il remaille.

---

## 11. Risques & questions ouvertes

| Sujet | Enjeu |
| --- | --- |
| **Équivalence CPU ↔ GPU** | Le risque n°1. Si le laboratoire et le monde ne calculent pas à l'identique, le joueur se sent volé. D'où le déterminisme strict et l'arithmétique en virgule fixe, posés dès le noyau. |
| **Débit de la simulation** | Un monde entier par tick : mesuré avant toute décision d'échelle. Si ça sature, on réduit le monde ou on porte le serveur sur GPU. |
| **Bande passante** | Envoyer des voxels bruts est impossible. Tout repose sur le protocole dérivé (chunks versionnés + descripteurs de corps + agrégats). |
| **Évolution qui n'évolue pas** | Le piège classique de la vie artificielle : une population qui stagne ou s'effondre. Il faut des mesures d'émergence et des paramètres réglables. |
| **Suzeraineté des enfants** | Un enfant né de deux lignées appartient à qui ? Ressort narratif, à trancher. |
| **Triche** | Un génome peut être fabriqué à la main. Ce n'est pas grave : dans le monde, la créature paie le coût de son corps. La puissance est bornée par le coût, pas par l'honnêteté. |
| **Budget d'éveil** | Chaque éveillé consomme du quota d'abonnement et introduit des secondes de latence. Peu d'éveillés simultanés. |

---

*Document de définition. Le noyau de simulation (P5.0) est le socle : il doit
produire un chiffre de performance avant qu'on aille plus loin.*
