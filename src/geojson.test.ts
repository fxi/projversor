import { geoOrthographic } from "d3";
import { describe, expect, it } from "vitest";
import { drawGeoJSON, parseGeoJSONLayer } from "./geojson";
import type { ViewFrame } from "./view";

const point = (name: string, lon: number) => ({
  type: "Feature",
  properties: { name },
  geometry: { type: "Point", coordinates: [lon, 0] },
});

/** A 2D context that records the labels and point radii it draws. */
function recordingContext() {
  const labels: string[] = [];
  const radii: number[] = [];
  const noop = () => undefined;
  const ctx = {
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    arc: (_x: number, _y: number, r: number) => radii.push(r),
    fill: noop,
    stroke: noop,
    strokeText: noop,
    fillText: (text: string) => labels.push(text),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, labels, radii };
}

describe("parseGeoJSONLayer", () => {
  it("accepts GeoJSON with a known style", () => {
    const layer = {
      data: { type: "FeatureCollection", features: [] },
      style: { stroke: "#fff", width: 1.5, label: "name", radius: 2 },
    };
    expect(parseGeoJSONLayer(layer, "layer")).toBe(layer);
  });

  it("rejects other data, unknown style keys and bad widths", () => {
    expect(() => parseGeoJSONLayer({ data: { type: "Map" } }, "v")).toThrow(
      "v.data must be a GeoJSON object",
    );
    expect(() =>
      parseGeoJSONLayer(
        { data: { type: "Point", coordinates: [0, 0] }, style: { color: 1 } },
        "v",
      ),
    ).toThrow("v.style.color is not a GeoJSON style key");
    expect(() =>
      parseGeoJSONLayer(
        { data: { type: "Point", coordinates: [0, 0] }, style: { width: 0 } },
        "v",
      ),
    ).toThrow("v.style.width must be a positive number");
    expect(() =>
      parseGeoJSONLayer(
        { data: { type: "Point", coordinates: [0, 0] }, style: { radius: 0 } },
        "v",
      ),
    ).toThrow("v.style.radius must be a positive number");
  });
});

describe("drawGeoJSON", () => {
  it("labels features on the near side of a globe only", () => {
    const projection = geoOrthographic().clipAngle(90);
    const { ctx, labels } = recordingContext();
    drawGeoJSON(
      ctx,
      projection,
      { rotate: [0, 0, 0], clipAngle: 90 } as unknown as ViewFrame,
      {
        data: {
          type: "FeatureCollection",
          features: [point("near", 10), point("far", 170)],
        } as never,
        style: { label: "name" },
      },
    );
    expect(labels).toEqual(["near"]);
  });

  it("draws points at the style radius, d3's 4.5 by default", () => {
    const projection = geoOrthographic().clipAngle(90);
    const frame = { rotate: [0, 0, 0], clipAngle: 90 } as unknown as ViewFrame;
    const data = { type: "Point", coordinates: [0, 0] } as never;
    const small = recordingContext();
    drawGeoJSON(small.ctx, projection, frame, { data, style: { radius: 2 } });
    expect(small.radii).toEqual([2]);
    const plain = recordingContext();
    drawGeoJSON(plain.ctx, projection, frame, { data });
    expect(plain.radii).toEqual([4.5]);
  });
});
