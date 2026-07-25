import { useCallback, useEffect, useRef, useState } from "react";
import { Client, type Room } from "colyseus.js";
import {
  MSG_BODY,
  MSG_CHUNK,
  VOXEL_ROOM_NAME,
  type LookAtMsg,
  type ReleaseResultMsg,
} from "@devot/shared";
import { CHUNK, SX, SZ, decodeBody, decodeChunk, type DecodedBody } from "@devot/sim-voxel";
import { CHAMPION_KEY, type StoredChampion } from "../lab/useLab.js";

/**
 * Connexion au MONDE COMMUN.
 *
 * Ce hook ne simule RIEN. Il reçoit du dérivé et l'assemble : des chunks de
 * terrain qui arrivent quand ils changent, des descripteurs de corps qui
 * arrivent une fois, et l'état par tick des organismes visibles. Tout ce qu'il
 * ne reçoit pas n'existe pas pour lui — c'est le brouillard, et il est décidé
 * par le serveur.
 */

export interface WorldAggregates {
  tick: number;
  population: number;
  maxGeneration: number;
  biomass: number;
  avgBodyVoxels: number;
  avgNeurons: number;
}

export interface WorldOrganism {
  id: number;
  x: number;
  y: number;
  z: number;
  energy: number;
  lineage: string;
  generation: number;
  shape: number;
}

export interface WorldGod {
  id: string;
  name: string;
  color: string;
  living: number;
  released: number;
}

export interface VoxelWorldClient {
  connected: boolean;
  error: string | null;
  aggregates: WorldAggregates | null;
  /** Terrain reçu, par index de chunk. Le reste du monde reste inconnu. */
  chunks: Map<number, { cx: number; cy: number; cz: number; materials: Uint8Array }>;
  chunkRevision: number;
  organisms: WorldOrganism[];
  bodies: Map<number, DecodedBody>;
  gods: WorldGod[];
  eye: { x: number; z: number };
  champion: StoredChampion | null;
  lastRelease: ReleaseResultMsg | null;
  bytesReceived: number;
  lookAt: (x: number, z: number) => void;
  release: () => void;
}

const SERVER_URL =
  (import.meta.env.VITE_DEVOT_SERVER as string | undefined) ??
  `ws://${location.hostname}:2567`;

export function useVoxelWorld(): VoxelWorldClient {
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aggregates, setAggregates] = useState<WorldAggregates | null>(null);
  const [organisms, setOrganisms] = useState<WorldOrganism[]>([]);
  const [gods, setGods] = useState<WorldGod[]>([]);
  const [eye, setEye] = useState({ x: SX >> 1, z: SZ >> 1 });
  const [lastRelease, setLastRelease] = useState<ReleaseResultMsg | null>(null);
  const [bytesReceived, setBytesReceived] = useState(0);
  const [chunkRevision, setChunkRevision] = useState(0);
  const [champion, setChampion] = useState<StoredChampion | null>(null);

  const chunksRef = useRef(
    new Map<number, { cx: number; cy: number; cz: number; materials: Uint8Array }>(),
  );
  const bodiesRef = useRef(new Map<number, DecodedBody>());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAMPION_KEY);
      if (raw) setChampion(JSON.parse(raw) as StoredChampion);
    } catch {
      setChampion(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const client = new Client(SERVER_URL);

    void client
      .joinOrCreate(VOXEL_ROOM_NAME, { name: "Dieu" })
      .then((room) => {
        if (!alive) {
          void room.leave();
          return;
        }
        roomRef.current = room;
        setConnected(true);
        setError(null);

        room.onMessage(MSG_CHUNK, (bytes: ArrayBuffer | Uint8Array) => {
          const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          setBytesReceived((n) => n + u8.byteLength);
          const c = decodeChunk(u8);
          chunksRef.current.set(chunkKey(c.cx, c.cy, c.cz), c);
          setChunkRevision((r) => r + 1);
        });

        room.onMessage(MSG_BODY, (bytes: ArrayBuffer | Uint8Array) => {
          const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          setBytesReceived((n) => n + u8.byteLength);
          const body = decodeBody(u8);
          bodiesRef.current.set(body.id, body);
        });

        room.onMessage("released", (msg: ReleaseResultMsg) => setLastRelease(msg));

        room.onStateChange((state: any) => {
          setAggregates({
            tick: state.tick,
            population: state.population,
            maxGeneration: state.maxGeneration,
            biomass: state.biomass,
            avgBodyVoxels: state.avgBodyVoxels,
            avgNeurons: state.avgNeurons,
          });
          const list: WorldOrganism[] = [];
          state.organisms?.forEach?.((o: WorldOrganism) => {
            list.push({
              id: o.id,
              x: o.x,
              y: o.y,
              z: o.z,
              energy: o.energy,
              lineage: o.lineage,
              generation: o.generation,
              shape: o.shape,
            });
          });
          setOrganisms(list);
          const gs: WorldGod[] = [];
          state.gods?.forEach?.((g: WorldGod) =>
            gs.push({
              id: g.id,
              name: g.name,
              color: g.color,
              living: g.living,
              released: g.released,
            }),
          );
          setGods(gs);
        });

        room.onLeave(() => setConnected(false));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(
          `Le monde commun est injoignable (${SERVER_URL}). ` +
            `Le serveur tourne-t-il ? — ${String(err)}`,
        );
      });

    return () => {
      alive = false;
      void roomRef.current?.leave();
      roomRef.current = null;
    };
  }, []);

  const lookAt = useCallback((x: number, z: number) => {
    const cx = Math.max(0, Math.min(SX - 1, Math.round(x)));
    const cz = Math.max(0, Math.min(SZ - 1, Math.round(z)));
    setEye({ x: cx, z: cz });
    roomRef.current?.send("lookAt", { x: cx, z: cz } satisfies LookAtMsg);
  }, []);

  const release = useCallback(() => {
    if (!champion) {
      setLastRelease({ ok: false, reason: "aucun génome dans le laboratoire" });
      return;
    }
    roomRef.current?.send("release", { genome: champion.genome });
  }, [champion]);

  return {
    connected,
    error,
    aggregates,
    chunks: chunksRef.current,
    chunkRevision,
    organisms,
    bodies: bodiesRef.current,
    gods,
    eye,
    champion,
    lastRelease,
    bytesReceived,
    lookAt,
    release,
  };
}

export function chunkKey(cx: number, cy: number, cz: number): number {
  return (cy * (SZ / CHUNK) + cz) * (SX / CHUNK) + cx;
}
