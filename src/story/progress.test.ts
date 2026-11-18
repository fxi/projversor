import { describe, expect, it } from "vitest";
import { keyTarget, progressAt, stepProgress, stepTarget } from "./progress";

describe("keyTarget", () => {
  it("steps with the arrows and jumps with the digits, within the scenes", () => {
    expect(keyTarget("ArrowRight", 2, 9)).toBe(3);
    expect(keyTarget("ArrowLeft", 2, 9)).toBe(1);
    expect(keyTarget("ArrowLeft", 0, 9)).toBe(0);
    expect(keyTarget("ArrowRight", 8, 9)).toBe(8);
    expect(keyTarget("ArrowRight", -1, 9)).toBe(1);
    expect(keyTarget("0", 5, 9)).toBe(0);
    expect(keyTarget("7", 1, 9)).toBe(7);
    expect(keyTarget("9", 1, 9)).toBeNull();
    expect(keyTarget("ArrowDown", 2, 9)).toBeNull();
    expect(keyTarget("a", 2, 9)).toBeNull();
  });
});

describe("stepProgress", () => {
  it("runs from the activation line over half the step", () => {
    // Line at 600 px of a 1000 px viewport; a 2000 px step.
    expect(stepProgress(700, 2000, 1000, 0.6)).toBe(0);
    expect(stepProgress(600, 2000, 1000, 0.6)).toBe(0);
    expect(stepProgress(100, 2000, 1000, 0.6)).toBe(0.5);
    expect(stepProgress(-400, 2000, 1000, 0.6)).toBe(1);
    expect(stepProgress(-1500, 2000, 1000, 0.6)).toBe(1);
  });
});

describe("progressAt", () => {
  it("maps the activation line onto the steps' extent", () => {
    expect(progressAt(0, 1000, 0.6, 600, 5600)).toBe(0);
    expect(progressAt(2500, 1000, 0.6, 600, 5600)).toBeCloseTo(0.5);
    expect(progressAt(9000, 1000, 0.6, 600, 5600)).toBe(1);
    expect(progressAt(100, 1000, 0.6, 600, 600)).toBe(0);
  });
});

describe("stepTarget", () => {
  it("steps one scene, or jumps to an end, within the scenes", () => {
    expect(stepTarget("next", 2, 9)).toBe(3);
    expect(stepTarget("previous", 2, 9)).toBe(1);
    expect(stepTarget("first", 5, 9)).toBe(0);
    expect(stepTarget("last", 1, 9)).toBe(8);
    expect(stepTarget("previous", 0, 9)).toBe(0);
    expect(stepTarget("next", 8, 9)).toBe(8);
    expect(stepTarget("next", -1, 9)).toBe(1);
  });
});

describe("keyTarget with prelude scenes", () => {
  // Two prelude steps, then scenes 1, 2, 3.
  const numbers = [null, null, 1, 2, 3];
  it("opens a scene by its number, not its index", () => {
    expect(keyTarget("1", 0, 5, numbers)).toBe(2);
    expect(keyTarget("3", 0, 5, numbers)).toBe(4);
    expect(keyTarget("0", 3, 5, numbers)).toBe(0);
    expect(keyTarget("4", 0, 5, numbers)).toBeNull();
  });
});
