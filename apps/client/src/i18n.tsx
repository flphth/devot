import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * UI LANGUAGE.
 *
 * Only what the player reads is translated. The values that travel on the wire
 * — trait names, hat names, stat keys — stay exactly as the server knows them,
 * and are merely DISPLAYED in the chosen language. Translating them at the
 * source would break validation the moment the client and server disagreed,
 * which is precisely how the "Traits invalides" refusal happened.
 *
 * The devots themselves keep thinking in English regardless: WORLD_RULES is the
 * shared cached prefix, and a devot's language is not a matter of UI taste.
 */

export type Lang = "en" | "fr";

const STORAGE_KEY = "devot.lang";

type Dict = Record<string, string>;

const EN: Dict = {
  "lang.label": "Language",
  "app.connecting": "Ascending into the world…",
  "app.unreachable":
    "The world is unreachable. Is the server running? (pnpm --filter @devot/server dev)",

  "hud.treasury": "Treasury:",
  "hud.treasury-devots": "({n} devot(s) affordable)",

  "creation.paying": "Waiting for the deposit to be mined…",
  "wallet.connect": "Connect a wallet to pay the deposit",
  "wallet.none": "No wallet found in this browser. MetaMask or any injected wallet will do.",
  "wallet.connected": "Paying from {a}",
  "wallet.wrong-chain": "wrong network",

  "feed.title": "The world thinks",
  "feed.empty": "Nobody has thought anything yet.",

  "godmode.banner": "⚡ GOD MODE — click: spawn · drag food · fog off · press 1 to exit",
  "godmode.spawn": "Spawn",
  "godmode.devot": "Devot",
  "godmode.monster": "Monster",

  "pantheon.connecting": "Connecting…",
  "hud.thinking": "of thinking",
  "hud.mind-of": "Mind of {name}",
  "hud.cycles": "{age} cycles",
  "hud.no-memory": "No memory yet. They have not lived.",
  "hud.speak-placeholder": "Speak to your devot (140 characters, it will cost them their life)…",
  "hud.speak-cooldown": "Your voice is resting ({s} s)…",
  "hud.feed-title": "Drop food near them",
  "hud.smite-title": "Smite your devot — their memory will be destroyed forever",
  "hud.confirm": "Confirm ⚡",
  "hud.smite-warning": "⚠ Smiting is irreversible: their mind will be erased forever.",
  "hud.speak-counter":
    "{n}/{max} — one word per minute. Silence is sometimes the greatest gift of all.",
  "hud.other-god": "This devot belongs to another god.",

  "combat.title": "⚔ Life theft",
  "combat.explain":
    "A balance IS the thinking budget. Taking a devot's life takes away its thinking time: it thinks less, decides worse, then dies.",
  "combat.total": "{n} changed hands before your eyes.",
  "combat.stranger": "a stranger",

  "creation.title": "Shape your founder",
  "creation.subtitle":
    "⚡ {god} — the first of your line. Everything you choose here follows them to the grave, and passes on to their descendants.",
  "creation.soul": "Their soul",
  "creation.believe": "What they believe they are",
  "creation.soul-placeholder": '"I was born to protect my own"',
  "creation.signature-help":
    "Their signature — derived from each of your choices. Change one thing and it changes.",
  "creation.refused": "The server refused: {reason}",
  "creation.need-traits": "Choose at least two traits",
  "creation.points-left": "{n} point(s) left to spend",
  "creation.give-life": "Give them life",
  "creation.look": "Their look",
  "creation.body": "Their body",
  "creation.to-spend": "{n} point(s) to spend",
  "creation.budget-help":
    "A fixed budget: what you give here, you take from somewhere else. There is no devot who is good at everything.",
  "creation.hat": "Hat",
  "creation.shirt": "Shirt",
  "creation.trousers": "Trousers",
  "creation.cape": "Cape",
  "creation.face": "Face",
  "creation.skin": "Skin",
  "creation.build": "Build",

  "state.alive": "alive",
  "state.starving": "starving",
  "state.dying": "dying",
  "state.dead": "dead",
};

const FR: Dict = {
  "lang.label": "Langue",
  "app.connecting": "Ascension vers le monde…",
  "app.unreachable":
    "Le monde est injoignable. Le serveur tourne-t-il ? (pnpm --filter @devot/server dev)",

  "hud.treasury": "Trésor :",
  "hud.treasury-devots": "({n} devot(s) finançable(s))",

  "creation.paying": "Attente de la confirmation du dépôt…",
  "wallet.connect": "Connecte un wallet pour payer le dépôt",
  "wallet.none": "Aucun wallet dans ce navigateur. MetaMask ou tout wallet injecté fait l'affaire.",
  "wallet.connected": "Paiement depuis {a}",
  "wallet.wrong-chain": "mauvais réseau",

  "feed.title": "Le monde pense",
  "feed.empty": "Personne n'a encore pensé quoi que ce soit.",

  "godmode.banner":
    "⚡ MODE DIEU — clic : faire apparaître · glisser la nourriture · sans brouillard · 1 pour sortir",
  "godmode.spawn": "Faire apparaître",
  "godmode.devot": "Devot",
  "godmode.monster": "Monstre",

  "pantheon.connecting": "Connexion…",
  "hud.thinking": "de pensée",
  "hud.mind-of": "Esprit de {name}",
  "hud.cycles": "{age} cycles",
  "hud.no-memory": "Aucun souvenir encore. Il n'a pas vécu.",
  "hud.speak-placeholder": "Parle à ton devot (140 caractères, cela lui coûtera de la vie)…",
  "hud.speak-cooldown": "Ta voix se repose ({s} s)…",
  "hud.feed-title": "Faire tomber de la nourriture près de lui",
  "hud.smite-title": "Foudroyer ton devot — sa mémoire sera détruite à jamais",
  "hud.confirm": "Confirmer ⚡",
  "hud.smite-warning": "⚠ Foudroyer est irréversible : son esprit sera effacé à jamais.",
  "hud.speak-counter":
    "{n}/{max} — une parole par minute. Le silence est parfois le plus grand des cadeaux.",
  "hud.other-god": "Ce devot appartient à un autre dieu.",

  "combat.title": "⚔ Vol de vie",
  "combat.explain":
    "Les PV sont le budget de pensée. Prendre la vie d'un devot lui prend son temps de réflexion : il pense moins, décide plus mal, puis meurt.",
  "combat.total": "{n} a changé de mains sous tes yeux.",
  "combat.stranger": "un inconnu",

  "creation.title": "Façonne ton fondateur",
  "creation.subtitle":
    "⚡ {god} — le premier de ta lignée. Tout ce que tu choisis ici le suivra jusqu'à la tombe, et passera à ses descendants.",
  "creation.soul": "Son âme",
  "creation.believe": "Ce qu'il croit être",
  "creation.soul-placeholder": '"Je suis né pour protéger les miens"',
  "creation.signature-help":
    "Sa signature — dérivée de chacun de tes choix. Change une chose et elle change.",
  "creation.refused": "Le serveur a refusé : {reason}",
  "creation.need-traits": "Choisis au moins deux traits",
  "creation.points-left": "{n} point(s) restant(s) à dépenser",
  "creation.give-life": "Donne-lui la vie",
  "creation.look": "Son allure",
  "creation.body": "Son corps",
  "creation.to-spend": "{n} point(s) à dépenser",
  "creation.budget-help":
    "Un budget fixe : ce que tu donnes ici, tu le prends ailleurs. Aucun devot n'est bon en tout.",
  "creation.hat": "Chapeau",
  "creation.shirt": "T-shirt",
  "creation.trousers": "Pantalon",
  "creation.cape": "Cape",
  "creation.face": "Visage",
  "creation.skin": "Peau",
  "creation.build": "Corpulence",

  "state.alive": "vivant",
  "state.starving": "affamé",
  "state.dying": "agonisant",
  "state.dead": "mort",
};

/**
 * Display names for values that must NOT change on the wire. The server
 * validates the English token; the player reads whichever label they picked.
 */
const DISPLAY: Record<Lang, Dict> = {
  en: {},
  fr: {
    // traits (TRAIT_POOL)
    curious: "curieux",
    cautious: "prudent",
    ravenous: "vorace",
    pious: "pieux",
    defiant: "rebelle",
    peaceful: "pacifique",
    fierce: "féroce",
    melancholic: "mélancolique",
    playful: "joueur",
    taciturn: "taciturne",
    generous: "généreux",
    envious: "envieux",
    // stats
    vitality: "vigueur",
    power: "puissance",
    speed: "vivacité",
    sight: "vue",
    // appearance
    none: "aucun",
    cap: "casquette",
    widebrim: "chapeau large",
    helmet: "casque",
    crown: "couronne",
    short: "courte",
    long: "longue",
    glasses: "lunettes",
    mask: "masque",
    blindfold: "bandeau",
    slim: "mince",
    average: "moyenne",
    heavy: "massive",
  },
};

const DICTS: Record<Lang, Dict> = { en: EN, fr: FR };

function readStored(): Lang {
  if (typeof localStorage === "undefined") return "en";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "fr" || v === "en" ? v : "en";
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Localised label for a wire value (trait, hat, stat key…). */
  d: (value: string) => string;
};

const LangContext = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStored);

  useEffect(() => {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, lang);
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      // Falling back to English rather than showing a raw key: a missing
      // translation should degrade into a readable sentence, not into debris.
      const raw = DICTS[lang][key] ?? EN[key] ?? key;
      if (!params) return raw;
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
        raw,
      );
    },
    [lang],
  );

  const d = useCallback((value: string) => DISPLAY[lang][value] ?? value, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang: setLangState, t, d }}>
      {children}
    </LangContext.Provider>
  );
}

export function useT(): Ctx {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useT outside LangProvider");
  return ctx;
}

/** Top-right language picker. Deliberately small: it is a setting, not a feature. */
export function LangPicker() {
  const { lang, setLang } = useT();
  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      aria-label="Language"
      data-testid="lang-picker"
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        zIndex: 60,
        padding: "5px 8px",
        borderRadius: 8,
        border: "1px solid #2a3245",
        background: "rgba(13,17,26,0.88)",
        color: "#aeb8c9",
        font: "12px system-ui, sans-serif",
        cursor: "pointer",
      }}
    >
      <option value="en">EN — English</option>
      <option value="fr">FR — Français</option>
    </select>
  );
}
