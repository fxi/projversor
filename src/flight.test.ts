import { describe, expect, it } from "vitest";
import { planFlight } from "./flight";

const river = { rotate: [-9, -42, 0] as const, zoom: 6 };
const male = { rotate: [-73.47, -4.2, 0] as const, zoom: 500 };

describe("regional flights", () => {
  it("recedes modestly and covers most distance before approaching Malé", () => {
    const path = planFlight(river, male)!;
    expect(path.durationMs).toBeGreaterThanOrEqual(1000);
    expect(path.durationMs).toBeLessThanOrEqual(1800);
    expect(path.sample(0)).toEqual({ progress: 0, zoom: 6 });
    expect(path.sample(1)).toEqual({ progress: 1, zoom: 500 });
    const samples = Array.from({ length: 101 }, (_, i) => path.sample(i / 100));
    expect(Math.min(...samples.map((p) => p.zoom))).toBeGreaterThan(4);
    expect(Math.min(...samples.map((p) => p.zoom))).toBeLessThan(6);
    expect(path.sample(0.5).progress).toBeGreaterThan(0.98);
    expect(path.sample(0.5).zoom).toBeLessThan(25);
    expect(
      samples.every((p, i) => !i || p.progress >= samples[i - 1].progress),
    ).toBe(true);
  });

  it("reverses the same path and respects a shorter explicit duration", () => {
    const forward = planFlight(river, male)!;
    const backward = planFlight(male, river)!;
    expect(backward.durationMs).toBeCloseTo(forward.durationMs);
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(backward.sample(t).zoom).toBeCloseTo(forward.sample(1 - t).zoom);
      expect(backward.sample(t).progress).toBeCloseTo(
        1 - forward.sample(1 - t).progress,
      );
    }
    expect(planFlight(river, male, 600)?.durationMs).toBe(600);
  });

  it("keeps short moves, pure zooms and low-altitude-free moves direct", () => {
    expect(
      planFlight(male, { ...male, rotate: [-73.48, -4.21, 0] }),
    ).toBeNull();
    expect(planFlight(male, { ...male, zoom: 4 })).toBeNull();
    expect(planFlight(river, { rotate: [-140, -50, 0], zoom: 4 })).toBeNull();
  });

  it("uses the short distance across the antimeridian and stays finite near poles", () => {
    const a = { rotate: [-179.999, 0, 0] as const, zoom: 500 };
    const b = { rotate: [179.999, 0, 0] as const, zoom: 500 };
    expect(planFlight(a, b)).toBeNull();
    for (const to of [
      { rotate: [0, -90, 0] as const, zoom: 2.4 },
      { rotate: [106.53, 4.2, 0] as const, zoom: 500 },
    ]) {
      const p = planFlight(male, to)!;
      for (let i = 0; i <= 100; i++) {
        const sample = p.sample(i / 100);
        expect(Number.isFinite(sample.zoom)).toBe(true);
        expect(sample.zoom).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
