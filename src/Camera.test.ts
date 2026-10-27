import { geoOrthographic } from "d3";
import { describe, expect, it } from "vitest";
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
