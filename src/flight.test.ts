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

  it("keeps short moves and pure zooms direct", () => {
    expect(
      planFlight(male, { ...male, rotate: [-73.48, -4.21, 0] }),
    ).toBeNull();
    expect(planFlight(male, { ...male, zoom: 4 })).toBeNull();
    // Under one screen of travel on a whole globe.
    expect(
      planFlight(
        { rotate: [0, 0, 0], zoom: 1.2 },
        { rotate: [20, 0, 0], zoom: 1.2 },
      ),
    ).toBeNull();
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
        expect(sample.zoom).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  describe("global flights rise, turn, then descend", () => {
    const pacific = { rotate: [105, 5, 0] as const, zoom: 1.2 };
    const arctic = { rotate: [0, -90, 0] as const, zoom: 2.4 };
    const sampled = (path: NonNullable<ReturnType<typeof planFlight>>) =>
      Array.from({ length: 201 }, (_, i) => path.sample(i / 200));

    it("pulls back to the whole globe before the Pacific turns to Malé", () => {
      const path = planFlight(pacific, male, 3000)!;
      expect(path.sample(0)).toEqual({ progress: 0, zoom: 1.2 });
      expect(path.sample(1)).toEqual({ progress: 1, zoom: 500 });
      const samples = sampled(path);
      expect(Math.min(...samples.map((p) => p.zoom))).toBeLessThanOrEqual(1);
      // The globe has turned before the camera comes down.
      const low = samples.filter((p) => p.zoom > 5);
      expect(Math.min(...low.map((p) => p.progress))).toBeGreaterThan(0.95);
      const half = samples.find((p) => p.progress >= 0.5)!;
      expect(half.zoom).toBeLessThanOrEqual(1.2);
      expect(
        samples.every((p, i) => !i || p.progress >= samples[i - 1].progress),
      ).toBe(true);
    });

    it("rises from Malé before turning to the Arctic", () => {
      const path = planFlight(male, arctic, 3000)!;
      const samples = sampled(path);
      const high = samples.filter((p) => p.zoom > 5);
      expect(Math.max(...high.map((p) => p.progress))).toBeLessThan(0.05);
      expect(Math.min(...samples.map((p) => p.zoom))).toBeLessThanOrEqual(1);
      expect(path.sample(1)).toEqual({ progress: 1, zoom: 2.4 });
    });

    it("flies between two mid-zoom views across the globe", () => {
      const polo = { rotate: [108, -19, 0] as const, zoom: 3 };
      const congo = { rotate: [-20, 0, 0] as const, zoom: 4 };
      const path = planFlight(polo, congo, 3000)!;
      expect(path).not.toBeNull();
      const samples = sampled(path);
      expect(Math.min(...samples.map((p) => p.zoom))).toBeLessThanOrEqual(1);
      const half = samples.find((p) => p.progress >= 0.5)!;
      expect(half.zoom).toBeLessThan(1.5);
      expect(path.sample(1)).toEqual({ progress: 1, zoom: 4 });
    });

    it("takes the requested time, never less than its stages need", () => {
      const shortest = planFlight(pacific, male)!.durationMs;
      expect(shortest).toBeGreaterThan(3500);
      expect(shortest).toBeLessThan(5000);
      expect(planFlight(pacific, male, 2000)!.durationMs).toBe(shortest);
      expect(planFlight(pacific, male, 6000)!.durationMs).toBe(6000);
    });
  });
});
