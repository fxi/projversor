import { geoEquirectangular, geoPath } from "d3";
import { describe, expect, it } from "vitest";
import { coastlinesOf } from "./Overlay";

// A land square across the antimeridian, cut by the projection.
const land = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [170, -10],
            [170, 10],
            [-170, 10],
            [-170, -10],
            [170, -10],
          ],
        ],
      },
    },
  ],
} as const;

describe("coastlinesOf", () => {
  it("strokes rings as lines, not the edges a projection cut adds", () => {
    const coast = coastlinesOf(land as never);
    expect(coast).toMatchObject({ type: "MultiLineString" });
    expect(coastlinesOf(land as never)).toBe(coast);
    const projection = geoEquirectangular().scale(100).translate([0, 0]);
    const length = (d: unknown) => geoPath(projection).measure(d as never);
    // The polygon outline adds the two 20° seams along the antimeridian.
    const seams = length(land) - length(coast);
    const seam = ((20 * Math.PI) / 180) * 100;
    expect(Math.abs(seams / (2 * seam) - 1)).toBeLessThan(0.03);
  });
});
