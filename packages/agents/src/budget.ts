/**
 * Budget & rate control for the inference queue.
 *
 * 0G providers enforce, per user: 30 requests/minute sustained, a burst of 5,
 * and 5 concurrent requests. We must respect BOTH the rate and the concurrency,
 * or we get 429s mid-combat. `BudgetBucket` handles the rate (a token bucket);
 * `Semaphore` handles concurrency; `InferenceGate` composes them.
 */

/** 0G default per-user limits (docs.0g.ai). */
export const REQUESTS_PER_MINUTE = 30;
export const REQUEST_BURST = 5;
export const MAX_CONCURRENT_INFERENCES = 5;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/**
 * A classic token bucket. `capacity` is the burst allowance; it refills at
 * `refillPerSec`. For 0G: capacity = 5 (burst), refillPerSec = 0.5 (→ 30/min).
 * Time is injectable so it is deterministically testable.
 */
export class BudgetBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now: number = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  private refill(now: number): void {
    if (now <= this.last) return;
    const dt = (now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + dt * this.refillPerSec);
    this.last = now;
  }

  /** Try to consume `n` permits; returns false if not enough are available. */
  tryConsume(n: number = 1, now: number = Date.now()): boolean {
    this.refill(now);
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  /** Milliseconds until `n` permits would be available (0 if available now). */
  msUntilAvailable(n: number = 1, now: number = Date.now()): number {
    this.refill(now);
    if (this.tokens >= n) return 0;
    return Math.ceil(((n - this.tokens) / this.refillPerSec) * 1000);
  }

  /** For tests/telemetry. */
  get available(): number {
    return this.tokens;
  }
}

/** Async counting semaphore with FIFO waiters. */
export class Semaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];

  constructor(max: number) {
    this.permits = max;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits++;
  }

  get available(): number {
    return this.permits;
  }

  get waiting(): number {
    return this.waiters.length;
  }
}

/**
 * Gate every inference through both the concurrency semaphore and the rate
 * bucket. `run` acquires a concurrency slot, waits (async) for a rate permit,
 * then runs `fn`, always releasing the slot.
 */
export class InferenceGate {
  private readonly sem: Semaphore;
  private readonly bucket: BudgetBucket;

  constructor(opts?: {
    maxConcurrent?: number;
    burst?: number;
    requestsPerMinute?: number;
    now?: number;
  }) {
    this.sem = new Semaphore(opts?.maxConcurrent ?? MAX_CONCURRENT_INFERENCES);
    this.bucket = new BudgetBucket(
      opts?.burst ?? REQUEST_BURST,
      (opts?.requestsPerMinute ?? REQUESTS_PER_MINUTE) / 60,
      opts?.now,
    );
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.sem.acquire();
    try {
      while (!this.bucket.tryConsume(1)) {
        await sleep(this.bucket.msUntilAvailable(1));
      }
      return await fn();
    } finally {
      this.sem.release();
    }
  }
}
