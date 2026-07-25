import { SX, SY, SZ, VOXEL_COUNT, type VoxelWorld } from "@devot/sim-voxel";
import { TERRAIN_WGSL } from "./terrain.wgsl.js";

/**
 * Exécution de la passe terrain sur GPU, avec état résident : les tampons
 * restent en mémoire GPU pendant tous les ticks, et on ne relit qu'une fois à
 * la fin. C'est ce qui rend le x1000 possible — un readback par tick coûterait
 * plus cher que la simulation elle-même.
 *
 * Ce module est un ACCÉLÉRATEUR : s'il n'est pas disponible ou s'il échoue, le
 * laboratoire continue sur le chemin CPU sans rien changer aux règles.
 */

interface GpuNav {
  gpu?: {
    requestAdapter(): Promise<GpuAdapterLike | null>;
  };
}

interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike>;
}

// Le typage WebGPU n'est pas garanti présent dans la lib TS du projet : on
// décrit le strict nécessaire plutôt que d'ajouter une dépendance de types.
type GpuDeviceLike = {
  createShaderModule(d: { code: string }): unknown;
  createBuffer(d: { size: number; usage: number; mappedAtCreation?: boolean }): GpuBufferLike;
  createComputePipeline(d: unknown): unknown;
  createBindGroup(d: unknown): unknown;
  createCommandEncoder(): GpuEncoderLike;
  queue: {
    writeBuffer(b: GpuBufferLike, off: number, data: ArrayBufferView): void;
    submit(c: unknown[]): void;
    onSubmittedWorkDone(): Promise<void>;
  };
  destroy?(): void;
};

type GpuBufferLike = {
  destroy(): void;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
};

type GpuEncoderLike = {
  beginComputePass(): {
    setPipeline(p: unknown): void;
    setBindGroup(i: number, g: unknown): void;
    dispatchWorkgroups(x: number): void;
    end(): void;
  };
  copyBufferToBuffer(
    src: GpuBufferLike,
    srcOff: number,
    dst: GpuBufferLike,
    dstOff: number,
    size: number,
  ): void;
  finish(): unknown;
};

const USAGE_STORAGE = 0x80;
const USAGE_COPY_SRC = 0x04;
const USAGE_COPY_DST = 0x08;
const USAGE_UNIFORM = 0x40;
const USAGE_MAP_READ = 0x01;
const MAP_READ = 0x01;

function nav(): GpuNav {
  return globalThis.navigator as unknown as GpuNav;
}

/** WebGPU est-il utilisable ici ? Aucune exception ne remonte : juste un bool. */
export async function gpuAvailable(): Promise<boolean> {
  try {
    const adapter = await nav().gpu?.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Avance le terrain de `ticks` sur GPU et recopie le résultat dans le monde.
 * Renvoie false si quoi que ce soit échoue — l'appelant retombe sur le CPU.
 */
export async function runTerrainPassOnGpu(w: VoxelWorld, ticks: number): Promise<boolean> {
  let device: GpuDeviceLike | undefined;
  const owned: GpuBufferLike[] = [];
  try {
    const adapter = await nav().gpu?.requestAdapter();
    if (!adapter) return false;
    device = await adapter.requestDevice();

    const bytes = VOXEL_COUNT * 4;
    const make = (usage: number): GpuBufferLike => {
      const b = device!.createBuffer({ size: bytes, usage });
      owned.push(b);
      return b;
    };

    // Le noyau travaille en u32 : les tampons Uint8/Uint16 du CPU sont élargis.
    const matA = make(USAGE_STORAGE | USAGE_COPY_DST | USAGE_COPY_SRC);
    const matB = make(USAGE_STORAGE | USAGE_COPY_DST | USAGE_COPY_SRC);
    const nutA = make(USAGE_STORAGE | USAGE_COPY_DST | USAGE_COPY_SRC);
    const nutB = make(USAGE_STORAGE | USAGE_COPY_DST | USAGE_COPY_SRC);
    const readback = device.createBuffer({
      size: bytes * 2,
      usage: USAGE_COPY_DST | USAGE_MAP_READ,
    });
    owned.push(readback);

    const mat32 = new Uint32Array(VOXEL_COUNT);
    const nut32 = new Uint32Array(VOXEL_COUNT);
    for (let i = 0; i < VOXEL_COUNT; i++) {
      mat32[i] = w.material[i]!;
      nut32[i] = w.nutrient[i]!;
    }
    device.queue.writeBuffer(matA, 0, mat32);
    device.queue.writeBuffer(nutA, 0, nut32);

    const params = device.createBuffer({
      size: 32,
      usage: USAGE_UNIFORM | USAGE_COPY_DST,
    });
    owned.push(params);

    const module = device.createShaderModule({ code: TERRAIN_WGSL });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    } as unknown);

    const groupFor = (inMat: GpuBufferLike, inNut: GpuBufferLike, outMat: GpuBufferLike, outNut: GpuBufferLike) =>
      device!.createBindGroup({
        layout: (pipeline as { getBindGroupLayout(i: number): unknown }).getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inMat } },
          { binding: 1, resource: { buffer: inNut } },
          { binding: 2, resource: { buffer: outMat } },
          { binding: 3, resource: { buffer: outNut } },
          { binding: 4, resource: { buffer: params } },
        ],
      } as unknown);

    const groupAB = groupFor(matA, nutA, matB, nutB);
    const groupBA = groupFor(matB, nutB, matA, nutA);
    const workgroups = Math.ceil(VOXEL_COUNT / 64);

    const uni = new Uint32Array(8);
    uni[0] = SX;
    uni[1] = SY;
    uni[2] = SZ;
    uni[4] = w.seed >>> 0;
    uni[5] = w.activeTop;
    uni[6] = VOXEL_COUNT;
    // L'altitude fertile est propre à chaque monde : elle doit voyager avec lui,
    // sinon le GPU applique la règle de pousse à un autre relief que le CPU.
    uni[7] = w.fertileMaxY;

    for (let t = 0; t < ticks; t++) {
      // Le tick est le SEUL paramètre qui change : l'état ne quitte pas le GPU.
      uni[3] = (w.tick + t) >>> 0;
      device.queue.writeBuffer(params, 0, uni);

      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, t % 2 === 0 ? groupAB : groupBA);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    // Un unique readback, à la fin.
    const finalMat = ticks % 2 === 0 ? matA : matB;
    const finalNut = ticks % 2 === 0 ? nutA : nutB;
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(finalMat, 0, readback, 0, bytes);
    enc.copyBufferToBuffer(finalNut, 0, readback, bytes, bytes);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();

    await readback.mapAsync(MAP_READ);
    const range = readback.getMappedRange();
    const outMat = new Uint32Array(range, 0, VOXEL_COUNT);
    const outNut = new Uint32Array(range, bytes, VOXEL_COUNT);
    for (let i = 0; i < VOXEL_COUNT; i++) {
      w.material[i] = outMat[i]!;
      w.nutrient[i] = outNut[i]!;
    }
    readback.unmap();

    w.materialNext.set(w.material);
    w.nutrientNext.set(w.nutrient);
    w.tick += ticks;
    return true;
  } catch (err) {
    console.warn("[labo] passe GPU indisponible, repli CPU :", err);
    return false;
  } finally {
    for (const b of owned) {
      try {
        b.destroy();
      } catch {
        /* déjà libéré */
      }
    }
    device?.destroy?.();
  }
}
