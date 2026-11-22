import { geoRotation } from "d3";
import { describe, expect, it } from "vitest";
import {
  AZIMUTHAL_CLIP,
  PROJECTIONS,
  applyMat3,
  blendClipAngle,
  blendRaw,
  cartesian,
  invertBlend,
  mollweideTheta,
  rotationMatrix,
  spherical,
  transpose,
  type Blend,
} from "./projections";
import { findPreset } from "./presets";
import { interpolateRotation, versor, versorRotation } from "./versor";

const blend = (
  t: number,
  a = "equalEarth",
  b = "azimuthalEqualArea",
): Blend => ({
  a: PROJECTIONS[a as keyof typeof PROJECTIONS],
  b: PROJECTIONS[b as keyof typeof PROJECTIONS],
  ka: 100,
  kb: 150,
  t,
});

describe("blendRaw", () => {
  it("is projection a at t = 0 and b at t = 1", () => {
    const p: [number, number] = [0.7, -0.4];
    const a = PROJECTIONS.equalEarth.raw(...p);
    const b = PROJECTIONS.azimuthalEqualArea.raw(...p);
    expect(blendRaw(blend(0))(...p)).toEqual([100 * a[0], 100 * a[1]]);
    expect(blendRaw(blend(1))(...p)).toEqual([150 * b[0], 150 * b[1]]);
  });
});

describe("invertBlend", () => {
  it.each([0, 0.3, 0.5, 1])(
    "round-trips the blended projection at t = %s",
    (t) => {
      const forward = blendRaw(blend(t));
      for (const p of [
        [0.2, 0.1],
        [-2.5, 0.9],
        [1.4, -1.2],
      ] as [number, number][]) {
        const inverse = invertBlend(blend(t), ...forward(...p));
        expect(inverse?.[0]).toBeCloseTo(p[0], 5);
        expect(inverse?.[1]).toBeCloseTo(p[1], 5);
      }
    },
  );

  it("inverts Mollweide", () => {
    const m = blend(0, "mollweide", "mollweide");
    const xy = blendRaw(m)(2, 1.3);
    const inverse = invertBlend(m, ...xy);
    expect(inverse?.[0]).toBeCloseTo(2, 6);
    expect(inverse?.[1]).toBeCloseTo(1.3, 6);
  });
});

describe("Adams World in a Square II", () => {
  const adams = PROJECTIONS.adamsWorldSquare2.raw;
  const RAD = Math.PI / 180;

  // PROJ 9.7: echo "λ φ" | proj +proj=adams_ws2 +R=1, a diamond 45° from ours.
  it.each([
    [45, 30, 0.389965306, 0.28352946],
    [-120, -60, -0.983783227, -0.813453861],
    [10, 80, 0.064360897, 1.097956058],
    [150, -20, 1.546294118, -0.333201057],
    [-30, -10, -0.262789779, -0.089183306],
  ])("matches PROJ adams_ws2 at (%s, %s)", (lon, lat, dx, dy) => {
    const [x, y] = adams(lon * RAD, lat * RAD);
    expect(Math.SQRT1_2 * (x - y)).toBeCloseTo(dx, 8);
    expect(Math.SQRT1_2 * (x + y)).toBeCloseTo(dy, 8);
  });

  // PROJ 9.7: echo "λ φ" | proj +proj=spilhaus +R=1.
  it.each([
    [0, -60, -0.286454431, -0.212385724],
    [-150, -45, 0.330739864, -0.673974034],
    [100, -40, 0.222253981, 0.016427848],
    [-60, 10, -1.433011677, 0.370423826],
    [150, -20, 0.628812692, -0.208946239],
  ])(
    "is PROJ spilhaus in the spilhaus preset at (%s, %s)",
    (lon, lat, x, y) => {
      const preset = findPreset("spilhaus")!;
      const r = geoRotation(preset.rotate)([lon, lat]);
      const p = PROJECTIONS[preset.projection].raw(r[0] * RAD, r[1] * RAD);
      expect(p[0]).toBeCloseTo(x, 7);
      expect(p[1]).toBeCloseTo(y, 7);
    },
  );

  it("fits the world in its square extent", () => {
    const [ex, ey] = PROJECTIONS.adamsWorldSquare2.extent;
    for (let lon = -180; lon <= 180; lon += 15) {
      for (let lat = -90; lat <= 90; lat += 15) {
        const [x, y] = adams(lon * RAD, lat * RAD);
        expect(Math.abs(x)).toBeLessThanOrEqual(ex + 1e-6);
        expect(Math.abs(y)).toBeLessThanOrEqual(ey + 1e-6);
      }
    }
  });

  it("inverts away from the four corners", () => {
    for (let lon = -170; lon <= 170; lon += 20) {
      for (let lat = -80; lat <= 80; lat += 20) {
        const back = adams.invert!(...adams(lon * RAD, lat * RAD));
        expect(back[0] / RAD).toBeCloseTo(lon, 5);
        expect(back[1] / RAD).toBeCloseTo(lat, 5);
      }
    }
    expect(adams.invert!(3, 0)[0]).toBeNaN();
  });

  it("inverts when blended", () => {
    const b = blend(0.3, "adamsWorldSquare2", "equalEarth");
    const xy = blendRaw(b)(-1.1, 0.6);
    const inverse = invertBlend(b, ...xy);
    expect(inverse?.[0]).toBeCloseTo(-1.1, 5);
    expect(inverse?.[1]).toBeCloseTo(0.6, 5);
  });

  it("turns the square 45° clockwise into the diamond, and back", () => {
    const diamond = PROJECTIONS.adamsDiamond.raw;
    const [ex, ey] = PROJECTIONS.adamsDiamond.extent;
    for (const [lon, lat] of [
      [100, -40],
      [-60, 10],
      [150, -70],
    ]) {
      const [x, y] = adams(lon * RAD, lat * RAD);
      const [dx, dy] = diamond(lon * RAD, lat * RAD);
      // Same distance from the center, angle 45° less.
      expect(Math.hypot(dx, dy)).toBeCloseTo(Math.hypot(x, y), 12);
      expect(Math.atan2(y, x) - Math.atan2(dy, dx)).toBeCloseTo(Math.PI / 4, 9);
      expect(Math.abs(dx)).toBeLessThanOrEqual(ex);
      expect(Math.abs(dy)).toBeLessThanOrEqual(ey);
      const back = diamond.invert!(dx, dy);
      expect(back[0] / RAD).toBeCloseTo(lon, 5);
      expect(back[1] / RAD).toBeCloseTo(lat, 5);
    }
  });
});

describe("mollweideTheta", () => {
  it("solves 2θ + sin 2θ = π sin φ up to the poles", () => {
    for (const phi of [0, 0.5, 1.2, Math.PI / 2 - 1e-6, -1]) {
      const theta = mollweideTheta(phi);
      expect(2 * theta + Math.sin(2 * theta)).toBeCloseTo(
        Math.PI * Math.sin(phi),
        6,
      );
    }
  });
});

describe("blendClipAngle", () => {
  it("is the horizon for orthographic, none for world projections", () => {
    expect(blendClipAngle(blend(0.4))).toBe(180);
    expect(blendClipAngle(blend(0.6))).toBe(AZIMUTHAL_CLIP);
    expect(blendClipAngle(blend(1, "equalEarth", "orthographic"))).toBe(90);
  });

  it("moves outward continuously while leaving orthographic", () => {
    const angles = [0.9, 0.6, 0.3].map((t) =>
      blendClipAngle(blend(1 - t, "orthographic", "azimuthalEquidistant")),
    );
    expect(angles[0]).toBeGreaterThan(90);
    expect(angles[1]).toBeGreaterThan(angles[0]);
    // The fold vanishes once the world projection dominates.
    expect(angles[2]).toBe(AZIMUTHAL_CLIP);
  });
});

describe("rotationMatrix", () => {
  it("matches d3.geoRotation and inverts by transposition", () => {
    const rotate: [number, number, number] = [-35, 72, 12];
    const m = rotationMatrix(rotate);
    for (const p of [
      [10, 20],
      [-170, -60],
      [95, 80],
    ] as [number, number][]) {
      const expected = geoRotation(rotate)(p);
      const actual = spherical(applyMat3(m, cartesian(...p)));
      expect(actual[0]).toBeCloseTo(expected[0], 9);
      expect(actual[1]).toBeCloseTo(expected[1], 9);
      const back = spherical(applyMat3(transpose(m), cartesian(...actual)));
      expect(back[0]).toBeCloseTo(p[0], 9);
      expect(back[1]).toBeCloseTo(p[1], 9);
    }
  });
});

describe("versor", () => {
  it("round-trips Euler angles", () => {
    const r = versorRotation(versor([40, -30, 10]));
    expect(r[0]).toBeCloseTo(40, 9);
    expect(r[1]).toBeCloseTo(-30, 9);
    expect(r[2]).toBeCloseTo(10, 9);
  });

  it("interpolates rotations end to end", () => {
    const i = interpolateRotation([0, 0, 0], [20, 90, 0]);
    expect(i(0)[1]).toBeCloseTo(0, 9);
    expect(i(1)[1]).toBeCloseTo(90, 5);
  });
});
