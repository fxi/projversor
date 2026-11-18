import { describe, expect, it } from "vitest";
import { parseLegendConfig, rampTicks } from "./legend";
import { sceneInset } from "./mount";
import {
  fractionAt,
  monthTicks,
  seriesPaths,
  seriesValue,
  shiftYear,
  timeAt,
  timeFormatter,
  windowTicks,
  yearTicks,
} from "./timeline";

// Moved from grid-homepage with the story mount.
describe("timeline and legend ticks", () => {
  const may = Date.UTC(2026, 4, 1);
  const july = Date.UTC(2026, 6, 1);
  it("places times and month starts in the window", () => {
    expect(fractionAt(Date.UTC(2026, 5, 1), [may, july])).toBeCloseTo(31 / 61);
    expect(fractionAt(0, [may, july])).toBe(0);
    expect(timeAt(2, [may, july])).toBe(july);
    expect(monthTicks([may, july])).toEqual([31 / 61]);
  });

  it("uses calendar years for annual ticks, spoken dates and leap-day navigation", () => {
    const start = Date.UTC(2020, 11, 31);
    const end = Date.UTC(2023, 11, 31);
    expect(yearTicks([start, end])).toEqual(
      [2021, 2022, 2023].map((year) =>
        fractionAt(Date.UTC(year, 0, 1), [start, end]),
      ),
    );
    const leapDay = Date.UTC(2024, 1, 29, 12, 30);
    expect(shiftYear(leapDay, 1)).toBe(Date.UTC(2025, 1, 28, 12, 30));
    expect(shiftYear(leapDay, -4)).toBe(Date.UTC(2020, 1, 29, 12, 30));
    for (const locale of ["en", "fr"]) {
      expect(timeFormatter(locale, "year").format(leapDay)).toBe("2024");
      expect(timeFormatter(locale, "year", true).format(leapDay)).toBe("2024");
      expect(timeFormatter(locale, "day").format(leapDay)).not.toBe("2024");
    }
    expect(() =>
      parseLegendConfig({ label: { en: "x" }, timeStep: "month" }),
    ).toThrow('legend config: timeStep must be "day" or "year"');
  });

  it("ticks years over windows longer than two years", () => {
    const start = Date.UTC(2022, 5, 1);
    const end = Date.UTC(2026, 9, 31);
    expect(windowTicks([start, end], "day")).toEqual(yearTicks([start, end]));
    expect(windowTicks([may, july], "day")).toEqual(monthTicks([may, july]));
  });

  it("draws a series on the thumb's time axis, and reads it between days", () => {
    const points = [
      { time: may - 86_400_000, value: 9 },
      { time: may, value: 1 },
      { time: Date.UTC(2026, 5, 1), value: 3 },
      { time: july, value: 2 },
    ];
    const paths = seriesPaths(points, [may, july])!;
    expect(paths).toMatchObject({ low: 1, high: 3 });
    const x = +(fractionAt(Date.UTC(2026, 5, 1), [may, july]) * 1000).toFixed(
      2,
    );
    expect(paths.line).toBe(`M0,100L${x},0L1000,50`);
    expect(seriesValue(points, may + 15.5 * 86_400_000)).toBeCloseTo(2);
    expect(seriesValue(points, july + 1)).toBeNull();
    expect(seriesPaths(points, [july, july + 1])).toBeNull();
  });

  it("labels a ramp at its ends and a middle", () => {
    const ticks = rampTicks({ min: -2, max: 2, ramp: "linear" });
    expect(ticks[0]).toEqual({ at: 0, label: "−2" });
    expect(ticks[ticks.length - 1]).toEqual({ at: 1, label: "2" });
    expect(rampTicks({ min: 1, max: 1, ramp: "linear" })).toEqual([]);
  });

  it("writes ramp ticks with the separators of the locale", () => {
    const ticks = rampTicks({ min: 0, max: 0.6, ramp: "linear" }, 3, "fr");
    expect(ticks.map((tick) => tick.label)).toEqual([
      "0,0",
      "0,2",
      "0,4",
      "0,6",
    ]);
  });
});

describe("sceneInset", () => {
  it("frees the side opposite the card on wide screens", () => {
    expect(sceneInset("left", 1400, 900)).toMatchObject({ left: 560 });
    expect(sceneInset("right", 1000, 800)).toMatchObject({ right: 420 });
    expect(sceneInset("intro", 1400, 900)).toMatchObject({ top: 378 });
  });

  it("keeps the sphere above the cards on narrow screens", () => {
    expect(sceneInset("left", 400, 800)).toEqual({
      top: 0,
      right: 0,
      bottom: 240,
      left: 0,
    });
  });
});
