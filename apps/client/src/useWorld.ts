import { Client, Room } from "colyseus.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { ROOM_NAME, SERVER_PORT } from "@devot/shared";

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
  age: number;
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

export interface WorldActions {
  createFounder: (name?: string) => void;
  speak: (devotId: string, text: string) => void;
  feed: (devotId: string) => void;
}

export interface WorldConnection {
  snapshot: WorldSnapshot;
  godId: string | null;
  status: "connecting" | "connected" | "error";
  lastRejection: string | null;
  actions: WorldActions;
}

const EMPTY: WorldSnapshot = { devots: [], food: [], gods: [] };

export function useWorld(godName: string): WorldConnection {
  const [snapshot, setSnapshot] = useState<WorldSnapshot>(EMPTY);
  const [godId, setGodId] = useState<string | null>(null);
  const [status, setStatus] = useState<WorldConnection["status"]>("connecting");
  const [lastRejection, setLastRejection] = useState<string | null>(null);
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

        room.onStateChange((state: any) => {
          const devots: DevotView[] = [];
          state.devots.forEach((d: any) => {
            devots.push({
              id: d.id,
              godId: d.godId,
              name: d.name,
              isFounder: d.isFounder,
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

  const createFounder = useCallback((name?: string) => {
    roomRef.current?.send("createFounder", { name });
  }, []);
  const speak = useCallback((devotId: string, text: string) => {
    roomRef.current?.send("speak", { devotId, text });
  }, []);
  const feed = useCallback((devotId: string) => {
    roomRef.current?.send("feed", { devotId });
  }, []);

  return {
    snapshot,
    godId,
    status,
    lastRejection,
    actions: { createFounder, speak, feed },
  };
}
