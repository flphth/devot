import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConformityResult,
  LabCommand,
  LabFrame,
  LabOrganismInfo,
  LabStats,
} from "./protocol.js";

export interface LabHistoryPoint {
  tick: number;
  population: number;
  maxGeneration: number;
  avgBodyVoxels: number;
  avgIntakeRate: number;
  biomassVoxels: number;
}

export interface LabActions {
  reseed: (seed: number, founders: number) => void;
  setSpeed: (ticksPerFrame: number) => void;
  setPaused: (paused: boolean) => void;
  select: (organismId: number) => void;
  protect: (organismId: number, on: boolean) => void;
  kill: (organismId: number) => void;
  breed: (organismId: number) => void;
  exportGenome: (organismId: number) => void;
  runConformity: (ticks: number) => void;
}

export interface LabState {
  frame: LabFrame | null;
  stats: LabStats | null;
  history: LabHistoryPoint[];
  inspected: LabOrganismInfo | null;
  conformity: ConformityResult | null;
  logs: string[];
  exported: { organismId: number; bytes: number; valid: boolean } | null;
  actions: LabActions;
}

const MAX_HISTORY = 220;

export function useLab(initialSeed = 20260725, founders = 160): LabState {
  const workerRef = useRef<Worker | null>(null);
  const [frame, setFrame] = useState<LabFrame | null>(null);
  const [history, setHistory] = useState<LabHistoryPoint[]>([]);
  const [inspected, setInspected] = useState<LabOrganismInfo | null>(null);
  const [conformity, setConformity] = useState<ConformityResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [exported, setExported] = useState<LabState["exported"]>(null);

  useEffect(() => {
    const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: "frame"; frame: LabFrame }
        | { type: "inspect"; info: LabOrganismInfo | null }
        | { type: "genome"; organismId: number; bytes: Uint8Array; valid: boolean }
        | { type: "conformity"; result: ConformityResult }
        | { type: "log"; text: string };

      switch (msg.type) {
        case "frame": {
          setFrame(msg.frame);
          const s = msg.frame.stats;
          setHistory((prev) => {
            // Un point par ~2 % de l'historique : les courbes restent lisibles
            // même à x1000, où des milliers de ticks passent par seconde.
            const last = prev[prev.length - 1];
            if (last && s.tick - last.tick < 1) return prev;
            const next = [
              ...prev,
              {
                tick: s.tick,
                population: s.population,
                maxGeneration: s.maxGeneration,
                avgBodyVoxels: s.avgBodyVoxels,
                avgIntakeRate: s.avgIntakeRate,
                biomassVoxels: s.biomassVoxels,
              },
            ];
            return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
          });
          break;
        }
        case "inspect":
          setInspected(msg.info);
          break;
        case "genome":
          setExported({
            organismId: msg.organismId,
            bytes: msg.bytes.byteLength,
            valid: msg.valid,
          });
          break;
        case "conformity":
          setConformity(msg.result);
          break;
        case "log":
          setLogs((prev) => [...prev.slice(-40), msg.text]);
          break;
      }
    };

    const send = (cmd: LabCommand) => worker.postMessage(cmd);
    send({ type: "init", seed: initialSeed, founders });
    send({ type: "speed", ticksPerFrame: 1 });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [initialSeed, founders]);

  const send = useCallback((cmd: LabCommand) => {
    workerRef.current?.postMessage(cmd);
  }, []);

  const actions: LabActions = {
    reseed: useCallback(
      (seed, f) => {
        setHistory([]);
        setInspected(null);
        setExported(null);
        send({ type: "init", seed, founders: f });
      },
      [send],
    ),
    setSpeed: useCallback((ticksPerFrame) => send({ type: "speed", ticksPerFrame }), [send]),
    setPaused: useCallback((paused) => send({ type: "pause", paused }), [send]),
    select: useCallback((organismId) => send({ type: "inspect", organismId }), [send]),
    protect: useCallback((organismId, on) => send({ type: "protect", organismId, on }), [send]),
    kill: useCallback((organismId) => send({ type: "kill", organismId }), [send]),
    breed: useCallback((organismId) => send({ type: "breed", organismId }), [send]),
    exportGenome: useCallback((organismId) => send({ type: "exportGenome", organismId }), [send]),
    runConformity: useCallback((ticks) => send({ type: "conformity", ticks }), [send]),
  };

  return {
    frame,
    stats: frame?.stats ?? null,
    history,
    inspected,
    conformity,
    logs,
    exported,
    actions,
  };
}
