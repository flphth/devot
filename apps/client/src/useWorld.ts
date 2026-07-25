import { Client, Room } from "colyseus.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ROOM_NAME,
  SERVER_PORT,
  type CreateFounderMsg,
  type CombatFxMsg,
  type JournalEntry,
  type JournalMsg,
} from "@devot/shared";

/** Identifiant local d'un effet de combat : sert de clé de rendu. */
let combatSeq = 0;

/** Vue plate (côté client) de l'état synchronisé. */
export interface DevotView {
  id: string;
  godId: string;
  name: string;
  isFounder: boolean;
  x: number;
  y: number;
  z: number;
  hp: number;
  hpMax: number;
  state: string;
  profile: string;
  thinking: boolean;
  utterance: string;
  emotion: string;
  thought: string;
  age: number;
  /** Identité figée : apparence, stats, âme, signature, en JSON. */
  identity: string;
  /** Objets forgés, séparés par des virgules. */
  items: string;
}

export interface FoodView {
  id: string;
  x: number;
  z: number;
  kind: string;
  source: string;
}

export interface GodView {
  id: string;
  name: string;
  color: string;
  lastSpeakAt: number;
  connected: boolean;
}

export interface WorldSnapshot {
  devots: DevotView[];
  food: FoodView[];
  gods: GodView[];
}

/**
 * Un vol de vie observé. On en garde une file courte : plusieurs combats
 * peuvent se dérouler en même temps, et chacun doit laisser sa trace à l'écran.
 */
export interface CombatFx {
  id: number;
  attackerId: string;
  victimId: string;
  drained: number;
  x: number;
  z: number;
  lethal: boolean;
  at: number;
}

export interface SmiteFx {
  devotId: string;
  x: number;
  z: number;
  at: number;
}

export interface WorldActions {
  createFounder: (msg: CreateFounderMsg) => void;
  speak: (devotId: string, text: string) => void;
  feed: (devotId: string) => void;
  smite: (devotId: string) => void;
  getJournal: (devotId: string) => void;
  debugSpawnDevot: (x: number, z: number) => void;
  debugMoveFood: (foodId: string, x: number, z: number) => void;
}

export interface WorldConnection {
  snapshot: WorldSnapshot;
  godId: string | null;
  status: "connecting" | "connected" | "error";
  lastRejection: string | null;
  lastSmite: SmiteFx | null;
  /** Combats récents, du plus ancien au plus récent. */
  combats: CombatFx[];
  journals: Record<string, JournalEntry[]>;
  actions: WorldActions;
}

const EMPTY: WorldSnapshot = { devots: [], food: [], gods: [] };

export function useWorld(godName: string): WorldConnection {
  const [snapshot, setSnapshot] = useState<WorldSnapshot>(EMPTY);
  const [godId, setGodId] = useState<string | null>(null);
  const [status, setStatus] = useState<WorldConnection["status"]>("connecting");
  const [lastRejection, setLastRejection] = useState<string | null>(null);
  const [lastSmite, setLastSmite] = useState<SmiteFx | null>(null);
  const [combats, setCombats] = useState<CombatFx[]>([]);
  const [journals, setJournals] = useState<Record<string, JournalEntry[]>>({});
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    const endpoint =
      import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:${SERVER_PORT}`;
    const client = new Client(endpoint);
    let disposed = false;

    client
      .joinOrCreate(ROOM_NAME, { godName })
      .then((room) => {
        if (disposed) return void room.leave();
        roomRef.current = room;
        setStatus("connected");

        room.onMessage("welcome", (msg: { godId: string }) => setGodId(msg.godId));
        room.onMessage("rejected", (msg: { reason: string }) => {
          setLastRejection(msg.reason);
          setTimeout(() => setLastRejection(null), 4000);
        });
        room.onMessage("smite", (msg: { devotId: string; x: number; z: number }) => {
          setLastSmite({ ...msg, at: Date.now() });
        });
        room.onMessage("combat", (msg: CombatFxMsg) => {
          // File courte : plusieurs combats peuvent se dérouler en même temps,
          // et l'affichage ne garde que les plus récents.
          setCombats((prev) => [
            ...prev.slice(-19),
            { ...msg, id: combatSeq++, at: Date.now() },
          ]);
        });
        room.onMessage("journal", (msg: JournalMsg) => {
          setJournals((prev) => ({ ...prev, [msg.devotId]: msg.entries }));
        });

        room.onStateChange((state: any) => {
          const devots: DevotView[] = [];
          state.devots.forEach((d: any) => {
            devots.push({
              id: d.id,
              godId: d.godId,
              name: d.name,
              isFounder: d.isFounder,
              identity: d.identity ?? "",
              items: d.items ?? "",
              x: d.x,
              y: d.y,
              z: d.z,
              hp: d.hp,
              hpMax: d.hpMax,
              state: d.state,
              profile: d.profile,
              thinking: d.thinking,
              utterance: d.utterance,
              emotion: d.emotion,
              thought: d.thought,
              age: d.age,
            });
          });
          const food: FoodView[] = [];
          state.food.forEach((f: any) => {
            food.push({ id: f.id, x: f.x, z: f.z, kind: f.kind, source: f.source });
          });
          const gods: GodView[] = [];
          state.gods.forEach((g: any) => {
            gods.push({
              id: g.id,
              name: g.name,
              color: g.color,
              lastSpeakAt: g.lastSpeakAt,
              connected: g.connected,
            });
          });
          setSnapshot({ devots, food, gods });
        });
      })
      .catch((err) => {
        console.error("[devot] connexion échouée", err);
        setStatus("error");
      });

    return () => {
      disposed = true;
      roomRef.current?.leave();
      roomRef.current = null;
    };
  }, [godName]);

  const createFounder = useCallback((msg: CreateFounderMsg) => {
    roomRef.current?.send("createFounder", msg);
  }, []);
  const speak = useCallback((devotId: string, text: string) => {
    roomRef.current?.send("speak", { devotId, text });
  }, []);
  const feed = useCallback((devotId: string) => {
    roomRef.current?.send("feed", { devotId });
  }, []);
  const smite = useCallback((devotId: string) => {
    roomRef.current?.send("smite", { devotId });
  }, []);
  const getJournal = useCallback((devotId: string) => {
    roomRef.current?.send("getJournal", { devotId });
  }, []);
  const debugSpawnDevot = useCallback((x: number, z: number) => {
    roomRef.current?.send("debugSpawnDevot", { x, z });
  }, []);
  const debugMoveFood = useCallback((foodId: string, x: number, z: number) => {
    roomRef.current?.send("debugMoveFood", { foodId, x, z });
  }, []);

  return {
    snapshot,
    godId,
    status,
    lastRejection,
    lastSmite,
    combats,
    journals,
    actions: {
      createFounder,
      speak,
      feed,
      smite,
      getJournal,
      debugSpawnDevot,
      debugMoveFood,
    },
  };
}
