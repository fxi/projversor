import type { CatalogGeoVideoSource } from "@fxi/zartigl/catalog";
import { describe, expect, it } from "vitest";
import { archiveSpan, nextMonth } from "./FieldLayer";

/** Monthly chunks of one archive, January to December 2026. */
const chunks = Array.from({ length: 12 }, (_, m) => ({
  id: "archive",
  temporal: {
    start: new Date(Date.UTC(2026, m, 1)).toISOString(),
    end: new Date(Date.UTC(2026, m + 1, 0, 18)).toISOString(),
  },
})) as unknown as CatalogGeoVideoSource[];
const MAY = Date.UTC(2026, 4, 1);
const OCT_END = Date.UTC(2026, 9, 31);

describe("archiveSpan", () => {
  it("runs from the first month's start to the last month's end", () => {
    expect(archiveSpan(chunks)).toEqual([
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 11, 31, 18),
    ]);
  });
});

describe("nextMonth", () => {
  it("wraps over the whole archive without a range", () => {
    expect(nextMonth(chunks, 3, null)).toEqual({ index: 4 });
    expect(nextMonth(chunks, 11, null)).toEqual({ index: 0 });
    expect(nextMonth(chunks.slice(0, 1), 0, null)).toBeNull();
  });

  it("plays inside a range, then wraps to its start", () => {
    expect(nextMonth(chunks, 4, [MAY, OCT_END])).toEqual({
      index: 5,
      at: Date.UTC(2026, 5, 1),
    });
    expect(nextMonth(chunks, 9, [MAY, OCT_END])).toEqual({
      index: 4,
      at: MAY,
    });
  });

  it("starts mid-month when the range does", () => {
    const mid = Date.UTC(2026, 4, 15);
    expect(nextMonth(chunks, 9, [mid, OCT_END])).toEqual({
      index: 4,
      at: mid,
    });
  });

  it("replays the month holding a range inside one month", () => {
    const range = [Date.UTC(2026, 4, 5), Date.UTC(2026, 4, 20)] as const;
    expect(nextMonth(chunks, 4, range)).toEqual({ index: 4, at: range[0] });
  });
});
