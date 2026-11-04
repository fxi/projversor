import { geoOrthographic } from "d3";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());
import { Camera, type CameraHost } from "./Camera";

function camera(initial: ConstructorParameters<typeof Camera>[1]) {
  const presets: string[] = [];
  const host: CameraHost = {
    project: () => geoOrthographic(),
    preset: (preset) => presets.push(preset.id),
    north: () => undefined,
    refit: () => undefined,
  };
  return { camera: new Camera(host, initial), presets };
}

describe("Camera.goTo", () => {
  it("does not replay a morph onto the view it already shows", () => {
    const { camera: c, presets } = camera({
      preset: "mollweide",
      rotate: [160, 0, 0],
      zoom: 1.05,
    });
    c.goTo({ preset: "mollweide", rotate: [160, 0, 0], zoom: 1.05 });
    const { rotate, zoom } = c.target();
    rotate.forEach((v, i) => expect(v).toBeCloseTo([160, 0, 0][i]));
    expect(zoom).toBeCloseTo(1.05);
    expect(presets).toEqual([]);
    expect(c.view.blend.t).toBe(0);
  });

  it("morphs when the preset, rotation or zoom differ", () => {
    const { camera: c, presets } = camera({ preset: "mollweide" });
    c.goTo({ preset: "globe", rotate: [150, -2, 0], zoom: 1.7 });
    expect(presets).toEqual(["globe"]);
    expect(c.target().zoom).toBeCloseTo(1.7);

    const { camera: d, presets: dPresets } = camera({
      preset: "globe",
      rotate: [0, 0, 0],
      zoom: 1,
    });
    d.goTo({ preset: "globe", rotate: [0, 0, 0], zoom: 2 });
    expect(dPresets).toEqual(["globe"]);
  });
});

describe("Camera.setInset", () => {
  it("leaves an unchanged inset alone", () => {
    const { camera: c } = camera({ preset: "globe" });
    const inset = { top: 100, right: 0, bottom: 0, left: 0 };
    c.setInset(inset, 0);
    const before = c.view.inset;
    c.setInset({ ...inset }, 2000);
    expect(c.view.inset).toBe(before);
  });
});

describe("adaptive camera transitions", () => {
  const river = {
    preset: "globe",
    rotate: [-9, -42, 0] as [number, number, number],
    zoom: 6,
  };
  const male = {
    preset: "globe",
    rotate: [-73.47, -4.2, 0] as [number, number, number],
    zoom: 500,
  };

  it("lands within 1.8 seconds and finishes the inset with the camera", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { camera: c } = camera(river);
    const inset = { top: 0, left: 560, right: 0, bottom: 0 };
    c.setInset(inset, 3000);
    c.goTo({ ...male, durationMs: 3000 });
    c.animate(900);
    expect(c.view.inset!.left).toBeGreaterThan(550);
    c.animate(1800);
    expect(c.zoom).toBe(500);
    male.rotate.forEach((v, i) => expect(c.rotate[i]).toBeCloseTo(v));
    expect(c.view.inset).toEqual(inset);
  });

  it("recedes before moving away from Malé", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { camera: c } = camera(male);
    c.goTo({ ...river, durationMs: 3000 });
    c.animate(400);
    expect(c.zoom).toBeLessThan(500);
    expect(Math.abs(c.rotate[0] - male.rotate[0])).toBeLessThan(0.1);
    c.animate(1800);
    expect(c.zoom).toBe(6);
  });

  it("restarts from the displayed pose when a flight reverses", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { camera: c } = camera(river);
    c.goTo({ ...male, durationMs: 3000 });
    c.animate(1400);
    const pose = { rotate: [...c.rotate], zoom: c.zoom };
    now.mockReturnValue(1400);
    c.goTo({ ...river, durationMs: 3000 });
    c.animate(1400);
    expect(c.zoom).toBeCloseTo(pose.zoom);
    pose.rotate.forEach((v, i) => expect(c.rotate[i]).toBeCloseTo(v));
    c.animate(3200);
    expect(c.zoom).toBe(6);
  });

  it("keeps a reversed projection morph continuous and lands on the right projection", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { camera: c } = camera(male);
    c.goTo({ preset: "north", zoom: 2.4, durationMs: 3000 });
    c.animate(900);
    const blend = { ...c.view.blend };
    now.mockReturnValue(900);
    c.goTo({ ...male, durationMs: 3000 });
    c.animate(900);
    expect(c.view.blend).toEqual(blend);
    c.animate(3900);
    expect(c.view.blend.a.id).toBe("orthographic");
    expect(c.view.blend.b.id).toBe("orthographic");
    expect(c.zoom).toBe(500);
  });

  it("keeps a mixture continuous when interrupted toward a third projection", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { camera: c } = camera(male);
    c.goTo({ preset: "north", zoom: 2.4, durationMs: 3000 });
    c.animate(900);
    const blend = { ...c.view.blend };
    now.mockReturnValue(900);
    c.goTo({ preset: "south", zoom: 2.2, durationMs: 3000 });
    c.animate(900);
    expect(c.view.blend).toEqual(blend);
    for (let t = 910; t <= 3900; t += 10) {
      c.animate(t);
      expect(Number.isFinite(c.zoom)).toBe(true);
    }
    expect(c.view.blend.a.id).toBe("azimuthalEquidistant");
    expect(c.view.blend.b.id).toBe("azimuthalEquidistant");
    expect(c.zoom).toBe(2.2);
  });

  it("keeps the requested duration on low zooms and skips animation on jumps", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { camera: c } = camera(river);
    c.goTo({ preset: "globe", rotate: [-20, 0, 0], zoom: 4, durationMs: 3000 });
    c.animate(1800);
    expect(c.zoom).not.toBe(4);
    c.animate(3000);
    expect(c.zoom).toBe(4);
    c.goTo({ ...male, durationMs: 0 });
    expect(c.zoom).toBe(500);
    c.jumpTo(river);
    c.animate(10000);
    expect(c.zoom).toBe(6);
  });

  it("keeps the short manual zoom controls unchanged", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { camera: c } = camera(male);
    c.zoomBy(0.5);
    c.animate(450);
    expect(c.zoom).toBe(250);
  });
});
