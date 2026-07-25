import { describe, expect, it } from "vitest";
import {
  BudgetBucket,
  InferenceGate,
  MAX_CONCURRENT_INFERENCES,
  REQUESTS_PER_MINUTE,
  REQUEST_BURST,
  Semaphore,
} from "../src/budget.ts";

describe("BudgetBucket (rate limiting)", () => {
  it("allows a burst up to capacity, then blocks", () => {
    const b = new BudgetBucket(5, 0.5, 0); // 0G: burst 5, 30/min
    for (let i = 0; i < 5; i++) expect(b.tryConsume(1, 0)).toBe(true);
    expect(b.tryConsume(1, 0)).toBe(false);
  });

  it("refills at the sustained rate (30/min → 1 permit / 2s)", () => {
    const b = new BudgetBucket(5, 0.5, 0);
    for (let i = 0; i < 5; i++) b.tryConsume(1, 0);
    expect(b.tryConsume(1, 1_000)).toBe(false); // 1s → 0.5 permits
    expect(b.tryConsume(1, 2_000)).toBe(true); // 2s → 1 permit
  });

  it("reports ms until the next permit", () => {
    const b = new BudgetBucket(5, 0.5, 0);
    for (let i = 0; i < 5; i++) b.tryConsume(1, 0);
    expect(b.msUntilAvailable(1, 0)).toBe(2_000);
    expect(b.msUntilAvailable(1, 1_000)).toBe(1_000);
  });

  it("never exceeds capacity when idle", () => {
    const b = new BudgetBucket(5, 0.5, 0);
    expect(b.tryConsume(5, 100_000)).toBe(true); // still capped at 5
    expect(b.tryConsume(1, 100_000)).toBe(false);
  });
});

describe("Semaphore (concurrency)", () => {
  it("caps concurrent holders and queues the rest", async () => {
    const s = new Semaphore(2);
    await s.acquire();
    await s.acquire();
    expect(s.available).toBe(0);
    let third = false;
    const p = s.acquire().then(() => {
      third = true;
    });
    await Promise.resolve();
    expect(third).toBe(false); // queued
    s.release();
    await p;
    expect(third).toBe(true);
  });
});

describe("InferenceGate (respects BOTH limits)", () => {
  it("serialises beyond the concurrency cap", async () => {
    const gate = new InferenceGate({ maxConcurrent: 2, burst: 100, requestsPerMinute: 100000 });
    let active = 0;
    let peak = 0;
    const task = () =>
      gate.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("exposes 0G defaults", () => {
    expect(MAX_CONCURRENT_INFERENCES).toBe(5);
    expect(REQUESTS_PER_MINUTE).toBe(30);
    expect(REQUEST_BURST).toBe(5);
  });
});
